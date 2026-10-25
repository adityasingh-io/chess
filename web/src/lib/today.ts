// Today: one fixed session started from Home (pages/Today.tsx). In order: the key moments of my newest games not
// tried yet, puzzles on the two causes that decided most of my recent losses, the reviews due today, and one winning
// position from a game that got away, to win again. Once the session starts its plan is fixed for the day and kept on
// this device, so a reload carries on where it stopped. Everything it picks is stored data: loss causes are the pipeline's (Why I
// lost, from Stockfish's scores), and the puzzles, key moments and positions are the exports'.
import type { GameSummary, Losses, Puzzle, PuzzleIndex } from "../types/export";
import { drillQueue, dueQueue, keyId, type Outcome } from "./drill";
import { dayStart, endOfToday, type Progress } from "./progress";
import { readJson, writeJson, type Start, type Tally } from "./playout";

export const KEYS_MAX = 3;        // key moments a day, from
export const KEY_GAMES = 10;      // this many of my newest games
export const DRILL = [3, 2];      // puzzles on the top two causes (all five on one, when there's one)
export const REVIEWS_MAX = 5;     // reviews due today
const KEY = "coach-today-v1";

/** Loss causes a puzzle trains: one move whose Stockfish line loses material or allows mate, or misses a win. A
    quiet mistake, the clock, giving up and being outplayed aren't. */
export const DRILLABLE = ["hung_piece", "allowed_mate", "tactic", "missed_mate", "missed_win"];

/** The drillable causes of my losses that have puzzles, most losses in the last 30 days first, then all time. */
export function losingTags(losses: Pick<Losses, "causes" | "causes_30_days">, index: PuzzleIndex): string[] {
  const recent = losses.causes_30_days, all = losses.causes;
  return DRILLABLE
    .filter((t) => (all[t] ?? 0) > 0 && (index.mine[t] ?? 0) + (index.lichess[t] ?? 0) > 0)
    .sort((a, b) => (recent[b] ?? 0) - (recent[a] ?? 0) || (all[b] ?? 0) - (all[a] ?? 0));
}

/** A step of the session. A puzzle with a tag is from the drill on it; one without is a review. */
export type Item =
  | { kind: "key"; game: string; ply: number; due?: boolean }
  | { kind: "puzzle"; id: string; tag?: string }
  | { kind: "play"; id: string };
/** How a step went: solved without help, with help (a hint or a wrong try), missed or shown, or skipped. */
export type Mark = "clean" | "help" | "missed" | "skipped";
export type Plan = { day: number; items: Item[]; at: number; marks: (Mark | null)[] };
export const PART = { key: "Key moments", drill: "Drill", review: "Reviews", play: "Win it again" } as const;

export const markOf = (o: Outcome): Mark => (!o.solved ? "missed" : o.wrong || o.hint ? "help" : "clean");

/** Key moments of my newest games that have one and that I haven't tried, newest first. */
export function newKeys(games: GameSummary[], p: Progress) {
  return games.slice(0, KEY_GAMES).filter((g) => g.key_ply != null && !p.items[keyId(g.id, g.key_ply)]).slice(0, KEYS_MAX);
}

/** Key moments due today that are still their games' key moments, longest overdue first. */
export function dueKeys(games: GameSummary[], p: Progress, until = endOfToday()) {
  const current = new Set(games.flatMap((g) => (g.key_ply != null ? [keyId(g.id, g.key_ply)] : [])));
  return Object.entries(p.items)
    .filter(([id, item]) => item.kind === "key" && item.card.due <= until && current.has(id))
    .sort((a, b) => a[1].card.due - b[1].card.due);
}

/** Today's plan from the data and my progress: what a session has when it starts. */
export function makePlan(games: GameSummary[], p: Progress, tags: string[], mine: Puzzle[], lichess: Puzzle[],
                         wins: Start[], tally: { [id: string]: Tally }, now = Date.now()): Plan {
  const items: Item[] = newKeys(games, p).map((g) => ({ kind: "key", game: g.id, ply: g.key_ply! }));
  const taken = new Set<string>();
  const drill = tags.slice(0, DRILL.length);
  drill.forEach((tag, i) => {
    const size = drill.length === 1 ? DRILL.reduce((a, b) => a + b) : DRILL[i];
    // The drill is puzzles never tried; one due today is a review, whatever its kind.
    const free = (z: Puzzle) => !taken.has(z.id) && !p.items[z.id];
    for (const z of drillQueue(tag, mine.filter(free), lichess.filter(free), p, size)) {
      taken.add(z.id);
      items.push({ kind: "puzzle", id: z.id, tag });
    }
  });
  const until = endOfToday();
  const reviews: { item: Item; due: number }[] = [
    ...dueQueue([...mine, ...lichess], p).map((z) => ({ item: { kind: "puzzle", id: z.id } as Item, due: p.items[z.id].card.due })),
    ...dueKeys(games, p, until).map(([id, item]) => {
      const [, game, ply] = id.split("-");
      return { item: { kind: "key", game, ply: Number(ply), due: true } as Item, due: item.card.due };
    }),
  ];
  items.push(...reviews.sort((a, b) => a.due - b.due).slice(0, REVIEWS_MAX).map((r) => r.item));
  // The win to win again: from a game whose key moment isn't in this session, when there's one.
  const keyGames = new Set(items.flatMap((x) => (x.kind === "key" ? [x.game] : [])));
  const open = wins.filter((s) => !tally[s.id]?.reached);
  const win = open.find((s) => !keyGames.has(s.thrown?.game ?? "")) ?? open[0];
  if (win) items.push({ kind: "play", id: win.id });
  return { day: dayStart(now), items, at: 0, marks: items.map(() => null) };
}

/** Today's plan as this device left it, if it was started today. One not started yet is made afresh, with the newest
    data. */
export function readPlan(now = Date.now()): Plan | null {
  const p = readJson<Plan | null>(KEY, null);
  return p && p.day === dayStart(now) && Array.isArray(p.items) && Array.isArray(p.marks) && typeof p.at === "number"
    && (p.at > 0 || p.marks.some(Boolean)) ? p : null;
}
export const savePlan = (p: Plan) => writeJson(KEY, p);

/** The parts of a plan, in order, with how many steps each has and how many are done. */
export function sections(plan: Plan) {
  const name = (x: Item) => (x.kind === "key" ? (x.due ? "review" : "key") : x.kind === "puzzle" ? (x.tag ? "drill" : "review") : "play");
  const out: { part: "key" | "drill" | "review" | "play"; from: number; count: number; done: number }[] = [];
  plan.items.forEach((x, i) => {
    const part = name(x);
    const last = out.at(-1);
    if (last?.part === part) last.count += 1;
    else out.push({ part, from: i, count: 1, done: 0 });
    if (i < plan.at) out.at(-1)!.done += 1;
  });
  return out;
}
