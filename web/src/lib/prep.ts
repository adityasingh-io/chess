// The prep session before playing a rival (pages/RivalPrep.tsx, PLAN.md reading 26): their likely line against
// each of my colours, the costly moves of theirs in my openings to punish (scored by the pipeline,
// rivals.prep_out), then my key moments against them. Everything it picks is stored data: their moves and counts
// from their tree, mine from my opening tree, the verdicts Stockfish's.
import type { HeadToHead, OpeningReport, Rival, RivalSide } from "../types/export";
import { posKey, replay, sideToMove, type Side } from "./chess";
import { START } from "./lines";

export const LINE_PLIES = 16;   // a likely line runs at most this many plies (8 moves each),
export const LIKELY_MIN = 2;    // and stops before a move of theirs played fewer times than this
export const KEYS_MAX = 4;      // key moments of mine against them: losses first, then the newest

export type LineMove = {
  uci: string; san: string; theirs: boolean;
  games: number; of: number;                    // how often the move was played from that position, out of
  label: string | null; drop: number | null;    // Stockfish's verdict on their moves (pass 1)
};
export type PrepItem =
  | { kind: "line"; you: Side; moves: LineMove[] }
  | { kind: "punish"; index: number }           // into the rival's `prep`
  | { kind: "key"; game: string; ply: number };
export const PART = { line: "Their likely lines", punish: "Punish their moves", key: "Your key moments" } as const;

/** Their most played move at each of their turns, and my most played at each of mine, from the start, while both
    trees have one and theirs was played at least LIKELY_MIN times. */
export function likelyLine(you: Side, theirs: RivalSide, mine: OpeningReport): LineMove[] {
  const them = new Map(theirs.tree.map((n) => [n.key, n]));
  const me = new Map(mine.tree.map((n) => [n.key, n]));
  const out: LineMove[] = [];
  let fen = START;
  while (out.length < LINE_PLIES) {
    const key = posKey(fen);
    let next: LineMove | null = null;
    if (sideToMove(fen) === you) {
      const n = me.get(key), m = n?.moves[0];
      if (n && m) next = { uci: m.uci, san: m.san, theirs: false, games: m.games, of: n.games, label: null, drop: null };
    } else {
      const n = them.get(key), m = n?.moves[0];
      if (n && m && m.games >= LIKELY_MIN) next = { uci: m.uci, san: m.san, theirs: true, games: m.games, of: n.games, label: m.label, drop: m.drop };
    }
    const after = next ? replay(fen, [next.uci])[0] : undefined;
    if (!next || !after) break;
    out.push(next);
    fen = after;
  }
  return out;
}

/** The session, in order: a likely line per colour (when it has their move and mine), every prep position, then
    my key moments against them. */
export function prepPlan(h: HeadToHead, r: Rival, mine: { [c in Side]: OpeningReport }): PrepItem[] {
  const items: PrepItem[] = [];
  for (const you of ["white", "black"] as const) {
    const moves = likelyLine(you, you === "white" ? r.black : r.white, mine[you]);
    if (moves.some((m) => m.theirs) && moves.some((m) => !m.theirs)) items.push({ kind: "line", you, moves });
  }
  r.prep.forEach((_, index) => items.push({ kind: "punish", index }));
  const keyed = h.games.filter((g) => g.key_ply != null);
  const order = [...keyed.filter((g) => g.result === "loss"), ...keyed.filter((g) => g.result !== "loss")];
  for (const g of order.slice(0, KEYS_MAX)) items.push({ kind: "key", game: g.id, ply: g.key_ply! });
  return items;
}

/** The parts of a plan, in order, with how many steps each has and how many are behind `at`. */
export function prepSections(items: PrepItem[], at: number) {
  const out: { part: PrepItem["kind"]; from: number; count: number; done: number }[] = [];
  items.forEach((x, i) => {
    const last = out.at(-1);
    if (last?.part === x.kind) last.count += 1;
    else out.push({ part: x.kind, from: i, count: 1, done: 0 });
    if (i < at) out.at(-1)!.done += 1;
  });
  return out;
}

/** A trainer line id for a likely line (FNV-1a of the rival, my colour and the moves). */
export function prepLineId(rival: string, you: Side, ucis: readonly string[]) {
  let h = 0x811c9dc5;
  for (const c of `${rival.toLowerCase()}:${you}:${ucis.join(" ")}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return `v-${(h >>> 0).toString(36)}`;
}
