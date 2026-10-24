// Which puzzles a session shows, and in what order: due reviews first (longest overdue first), then
// puzzles never tried. My own come newest game first; Lichess ones nearest my puzzle level first.
import type { Puzzle } from "../types/export";
import { endOfToday, isDue, type Progress } from "./progress";

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

/** A drill for one tag: mine first, then Lichess puzzles of the same kind to fill the session. */
export function drillQueue(tag: string, mine: Puzzle[], lichess: Puzzle[], p: Progress): Puzzle[] {
  const same = lichess.filter(hasTag(tag));
  const own = queue(mine.filter(hasTag(tag)), p, byNewestGame, same.length ? MINE_IN_DRILL : SESSION);
  return [...own, ...queue(same, p, byLevel(p.level), SESSION - own.length)];
}

/** Every puzzle due by the end of today, from both sets. */
export function dueQueue(all: Puzzle[], p: Progress, tag = ""): Puzzle[] {
  const until = endOfToday();
  return all.filter((z) => isDue(p.items[z.id], until) && hasTag(tag)(z)).sort((a, b) => p.items[a.id].card.due - p.items[b.id].card.due);
}

export const dueIds = (p: Progress, kind: "puzzle" | "line" = "puzzle", until = endOfToday()) =>
  Object.entries(p.items).filter(([, item]) => item.kind === kind && item.card.due <= until).map(([id]) => id);
