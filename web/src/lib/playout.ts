// "Play it out" positions (src/pages/PlayOut.tsx) and the per-device record of how each went.
import type { Side } from "./chess";
import { day } from "./format";
import type { LossEntry, ThrownEntry } from "../types/export";

export const WINNING = 80;    // as "Threw away a win" (config.toml): my Win% at least this before the move
export const PLAYABLE = 40;   // as "Gave up while playable" (config.toml): my Win% at least this at the end
const RESULTS_KEY = "coach-playout-v1";

export type Kind = "thrown" | "resigned" | "mate";
export type Start = {
  id: string; kind: Kind; fen: string; colour: Side; title: string;
  win: number | null;          // my stored Win% in the start position (pass 1)
  thrown?: ThrownEntry; loss?: LossEntry;
};
export type Tally = { tries: number; reached: number; last: number };

export const thrownId = (game: string, ply: number) => `thrown-${game}-${ply}`;
export const resignedId = (game: string) => `resigned-${game}`;

/** Thrown wins that start from a stored position with my Win% at least WINNING, newest first. */
export function thrownStarts(thrown: ThrownEntry[]): Start[] {
  return thrown
    .filter((t) => t.fen && t.ply && t.win_before != null && t.win_before >= WINNING)
    .sort((a, b) => b.ts - a.ts)
    .map((t) => ({ id: thrownId(t.game, t.ply!), kind: "thrown", fen: t.fen!, colour: t.colour,
                   title: `${day(t.ts)} · vs ${t.opponent}`, win: t.win_before, thrown: t }));
}

/** Losses I resigned or abandoned while still playable, from the position the game ended in, newest first. */
export function resignedStarts(losses: LossEntry[]): Start[] {
  return losses
    .filter((l) => l.cause === "gave_up")
    .sort((a, b) => b.ts - a.ts)
    .map((l) => ({ id: resignedId(l.game), kind: "resigned", fen: l.final_fen, colour: l.colour,
                   title: `${day(l.ts)} · vs ${l.opponent}`, win: l.final_win, loss: l }));
}

/** The goal of each kind: a thrown win or a mate needs a win; a resigned game is saved by not losing. */
export const reached = (kind: Kind, result: "win" | "draw" | "loss") => (kind === "resigned" ? result !== "loss" : result === "win");

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
