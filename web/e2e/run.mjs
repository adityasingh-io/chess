// End-to-end check of the acceptance so far: every page at phone and desktop width in both themes (no
// console errors, no sideways scroll), the numbers on screen match the exports, a 250-ply game steps
// smoothly, the arrow buttons step the game, a comparison and Explore, Explore gets live lines from the
// in-browser engine, a drill session from a leak works on a phone (Phase 5), and the training pages open
// offline once the service worker is in.
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
import { Chess } from "chess.js";
import { chromium } from "playwright-core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const shotsAt = process.argv.indexOf("--shots");
const shots = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const data = (p) => JSON.parse(readFileSync(join(root, "public/data", p), "utf8"));
const summary = data("summary.json");
const LONG_GAME = process.env.E2E_GAME ?? "164948678288";
const longGame = data(`games/${LONG_GAME}.json`);
const retryGame = data("games/index.json").games.find((g) => g.puzzles > 0);

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

// Board positions as piece codes by square ("e2": "wP"): expected ones from chess.js, shown ones read from
// react-chessboard's DOM (squares carry data-square, pieces data-piece).
const fenAfter = (fen, ucis) => {
  const c = new Chess(fen);
  for (const u of ucis) c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
  return c.fen();
};
const placementOf = (fen) => Object.fromEntries(new Chess(fen).board().flat().filter(Boolean)
  .map((p) => [p.square, p.color + p.type.toUpperCase()]));
const boardOn = (page, id) => page.evaluate((id) => Object.fromEntries(
  [...document.querySelectorAll(`[id^="${id}-square-"]`)].map((sq) => [sq.getAttribute("data-square"), sq.querySelector("[data-piece]")?.getAttribute("data-piece")])
    .filter(([, p]) => p)), id);
const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const PAGES = [
    { path: "/", name: "dashboard", ready: ".big" },
    { path: "/leaks", name: "leaks", ready: ".leak" },
    { path: "/leaks/hung_piece", name: "leak-detail", ready: ".pos .board" },
    { path: "/games", name: "games", ready: ".game-row" },
    { path: `/games/${LONG_GAME}`, name: "viewer", ready: ".moves .mv" },
    { path: `/games/${LONG_GAME}?ply=${longGame.records[0].ply}&compare=1`, name: "compare", ready: ".cmp-side .board" },
    { path: "/openings/white", name: "openings-white", ready: ".tree-board .board" },
    { path: "/openings/black", name: "openings-black", ready: ".tree-board .board" },
    { path: "/endgames", name: "endgames", ready: ".eg" },
    { path: "/insights", name: "insights", ready: ".grows" },
    { path: "/puzzles", name: "puzzles", ready: ".puzzle .board" },
    { path: "/puzzles?drill=hung_piece", name: "drill", ready: ".puzzle .board" },
    { path: "/trainer", name: "trainer", ready: ".line-row" },
    { path: "/play", name: "play-it-out", ready: ".playout-row" },
    { path: `/puzzles?game=${retryGame.id}`, name: "retry-game", ready: ".puzzle .board" },
    { path: "/settings", name: "settings", ready: ".card h2" },
    { path: "/more", name: "more", ready: ".rows" },
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
  for (const colour of ["white", "black"]) {
    const report = data(`openings/${colour}.json`);
    await page.goto(`${base}/openings/${colour}`);
    await page.waitForSelector(".tree-info .facts");
    const facts = await page.textContent(".tree-info .facts");
    check(`openings ${colour}: root games and score match`, facts.includes(`${report.tree[0].games} games`) &&
      facts.includes(`${report.tree[0].score.toFixed(1)}%`), facts);
    const fams = await page.$$eval(".fam", (els) => els.length);
    check(`openings ${colour}: every family listed`, fams === report.families.length, `${fams} vs ${report.families.length}`);
    const leaks = await page.$$eval(".positions .pos", (els) => els.length);
    check(`openings ${colour}: every leak card shown`, leaks === report.leaks.length, `${leaks} vs ${report.leaks.length}`);
  }
  const endgames = data("endgames.json");
  await page.goto(`${base}/endgames`);
  await page.waitForSelector(".eg");
  const all = await page.textContent(".eg tr.total td:last-child");
  check("endgames: total matches", Number(all) === endgames.endgames.length, `${all} vs ${endgames.endgames.length}`);
  const insights = data("insights.json");
  await page.goto(`${base}/insights`);
  await page.waitForSelector(".grows");
  const lost = await page.textContent("text=games in all");
  check("insights: time-loss count matches", lost.includes(`${insights.time_losses.count} games`), lost);

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

  // The arrow buttons, clicked quickly, end on the right position, and the eval bar shows the stored score.
  await page.goto(`${base}/games/${LONG_GAME}?ply=0`);
  await page.waitForSelector(".moves .mv");
  for (let i = 0; i < 12; i++) await page.click('button[aria-label^="Next move"]');
  for (let i = 0; i < 4; i++) await page.click('button[aria-label^="Previous move"]');
  await page.waitForTimeout(400);
  const at8 = placementOf(fenAfter(longGame.initial_fen, longGame.moves.slice(0, 8).map((m) => m.uci)));
  const cap8 = await page.textContent(".board-cap");
  check("viewer: ▶ ×12 then ◀ ×4 shows move 8", same(await boardOn(page, `game-${LONG_GAME}`), at8) && cap8.includes(`8 of ${n}`), cap8);
  const bar8 = await page.$eval(".v-board .evalbar", (e) => ({ win: e.dataset.win, text: e.textContent }));
  check("viewer: the eval bar shows the stored Win% and score", bar8.win === longGame.moves[7].win.toFixed(1) && bar8.text,
    `${bar8.win} "${bar8.text}" vs ${longGame.moves[7].win}`);

  // Compare: two boards side by side, stepped together; Next goes to the next mistake.
  const rec = longGame.records[0];
  await page.goto(`${base}/games/${LONG_GAME}?ply=${rec.ply}&compare=1`);
  await page.waitForSelector(".cmp-side .board");
  const sides = await page.$$eval(".cmp-side", (els) => els.map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width }; }));
  check("compare 1280px: the two boards sit side by side", sides.length === 2 && sides.every((b) => b.w > 250) &&
    Math.abs(sides[0].y - sides[1].y) < 2 && sides[1].x >= sides[0].x + sides[0].w, JSON.stringify(sides));
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(400);
  const youOk = same(await boardOn(page, `game-${LONG_GAME}-you`), placementOf(fenAfter(rec.fen, [rec.uci, ...rec.reply_line].slice(0, 3))));
  const bestOk = same(await boardOn(page, `game-${LONG_GAME}-best`), placementOf(fenAfter(rec.fen, rec.best_line.slice(0, 3))));
  check("compare: → ×3 steps both lines to their third move", youOk && bestOk, `your line ${youOk}, best line ${bestOk}`);
  if (shots) await page.screenshot({ path: join(shots, "compare-1280-dark.png"), fullPage: true });
  await page.click('button[title="Your next mistake in this game"]');
  const head = await page.textContent(".cmp-head");
  check("compare: Next opens the next mistake before its move", /mistake 2 of/.test(head) && /before the move/.test(head), head);
  await page.keyboard.press("Escape");
  check("compare: Esc goes back to the game", !(await page.$(".cmp")) && !!(await page.$(".v-board .board")), "");

  // A leak's position card steps its line with ▶.
  await page.goto(`${base}/leaks/hung_piece`);
  await page.waitForSelector(".pos .board");
  const card = page.locator(".pos").first();
  const boardId = (await card.locator('[id$="-square-a1"]').getAttribute("id")).replace(/-square-a1$/, "");
  const before = await boardOn(page, boardId);
  await card.getByRole("button", { name: "Forward a move" }).click();
  await card.getByRole("button", { name: "Forward a move" }).click();
  await page.waitForTimeout(400);
  const pressedChip = await card.locator('.chips button[aria-pressed="true"]').textContent();
  const secondChip = await card.locator(".chips button").nth(1).textContent();
  check("leaks: ▶ steps a position's line on its board", pressedChip === secondChip && !same(before, await boardOn(page, boardId)),
    `${pressedChip} vs ${secondChip}`);

  // Explore: the live engine answers with lines, labelled live (mid-game; this game ends in a 50-move draw,
  // where Explore says so instead of starting the engine).
  await page.goto(`${base}/games/${LONG_GAME}?ply=0`);
  await page.waitForSelector(".moves .mv");
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

  // Phase 5 acceptance: on a phone, a leak's "Drill these" opens a session; tapping the solution solves the
  // first puzzle (my newest with that tag) and stores its review on the device. Then, with the service
  // worker in control, the puzzle and trainer pages open offline.
  {
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
    const ph = await pctx.newPage();
    const errs = [];
    ph.on("pageerror", (e) => errs.push(String(e)));
    await ph.goto(`${base}/leaks/hung_piece`);
    await ph.click('.drill-actions a:has-text("Drill these")');
    await ph.waitForSelector(".puzzle .board");
    const z = data("puzzles/mine.json").puzzles.filter((p) => p.tags.includes("hung_piece"))
      .sort((a, b) => Number(b.game) - Number(a.game) || (a.ply ?? 0) - (b.ply ?? 0))[0];
    const heading = await ph.textContent("h1");
    const shownFirst = same(await boardOn(ph, `pz-${z.id}`), placementOf(z.fen));
    for (let i = 0; i < z.solution.length; i += 2) {
      if (i) await ph.waitForFunction(() => document.querySelector(".puzzle-task")?.textContent?.includes("Keep going"), null, { timeout: 4000 });
      await ph.click(`[id="pz-${z.id}-square-${z.solution[i].slice(0, 2)}"]`);
      await ph.click(`[id="pz-${z.id}-square-${z.solution[i].slice(2, 4)}"]`);
    }
    const result = await ph.waitForSelector(".puzzle-result", { timeout: 6000 }).then((e) => e.textContent(), () => null);
    const stored = await ph.evaluate((id) => JSON.parse(localStorage.getItem("coach-progress-v1") ?? "{}").items?.[id] ?? null, z.id);
    check("drill 390px: Drill these opens the leak's session at my newest puzzle", heading === "Drill: Hung a piece" && shownFirst, heading ?? "");
    check("drill 390px: tapping the solution solves it", result === "Solved.", String(result));
    check("drill 390px: the review is stored on the device", stored?.kind === "puzzle" && stored.card.due > Date.now(),
      stored ? `next review ${new Date(stored.card.due).toISOString().slice(0, 10)}` : "nothing stored");
    if (shots) await ph.screenshot({ path: join(shots, "drill-solved-390-dark.png"), fullPage: true });
    await ph.click('button:has-text("Next puzzle")');
    const next = await ph.textContent(".puzzle-card h2");
    check("drill 390px: Next goes on to puzzle 2", next === "Puzzle 2 of 10", next);
    check("drill 390px: no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
    // The trainer on a phone: a new leak line is shown first (the arrow and why); playing it learns the line.
    {
      const line = data("repertoire.json").lines.find((l) => l.source === "leak");
      await ph.goto(`${base}/trainer`);
      await ph.click(`.line-row button.t:has-text(${JSON.stringify(line.name)})`);
      const why = await ph.waitForSelector(".step-why", { timeout: 6000 }).then((e) => e.textContent(), () => "");
      const wide = await ph.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      check("trainer 390px: a new line shows its move and why, with no sideways scroll",
        why.includes(`Why ${line.san[line.start]}`) && wide <= 0, `${why.slice(0, 80)} · overflow ${wide}px`);
      const uci = line.moves[line.start];
      await ph.click(`[id="line-${line.id}-square-${uci.slice(0, 2)}"]`);
      await ph.click(`[id="line-${line.id}-square-${uci.slice(2, 4)}"]`);
      const learned = await ph.waitForSelector(".puzzle-result", { timeout: 6000 }).then((e) => e.textContent(), () => null);
      const rows = await ph.$$eval(".line-why li", (li) => li.length);
      check("trainer 390px: playing the arrow's move learns it, then every move is listed with its reason",
        learned === "Line learned." && rows === line.moves.length, `${learned} · ${rows} of ${line.moves.length} moves`);
      if (shots) await ph.screenshot({ path: join(shots, "trainer-learned-390-dark.png"), fullPage: true });
    }
    if (!process.argv.includes("--dev")) {
      const controlled = await ph.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15000 }).then(() => true, () => false);
      // Installing caches the shell and the training data; give it a moment to finish.
      await ph.evaluate(() => navigator.serviceWorker.ready);
      await ph.waitForTimeout(1500);
      await pctx.setOffline(true);
      const offline = [];
      for (const [path, ready] of [["/puzzles", ".puzzle .board"], ["/trainer", ".line-row"], ["/", ".big"]]) {
        await ph.goto(base + path).catch(() => {});
        offline.push(await ph.waitForSelector(ready, { timeout: 8000 }).then(() => path, () => `${path} FAILED`));
      }
      await pctx.setOffline(false);
      check("offline: puzzles, trainer and dashboard open with no network", controlled && offline.every((p) => !p.includes("FAILED")),
        `controlled=${controlled}; ${offline.join(", ")}`);
    }
    await pctx.close();
  }

  // Play it out on a phone: a mating-practice position against the in-browser Stockfish. My move is
  // played, Stockfish answers with a legal move of its own, and stopping records a try on the device.
  {
    const cctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" });
    const cp = await cctx.newPage();
    const errs = [];
    cp.on("pageerror", (e) => errs.push(String(e)));
    await cp.goto(`${base}/play?play=mate-queen`);
    await cp.waitForSelector('[id="playout-mate-queen-square-a1"]');
    await cp.click('[id="playout-mate-queen-square-a1"]');
    await cp.click('[id="playout-mate-queen-square-a4"]');
    const moves = await cp.waitForFunction(() => {
      const t = document.querySelector(".playout-moves")?.textContent ?? "";
      return t.split(/\s+/).length >= 3 ? t : null;
    }, null, { timeout: 15000 }).then((h) => h.jsonValue(), () => null);
    // The reply animates; wait for the king to leave d5 on the board too.
    await cp.waitForFunction(() => !document.querySelector('[id="playout-mate-queen-square-d5"] [data-piece="bK"]'), null, { timeout: 3000 }).catch(() => {});
    const board = await boardOn(cp, "playout-mate-queen");
    const kingMoved = board.d5 !== "bK" && Object.values(board).includes("bK");
    check("play it out 390px: my move is played and Stockfish replies", !!moves?.startsWith("1. Qa4") && kingMoved, String(moves));
    await cp.click('button:has-text("Stop")');
    const tally = await cp.evaluate(() => JSON.parse(localStorage.getItem("coach-playout-v1") ?? "{}")["mate-queen"] ?? null);
    check("play it out 390px: stopping records a try on the device", tally?.tries === 1 && tally?.reached === 0, JSON.stringify(tally));
    check("play it out 390px: no page errors", errs.length === 0, errs.slice(0, 2).join(" | "));
    if (shots) await cp.screenshot({ path: join(shots, "play-it-out-390-dark.png"), fullPage: true });
    await cctx.close();
  }

  // Explore from the start by tapping squares, on a host without COOP/COEP (the single-threaded engine).
  const plain = await plainServer();
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  const phone = await ctx2.newPage();
  // Compare on a phone: one board at a time, with a switch.
  await phone.goto(`${plain.url}/games/${LONG_GAME}?ply=${rec.ply}&compare=1`);
  await phone.waitForSelector(".cmp-side .board");
  const shown = () => phone.$$eval(".cmp-side", (els) => els.map((e) => e.getBoundingClientRect().width > 0));
  const firstShown = await shown();
  await phone.click('.cmp-pick button:has-text("Stockfish")');
  const thenShown = await shown();
  check("compare 390px: one board at a time, switched by You / Stockfish", firstShown.join() === "true,false" && thenShown.join() === "false,true",
    `${firstShown} then ${thenShown}`);
  if (shots) await phone.screenshot({ path: join(shots, "compare-390-dark.png"), fullPage: true });
  await phone.goto(`${plain.url}/games/${LONG_GAME}?ply=0`);
  await phone.waitForSelector(".moves .mv");
  await phone.click("button.live");
  await phone.click(`[id="game-${LONG_GAME}-square-e2"]`);
  await phone.click(`[id="game-${LONG_GAME}-square-e4"]`);
  const playedOk = await phone.waitForSelector(".live-panel .played button.san", { timeout: 5000 }).then((e) => e.textContent(), () => null);
  const single = await phone.waitForSelector(".live-line", { timeout: 30000 }).then(() => true, () => false);
  const engine = await phone.textContent(".live-panel .card-head");
  const isolated2 = await phone.evaluate(() => crossOriginIsolated);
  check("explore: tap e2 then e4 plays 1. e4", playedOk === "1. e4", String(playedOk));
  check("explore without COOP/COEP: single-threaded engine gives lines", single && !isolated2 && /1 thread/.test(engine ?? ""),
    `${engine?.trim()} · crossOriginIsolated=${isolated2}`);
  const liveBar = await phone.waitForSelector(".v-board .evalbar.live", { timeout: 10000 }).then(() => true, () => false);
  check("explore: the eval bar shows the live score", liveBar, "");
  if (shots) await phone.screenshot({ path: join(shots, "explore-390-dark.png"), fullPage: true });
  // In Explore ◀ takes a move back and ▶ plays it again.
  await phone.click('button[aria-label^="Take back a move"]');
  await phone.waitForTimeout(400);
  const backOk = same(await boardOn(phone, `game-${LONG_GAME}`), placementOf(longGame.initial_fen));
  const redo = await phone.$$eval(".live-panel .played button.redo", (els) => els.map((e) => e.textContent).join());
  await phone.click('button[aria-label^="Play the next move again"]');
  await phone.waitForTimeout(400);
  const fwdOk = same(await boardOn(phone, `game-${LONG_GAME}`), placementOf(fenAfter(longGame.initial_fen, ["e2e4"])));
  check("explore: ◀ takes 1. e4 back and ▶ plays it again", backOk && redo === "1. e4" && fwdOk, `back ${backOk}, redo "${redo}", forward ${fwdOk}`);
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
