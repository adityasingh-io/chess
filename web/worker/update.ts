// The "Fetch new games" button's backend: a Cloudflare Worker (wrangler.toml beside it; docs/DEPLOY.md).
//   GET  /status  the chess.com games newer than the site's data, and the latest nightly run on GitHub
//   POST /update  starts the nightly workflow, only when chess.com has a game the site doesn't and no
//                 update is running or publishing
// There's no sign-in: the most a stranger could do is start an update for a real new game a little before
// the nightly would. The GitHub token (a Worker secret) can only read and run this repo's Actions.

export interface Env {
  GITHUB_TOKEN?: string;
  REPO: string;           // owner/name
  WORKFLOW: string;       // the nightly's file name
  PLAYER: string;         // chess.com username
  TIME_CLASSES: string;   // comma-separated, as [player] time_classes in config.toml
  SITE: string;           // the published app, ending in /
  ORIGINS: string;        // comma-separated origins allowed to call this
}

export interface Waiting { id: string; url: string; end: number }
export interface Run { status: string; conclusion: string | null; started: number; finished: number; url: string }
export interface Status { waiting: Waiting[]; run: Run | null; error?: string }
export interface Started { started: boolean; reason?: "running" | "publishing" | "none" | "no-token"; status: Status }

// After a nightly finishes, publishing to Pages takes a minute or two; don't start another meanwhile.
const PUBLISHING_SECONDS = 600;
const AGENT = "chess-coach update worker (+https://github.com/adityasingh-io/chess)";

async function json<T>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "User-Agent": AGENT, ...init.headers } });
  if (!r.ok) throw new Error(`${new URL(url).host}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

const github = (env: Env, path: string, init: RequestInit = {}) => fetch(`https://api.github.com/repos/${env.REPO}${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json",
             "X-GitHub-Api-Version": "2022-11-28", "User-Agent": AGENT },
});

interface ArchiveGame {
  url: string; end_time: number; time_class: string; rules: string; pgn?: string;
  white: { username: string }; black: { username: string };
}

/** Games in the last two chess.com monthly archives that the pipeline would take and the site doesn't have. */
async function waiting(env: Env): Promise<Waiting[]> {
  const site = await json<{ games: { id: string; start_ts: number }[] }>(`${env.SITE}data/games/index.json?t=${Date.now()}`,
    { cache: "no-store" });
  const have = new Set(site.games.map((g) => g.id));
  const latest = Math.max(0, ...site.games.map((g) => g.start_ts));
  const base = `https://api.chess.com/pub/player/${env.PLAYER.toLowerCase()}`;
  const { archives } = await json<{ archives: string[] }>(`${base}/games/archives`);
  const months = await Promise.all(archives.slice(-2).map((u) => json<{ games: ArchiveGame[] }>(u)));
  const classes = env.TIME_CLASSES.split(",").map((c) => c.trim());
  return months.flatMap((m) => m.games)
    .filter((g) => g.rules === "chess" && g.pgn && classes.includes(g.time_class) && g.end_time > latest)
    .map((g) => ({ id: g.url.split("/").pop() ?? "", url: g.url, end: g.end_time }))
    .filter((g) => g.id && !have.has(g.id))
    .sort((a, b) => a.end - b.end);
}

interface GitHubRun { status: string; conclusion: string | null; run_started_at?: string; created_at: string; updated_at: string; html_url: string }

async function latestRun(env: Env): Promise<Run | null> {
  const r = await github(env, `/actions/workflows/${env.WORKFLOW}/runs?per_page=1`);
  if (!r.ok) throw new Error(`GitHub: HTTP ${r.status}`);
  const run = ((await r.json()) as { workflow_runs: GitHubRun[] }).workflow_runs[0];
  const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  return run ? { status: run.status, conclusion: run.conclusion, started: at(run.run_started_at ?? run.created_at),
                 finished: at(run.updated_at), url: run.html_url } : null;
}

export async function status(env: Env): Promise<Status> {
  const [games, run] = await Promise.allSettled([waiting(env), env.GITHUB_TOKEN ? latestRun(env) : Promise.resolve(null)]);
  const failed = (p: PromiseSettledResult<unknown>) =>
    p.status === "rejected" ? (p.reason instanceof Error ? p.reason.message : String(p.reason)) : null;
  const errors = [failed(games), failed(run)].filter((e): e is string => !!e);
  if (!env.GITHUB_TOKEN) errors.push("the GitHub token isn't set");
  return { waiting: games.status === "fulfilled" ? games.value : [], run: run.status === "fulfilled" ? run.value : null,
           ...(errors.length ? { error: errors.join("; ") } : {}) };
}

export async function start(env: Env, now = Date.now() / 1000): Promise<Started> {
  const s = await status(env);
  if (!env.GITHUB_TOKEN) return { started: false, reason: "no-token", status: s };
  if (s.error) throw new Error(s.error);
  if (s.run && s.run.status !== "completed") return { started: false, reason: "running", status: s };
  if (!s.waiting.length) return { started: false, reason: "none", status: s };
  if (s.run?.conclusion === "success" && now - s.run.finished < PUBLISHING_SECONDS) return { started: false, reason: "publishing", status: s };
  const r = await github(env, `/actions/workflows/${env.WORKFLOW}/dispatches`, { method: "POST", body: JSON.stringify({ ref: "main" }) });
  if (!r.ok) throw new Error(`GitHub: HTTP ${r.status} starting the update`);
  const run: Run = { status: "queued", conclusion: null, started: Math.floor(now), finished: Math.floor(now),
                     url: `https://github.com/${env.REPO}/actions/workflows/${env.WORKFLOW}` };
  return { started: true, status: { ...s, run } };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origins = env.ORIGINS.split(",").map((o) => o.trim());
    const origin = request.headers.get("Origin") ?? "";
    const cors = {
      "Access-Control-Allow-Origin": origins.includes(origin) ? origin : origins[0],
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
    const reply = (body: unknown, code = 200) =>
      new Response(JSON.stringify(body), { status: code, headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const path = new URL(request.url).pathname;
    try {
      if (request.method === "GET" && path === "/status") return reply(await status(env));
      if (request.method === "POST" && path === "/update") return reply(await start(env));
    } catch (e) {
      return reply({ error: e instanceof Error ? e.message : String(e) }, 502);
    }
    return reply({ error: "not found" }, 404);
  },
};
