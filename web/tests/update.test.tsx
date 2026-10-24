// The "Fetch new games" Worker and the card that drives it, against stubbed chess.com, site and GitHub.
import { act, fireEvent, render, screen } from "@testing-library/react";
import worker, { start, status, type Env, type Status } from "../worker/update";

const ENV: Env = {
  GITHUB_TOKEN: "test", REPO: "me/chess", WORKFLOW: "nightly.yml", PLAYER: "Me", TIME_CLASSES: "rapid",
  SITE: "https://site.test/chess/", ORIGINS: "https://site.test,http://localhost:5173",
};
const game = (id: string, end: number, extra = {}) => ({
  url: `https://www.chess.com/game/live/${id}`, end_time: end, time_class: "rapid", rules: "chess", pgn: "1. e4 *",
  white: { username: "Me" }, black: { username: "Them" }, ...extra,
});

type RunRow = { status: string; conclusion: string | null; created_at: string; updated_at: string; html_url: string };
function stubWorld(runs: RunRow[] = [], archive = [game("1", 1100), game("2", 2000), game("3", 2100, { time_class: "blitz" }),
                                                  game("4", 2200, { rules: "chess960" })]) {
  const dispatched: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    const ok = (body: unknown, code = 200) => new Response(JSON.stringify(body), { status: code });
    if (url.startsWith("https://site.test/chess/data/games/index.json")) return ok({ games: [{ id: "1", start_ts: 1000 }] });
    if (url.endsWith("/pub/player/me/games/archives")) return ok({ archives: ["https://api.chess.com/a/09", "https://api.chess.com/a/10"] });
    if (url === "https://api.chess.com/a/09") return ok({ games: [] });
    if (url === "https://api.chess.com/a/10") return ok({ games: archive });
    if (url.endsWith("/actions/workflows/nightly.yml/runs?per_page=1")) return ok({ workflow_runs: runs });
    if (url.endsWith("/actions/workflows/nightly.yml/dispatches") && init?.method === "POST") {
      dispatched.push(String(init.body));
      return new Response(null, { status: 204 });
    }
    return ok({ message: "not found" }, 404);
  }));
  return dispatched;
}
const iso = (s: number) => new Date(s * 1000).toISOString();
const done = (finished: number, conclusion = "success"): RunRow =>
  ({ status: "completed", conclusion, created_at: iso(finished - 120), updated_at: iso(finished), html_url: "https://github.com/run/1" });

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("status lists only the standard games in the configured time class that the site doesn't have", async () => {
  stubWorld();
  const s = await status(ENV);
  expect(s.waiting.map((w) => w.id)).toEqual(["2"]);
  expect(s.error).toBeUndefined();
  const none = await status({ ...ENV, GITHUB_TOKEN: undefined });
  expect(none.run).toBeNull();
  expect(none.error).toMatch(/GitHub token/);
});

test("the update starts only for a new game, with nothing running or publishing", async () => {
  const now = 10_000;
  let sent = stubWorld([done(now - 3600)]);
  expect((await start(ENV, now)).started).toBe(true);
  expect(sent).toEqual([JSON.stringify({ ref: "main" })]);

  sent = stubWorld([{ ...done(now), status: "in_progress", conclusion: null }]);
  expect(await start(ENV, now)).toMatchObject({ started: false, reason: "running" });
  sent = stubWorld([done(now - 60)]);
  expect(await start(ENV, now)).toMatchObject({ started: false, reason: "publishing" });
  sent = stubWorld([done(now - 60, "failure")]);
  expect((await start(ENV, now)).started).toBe(true);
  sent = stubWorld([done(now - 3600)], [game("1", 1100)]);
  expect(await start(ENV, now)).toMatchObject({ started: false, reason: "none" });
  expect(sent).toEqual([]);
  expect(await start({ ...ENV, GITHUB_TOKEN: undefined }, now)).toMatchObject({ started: false, reason: "no-token" });
});

test("the 5-minute check starts the update for a game no run has seen, and leaves seen ones to the button", async () => {
  const now = 10_000;   // game 2 ended at 2000; a run starts 120 s before it finishes
  let sent = stubWorld([done(1500)]);
  expect((await start(ENV, now, true)).started).toBe(true);
  sent = stubWorld([done(3000)]);   // started 880 s after the game ended, and the site still lacks it
  expect(await start(ENV, now, true)).toMatchObject({ started: false, reason: "seen" });
  expect(sent).toEqual([]);
  expect((await start(ENV, now)).started).toBe(true);
  sent = stubWorld([done(2200, "failure")]);   // started 80 s after it ended: chess.com may not have listed it yet
  expect((await start(ENV, now, true)).started).toBe(true);

  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  sent = stubWorld([done(1500)]);
  await worker.scheduled(null, ENV);
  expect(sent).toHaveLength(1);
  expect(log).toHaveBeenCalledWith("started the update for 2");
  log.mockRestore();
});

test("the Worker answers the app's origin, and only its two routes", async () => {
  stubWorld();
  const options = await worker.fetch(new Request("https://w.test/update", { method: "OPTIONS", headers: { Origin: "http://localhost:5173" } }), ENV);
  expect(options.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
  const s = await worker.fetch(new Request("https://w.test/status", { headers: { Origin: "https://evil.test" } }), ENV);
  expect(s.headers.get("Access-Control-Allow-Origin")).toBe("https://site.test");
  expect(((await s.json()) as Status).waiting).toHaveLength(1);
  expect((await worker.fetch(new Request("https://w.test/other"), ENV)).status).toBe(404);
});

test("the card starts an update, follows it and offers the new game once it's published", async () => {
  vi.stubEnv("VITE_UPDATE_URL", "https://w.test");
  vi.resetModules();
  const { default: UpdateCard } = await import("../src/components/UpdateCard");
  const now = Math.floor(Date.now() / 1000);
  const waiting = [{ id: "2", url: "https://www.chess.com/game/live/2", end: now - 100 }];
  let current: Status = { waiting, run: { status: "completed", conclusion: "success", started: now - 90_000, finished: now - 86_000, url: "https://github.com/run/0" } };
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    if (String(input).endsWith("/update") && init?.method === "POST") {
      current = { waiting, run: { status: "queued", conclusion: null, started: now, finished: now, url: "https://github.com/run/1" } };
      return new Response(JSON.stringify({ started: true, status: current }));
    }
    return new Response(JSON.stringify(current));
  }));
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await act(async () => { render(<UpdateCard />); });
    expect(await screen.findByText("1 new game on chess.com isn't analysed yet.")).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Fetch new games" })); });
    expect(await screen.findByText(/Stockfish is scoring 1 new game on GitHub/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /Follow it on GitHub/ }).getAttribute("href")).toBe("https://github.com/run/1");
    expect((screen.getByRole("button", { name: "Fetch new games" }) as HTMLButtonElement).disabled).toBe(true);
    // The run finishes and the site publishes the game: the Worker stops listing it.
    current = { waiting: [], run: { status: "completed", conclusion: "success", started: now, finished: now + 200, url: "https://github.com/run/1" } };
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(await screen.findByText("1 new game is in.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show them" })).toBeTruthy();
  } finally {
    vi.useRealTimers();
  }
});
