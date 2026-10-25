// "Play it out" positions (src/pages/PlayOut.tsx) and the per-device record of how each went.
import type { Side } from "./chess";
import { day } from "./format";
import type { EndgameGame, LossEntry, ThrownEntry } from "../types/export";

export const WINNING = 80;    // as "Threw away a win" (config.toml): my Win% at least this before the move
export const PLAYABLE = 40;   // as "Gave up while playable" (config.toml): my Win% at least this at the end
export const ENDGAME_WINNING = 70;   // as the endgame bands (config.toml): winning at least this,
export const ENDGAME_LOSING = 30;    // losing at most this
const RESULTS_KEY = "coach-playout-v1";

export type Kind = "thrown" | "resigned" | "endgame" | "mate";
export type Start = {
  id: string; kind: Kind; fen: string; colour: Side; title: string;
  win: number | null;          // my stored Win% in the start position (pass 1)
  need: "win" | "draw";        // the goal: a win, or a draw or better
  thrown?: ThrownEntry; loss?: LossEntry; endgame?: EndgameGame;
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
                   title: `${day(t.ts)} · vs ${t.opponent}`, win: t.win_before, need: "win", thrown: t }));
}

/** Losses I resigned or abandoned while still playable, from the position the game ended in, newest first. */
export function resignedStarts(losses: LossEntry[]): Start[] {
  return losses
    .filter((l) => l.cause === "gave_up")
    .sort((a, b) => b.ts - a.ts)
    .map((l) => ({ id: resignedId(l.game), kind: "resigned", fen: l.final_fen, colour: l.colour,
                   title: `${day(l.ts)} · vs ${l.opponent}`, win: l.final_win, need: "draw", loss: l }));
}

/** Spoiled endgames from the position before the spoiling move, newest first: a win to play for where my Win% there
    was winning, a draw or better where it was balanced; left out where it was already losing. One that is also a
    thrown win keeps that position's id, so both lists share its record. */
export function endgameStarts(endgames: EndgameGame[], thrown: ThrownEntry[]): Start[] {
  const same = new Set(thrown.map((t) => `${t.game}:${t.ply}`));
  return endgames
    .filter((e) => e.spoiler_fen && e.info.spoiler_ply && e.spoiler_win != null && e.spoiler_win > ENDGAME_LOSING)
    .sort((a, b) => b.ts - a.ts)
    .map((e) => {
      const ply = e.info.spoiler_ply!, thrown = same.has(`${e.game}:${ply}`);   // also a win that got away: one start, one goal
      return { id: thrown ? thrownId(e.game, ply) : endgameId(e.game, ply), kind: "endgame",
               fen: e.spoiler_fen!, colour: e.colour, title: `${day(e.ts)} · vs ${e.opponent}`, win: e.spoiler_win,
               need: thrown || e.spoiler_win! >= ENDGAME_WINNING ? "win" : "draw", endgame: e };
    });
}
export const endgameId = (game: string, ply: number) => `endgame-${game}-${ply}`;

/** A win reaches a "win" goal; a draw or a win reaches a "draw" goal. */
export const reached = (need: Start["need"], result: "win" | "draw" | "loss") => (need === "draw" ? result !== "loss" : result === "win");

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
/** One more try at a position, and whether it reached its goal; returns the whole record. */
export function recordTry(id: string, ok: boolean) {
  const all = readTally(), t = all[id] ?? { tries: 0, reached: 0, last: 0 };
  const next = { ...all, [id]: { tries: t.tries + 1, reached: t.reached + (ok ? 1 : 0), last: Date.now() } };
  writeTally(next);
  return next;
}

const SKILL_KEY = "coach-playout-skill";
export const SKILLS: [number, string][] = [[20, "Full strength"], [10, "Skill 10 of 20"], [3, "Skill 3 of 20"]];
/** Stockfish's skill level for playing on, as last picked on the Play it out page. */
export const readSkill = () => readJson<number>(SKILL_KEY, 10);
export const writeSkill = (s: number) => writeJson(SKILL_KEY, s);
