// End-to-end check of the Phase 3 acceptance: every page at phone and desktop width in both themes (no
// console errors, no sideways scroll), the numbers on screen match the exports, a 250-ply game steps
// smoothly, and Explore gets live lines from the in-browser engine.
//
// Uses the installed Google Chrome through playwright-core. Builds and serves the production bundle
// (vite preview) unless E2E_URL is set; --dev serves the dev build instead.
// Usage: npm run e2e [-- --shots <dir>] [-- --dev]
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname } from "node:path";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const data = (p) => JSON.parse(readFileSync(join(root, "public/data", p), "utf8"));
const summary = data("summary.json");
const LONG_GAME = process.env.E2E_GAME ?? "164948678288";
const longGame = data(`games/${LONG_GAME}.json`);

let base = process.env.E2E_URL, server = null;
if (!base) {
  const port = 5199, dev = process.argv.includes("--dev");
  if (!dev) execFileSync("npm", ["run", "build"], { cwd: root, stdio: "ignore" });
  server = spawn("npx", ["vite", ...(dev ? [] : ["preview"]), "--port", String(port), "--strictPort"], { cwd: root, stdio: "ignore" });
  base = `http://localhost:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) break; } catch { /* not up yet */ }
    await new Promise((ok) => setTimeout(ok, 150));
  }
}

const results = [];

// A bare static server for the built site: no special headers, unknown paths fall back to index.html.
async function plainServer() {
  const dist = join(root, "dist");
  if (!existsSync(join(dist, "index.html"))) execFileSync("npm", ["run", "build"], { cwd: root, stdio: "ignore" });
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
                  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    let file = join(dist, path);
    if (!file.startsWith(dist) || !existsSync(file) || path.endsWith("/")) file = join(dist, "index.html");
    res.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise((ok) => server.listen(0, ok));
  return { server, url: `http://localhost:${server.address().port}` };
}
const check = (name, ok, detail = "") => results.push({ name, ok: !!ok, detail });

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const PAGES = [
    { path: "/", name: "dashboard", ready: ".big" },
    { path: "/leaks", name: "leaks", ready: ".leak" },
    { path: "/leaks/hung_piece", name: "leak-detail", ready: ".pos .board" },
    { path: "/games", name: "games", ready: ".game-row" },
    { path: `/games/${LONG_GAME}`, name: "viewer", ready: ".moves .mv" },
  ];
  for (const theme of ["dark", "light"]) {
    for (const width of [390, 1280]) {
      const mobile = width < 768;
      const ctx = await browser.newContext({
        viewport: { width, height: mobile ? 844 : 900 }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile,
        colorScheme: theme,
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));
      for (const p of PAGES) {
        errors.length = 0;
        await page.goto(base + p.path);
        await page.waitForSelector(p.ready, { timeout: 15000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(300);
        const over = await page.evaluate(() => {
          const w = document.documentElement.clientWidth;
          const wide = [...document.querySelectorAll("main *")].filter((e) => e.getBoundingClientRect().right > w + 1)
            .slice(0, 5).map((e) => `${e.tagName.toLowerCase()}.${e.getAttribute("class") ?? ""}`);
          return { scroll: document.scrollingElement.scrollWidth - w, wide };
        });
        const tag = `${p.name} ${width}px ${theme}`;
        check(`${tag}: no sideways scroll`, over.scroll <= 0, over.wide.join(", "));
        check(`${tag}: no console errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
        if (shots) await page.screenshot({ path: join(shots, `${p.name}-${width}-${theme}.png`), fullPage: true });
      }
      await ctx.close();
    }
  }

  // Numbers on screen match the exports.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(base + "/");
  await page.waitForSelector(".big");
  const big = await page.textContent(".big");
  check("dashboard: rating matches summary.json", Number(big) === summary.rating, `${big} vs ${summary.rating}`);
  const leakNames = await page.$$eval(".topleak .nm", (els) => els.map((e) => e.textContent));
  check("dashboard: three top leaks", leakNames.length === summary.top_leaks.length, leakNames.join(", "));
  const recentLosses = Object.values(summary.why_i_lost_30_days).reduce((a, b) => a + b, 0);
  const keyText = await page.textContent(".keys");
  check("dashboard: 30-day loss count matches", keyText.includes(`(${recentLosses} `), keyText);

  // The long game: step through every ply with the keyboard and time each step until its frame is painted
  // (a rAF callback runs before the paint, a task queued from it runs after).
  await page.goto(`${base}/games/${LONG_GAME}?ply=0`);
  await page.waitForSelector(".moves .mv");
  await page.waitForTimeout(500);
  const n = longGame.moves.length;
  const timing = await page.evaluate(async (plies) => {
    const frame = () => new Promise((ok) => requestAnimationFrame(() => setTimeout(ok, 0)));
    const long = [];
    const obs = new PerformanceObserver((list) => long.push(...list.getEntries().map((e) => e.duration)));
    obs.observe({ type: "longtask", buffered: false });
    const steps = [];
    for (let k = 0; k < plies; k++) {
      const t = performance.now();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
      await frame();
      steps.push(performance.now() - t);
    }
    obs.disconnect();
    steps.sort((a, b) => a - b);
    const caption = document.querySelector(".board-cap")?.textContent ?? "";
    return { mean: steps.reduce((a, b) => a + b, 0) / steps.length, p95: steps[Math.floor(steps.length * 0.95)],
             max: steps.at(-1), longTasks: long.length, caption };
  }, n);
  check(`viewer: stepped all ${n} plies`, timing.caption.includes(`${n} of ${n}`), timing.caption);
  check("viewer: steps are smooth (p95 under 50 ms to the next frame)", timing.p95 < 50,
    `mean ${timing.mean.toFixed(1)} ms, p95 ${timing.p95.toFixed(1)} ms, max ${timing.max.toFixed(1)} ms, ${timing.longTasks} long tasks`);

  // Clicking the Win% graph jumps to that move (the plot spans ply 0 to n between the y axis and the right edge).
  const graph = await page.$(".v-graph .chart-box");
  await graph.scrollIntoViewIfNeeded();
  const gb = await graph.boundingBox();
  await page.mouse.move(gb.x + 32 + (gb.width - 42) / 2, gb.y + gb.height / 2);
  await page.mouse.down();
  await page.mouse.up();
  // Recharts runs chart click handlers on the next animation frame.
  await page.waitForFunction((last) => !document.querySelector(".board-cap")?.textContent?.includes(last), `${n} of ${n}`,
    { timeout: 2000 }).catch(() => {});
  const jumped = await page.textContent(".board-cap");
  const at = Number(/(\d+) of /.exec(jumped ?? "")?.[1]);
  check("viewer: clicking the graph's middle jumps to the middle move", Math.abs(at - n / 2) <= 2, jumped ?? "");

  // Explore: the live engine answers with lines, labelled live (mid-game; this game ends in a 50-move draw,
  // where Explore says so instead of starting the engine).
  await page.keyboard.press("End");
  const ended = await page.click("button.live").then(() => page.textContent(".live-panel"));
  check("explore: the final 50-move position is reported as a draw", /fifty-move rule/.test(ended ?? ""), "");
  await page.goto(`${base}/games/${LONG_GAME}?ply=100`);
  await page.waitForSelector(".moves .mv");
  await page.click("button.live");
  const lines = await page.waitForSelector(".live-line", { timeout: 20000 }).then(() => true, () => false);
  const label = await page.textContent(".live-panel .card-head");
  const isolated = await page.evaluate(() => crossOriginIsolated);
  check("explore: live lines appear", lines, `${label?.trim()} · crossOriginIsolated=${isolated}`);
  if (shots) await page.screenshot({ path: join(shots, "explore-1280-dark.png"), fullPage: true });
  await ctx.close();

  // Explore from the start by tapping squares, on a host without COOP/COEP (the single-threaded engine).
  const plain = await plainServer();
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const phone = await ctx2.newPage();
  await phone.goto(`${plain.url}/games/${LONG_GAME}?ply=0`);
  await phone.waitForSelector(".moves .mv");
  await phone.click("button.live");
  await phone.click(`[id="game-${LONG_GAME}-square-e2"]`);
  await phone.click(`[id="game-${LONG_GAME}-square-e4"]`);
  const playedOk = await phone.waitForSelector(".live-panel .pill.san", { timeout: 5000 }).then((e) => e.textContent(), () => null);
  const single = await phone.waitForSelector(".live-line", { timeout: 30000 }).then(() => true, () => false);
  const engine = await phone.textContent(".live-panel .card-head");
  const isolated2 = await phone.evaluate(() => crossOriginIsolated);
  check("explore: tap e2 then e4 plays 1. e4", playedOk === "1. e4", String(playedOk));
  check("explore without COOP/COEP: single-threaded engine gives lines", single && !isolated2 && /1 thread/.test(engine ?? ""),
    `${engine?.trim()} · crossOriginIsolated=${isolated2}`);
  if (shots) await phone.screenshot({ path: join(shots, "explore-390-dark.png"), fullPage: true });
  await ctx2.close();
  plain.server.close();
} finally {
  await browser.close();
  server?.kill();
}

const failed = results.filter((r) => !r.ok);
for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
console.log(`\n${results.length - failed.length} of ${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
