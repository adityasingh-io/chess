// "Convert the win" positions and the per-device record of how each went (src/pages/Convert.tsx).
import type { Side } from "./chess";
import { day } from "./format";
import type { ThrownEntry } from "../types/export";

export const WINNING = 80;   // as the "Threw away a win" flag: Win% at least this before the move
const RESULTS_KEY = "coach-convert-v1";

export type Start = { id: string; fen: string; colour: Side; title: string; thrown?: ThrownEntry };
export type Tally = { tries: number; wins: number; last: number };

export const startId = (t: Pick<ThrownEntry, "game" | "ply">) => `thrown-${t.game}-${t.ply}`;

/** Thrown wins that start from a stored position with my Win% at least WINNING, newest first. */
export function thrownStarts(thrown: ThrownEntry[]): Start[] {
  return thrown
    .filter((t) => t.fen && t.ply && t.win_before != null && t.win_before >= WINNING)
    .sort((a, b) => b.ts - a.ts)
    .map((t) => ({ id: startId(t), fen: t.fen!, colour: t.colour, title: `${day(t.ts)} · vs ${t.opponent}`, thrown: t }));
}

// A missing or blocked localStorage just means nothing is remembered.
export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function writeJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* not remembered */ }
}

export const readTally = () => readJson<{ [id: string]: Tally }>(RESULTS_KEY, {});
export const writeTally = (t: { [id: string]: Tally }) => writeJson(RESULTS_KEY, t);
