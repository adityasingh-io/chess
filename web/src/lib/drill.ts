// Which puzzles a session shows, and in what order: due reviews first (longest overdue first), then
// puzzles never tried. My own come newest game first; Lichess ones nearest my puzzle level first.
import type { Game, Puzzle } from "../types/export";
import { endOfToday, grade, isDue, Rating, rateLevel, type Attempt, type Kind, type Progress } from "./progress";

export const SESSION = 10;
export const MINE_IN_DRILL = 5;     // a leak drill: up to this many of mine, the rest from Lichess

export const byNewestGame = (a: Puzzle, b: Puzzle) => Number(b.game) - Number(a.game) || (a.ply ?? 0) - (b.ply ?? 0);
export const byLevel = (level: number) => (a: Puzzle, b: Puzzle) =>
  Math.abs((a.rating ?? level) - level) - Math.abs((b.rating ?? level) - level) || a.id.localeCompare(b.id);

export const hasTag = (tag: string) => (z: Puzzle) => !tag || z.tags.includes(tag);

export function queue(puzzles: Puzzle[], p: Progress, order: (a: Puzzle, b: Puzzle) => number, limit = SESSION,
                      until = endOfToday()): Puzzle[] {
  const due = puzzles.filter((z) => isDue(p.items[z.id], until)).sort((a, b) => p.items[a.id].card.due - p.items[b.id].card.due);
  const fresh = puzzles.filter((z) => !p.items[z.id]).sort(order);
  return [...due, ...fresh].slice(0, limit);
}

/** A drill for one tag: mine first, then Lichess puzzles of the same kind to fill the session (`size` puzzles, mine
    up to the same share of them as MINE_IN_DRILL is of a full session). */
export function drillQueue(tag: string, mine: Puzzle[], lichess: Puzzle[], p: Progress, size = SESSION): Puzzle[] {
  const same = lichess.filter(hasTag(tag));
  const own = queue(mine.filter(hasTag(tag)), p, byNewestGame, same.length ? Math.round((size * MINE_IN_DRILL) / SESSION) : size);
  return [...own, ...queue(same, p, byLevel(p.level), size - own.length)];
}

/** Every puzzle due by the end of today, from both sets. */
export function dueQueue(all: Puzzle[], p: Progress, tag = ""): Puzzle[] {
  const until = endOfToday();
  return all.filter((z) => isDue(p.items[z.id], until) && hasTag(tag)(z)).sort((a, b) => p.items[a.id].card.due - p.items[b.id].card.due);
}

/** Puzzles whose latest answer wasn't clean (missed, or solved with a hint or a wrong try), latest first. Solving
    one cleanly takes it off the list. */
export function missed(p: Progress): Attempt[] {
  const latest = new Map<string, Attempt>();
  for (const a of p.attempts) if (a.kind === "puzzle" && (latest.get(a.id)?.at ?? -1) <= a.at) latest.set(a.id, a);
  return [...latest.values()].filter((a) => a.grade < Rating.Good).sort((a, b) => b.at - a.at);
}

export const dueIds = (p: Progress, kind: Kind = "puzzle", until = endOfToday()) =>
  Object.entries(p.items).filter(([, item]) => item.kind === kind && item.card.due <= until).map(([id]) => id);

/** How an answer went: solved (or not), wrong tries, whether Hint was used, and whether the answer was shown. */
export type Outcome = { solved: boolean; wrong: number; hint: boolean; revealed: boolean };

export const gradeOf = (o: Outcome) =>
  o.revealed || o.wrong >= 2 ? Rating.Again : o.wrong || o.hint ? Rating.Hard : Rating.Good;

/** A puzzle answered: its next review, and my puzzle level from a Lichess one solved cleanly or not. */
export function recordPuzzle(z: Puzzle, o: Outcome) {
  grade(z.id, "puzzle", gradeOf(o), z.tags);
  if (z.source === "lichess" && z.rating != null) rateLevel(z.rating, o.solved && !o.wrong && !o.hint);
}

/** A game's key moment, as a progress item: one per game and move. */
export const keyId = (game: string, ply: number) => `k-${game}-${ply}`;
export const keyGame = (id: string) => id.split("-")[1];

/** A game's key moment answered: its next review. */
export function recordKey(g: Game, o: Outcome) {
  const r = g.records.find((x) => x.id === g.key!.record);
  grade(keyId(g.id, g.key!.ply), "key", gradeOf(o), r?.tags ?? []);
}
