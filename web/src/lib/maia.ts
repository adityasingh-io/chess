// Maia-2 (CSSLab, MIT licence): a network trained on Lichess rapid games that predicts the move a player of a
// given rating would make. It only picks the bot's moves in Play on; it never scores, labels or suggests a
// best move (Stockfish does all of that). This file is the rules-level part, tested against recorded Maia-2
// output (tests/fixtures/maia.json): the move list the network's outputs index, the board encoding, and the
// rating buckets. The network itself runs in maia.worker.ts.
import { Chess } from "chess.js";

const FILES = "abcdefgh";
const name = (sq: number) => FILES[sq % 8] + String(Math.floor(sq / 8) + 1);

function targets(sq: number, steps: [number, number][], slide: boolean): number[] {
  const out: number[] = [];
  const f0 = sq % 8, r0 = Math.floor(sq / 8);
  for (const [df, dr] of steps) {
    for (let f = f0 + df, r = r0 + dr; f >= 0 && f < 8 && r >= 0 && r < 8; f += df, r += dr) {
      out.push(r * 8 + f);
      if (!slide) break;
    }
  }
  return out.sort((a, b) => b - a);
}

const QUEEN: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT: [number, number][] = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

/** The 1,880 moves Maia-2's output indexes, in its order: from each square a1…h8, a queen's moves then a
    knight's on an empty board (highest target square first), then White's promotions from the 7th rank. */
export const MOVES: readonly string[] = (() => {
  const out: string[] = [];
  for (let sq = 0; sq < 64; sq++) {
    for (const t of targets(sq, QUEEN, true)) out.push(name(sq) + name(t));
    for (const t of targets(sq, KNIGHT, false)) out.push(name(sq) + name(t));
  }
  for (let f = 0; f < 8; f++) {
    for (const to of [f, f - 1, f + 1]) {
      if (to < 0 || to > 7) continue;
      for (const p of "qrbn") out.push(`${FILES[f]}7${FILES[to]}8${p}`);
    }
  }
  return out;
})();
const INDEX = new Map(MOVES.map((m, i) => [m, i]));

/** Maia-2's rating bucket for a Lichess rapid rating: under 1100, then 100-point steps, then 2000 and up. */
export const category = (lichess: number) => (lichess < 1100 ? 0 : lichess >= 2000 ? 10 : 1 + Math.floor((lichess - 1100) / 100));

/** The same position seen from the side to move (Black's positions are flipped top to bottom with the colours
    swapped, as Maia-2 is trained only on White to move). */
const mirrorSquare = (sq: string) => sq[0] + String(9 - Number(sq[1]));
const mirrorMove = (uci: string) => mirrorSquare(uci.slice(0, 2)) + mirrorSquare(uci.slice(2, 4)) + uci.slice(4);

const PIECES = "pnbrqk";
export type Encoded = { planes: Float32Array; legal: number[]; flipped: boolean };

/** The network's input for `fen`: 18 planes of 8×8 (White's pieces, Black's pieces, side to move, the four
    castling rights, the en passant square), plus the indexes of the legal moves. */
export function encode(fen: string): Encoded {
  const board = new Chess(fen);
  const [, turn, castling, ep] = fen.split(" ");
  const flipped = turn === "b";
  const planes = new Float32Array(18 * 64);
  const at = (plane: number, sq: string) => {
    const s = flipped ? mirrorSquare(sq) : sq;
    planes[plane * 64 + (Number(s[1]) - 1) * 8 + FILES.indexOf(s[0])] = 1;
  };
  for (const row of board.board()) {
    for (const p of row) {
      if (!p) continue;
      const white = (p.color === "w") !== flipped;
      at(PIECES.indexOf(p.type) + (white ? 0 : 6), p.square);
    }
  }
  planes.fill(1, 12 * 64, 13 * 64);   // White to move, after the flip
  const rights = flipped ? ["k", "q", "K", "Q"] : ["K", "Q", "k", "q"];
  rights.forEach((r, i) => { if (castling.includes(r)) planes.fill(1, (13 + i) * 64, (14 + i) * 64); });
  if (ep && ep !== "-") at(17, ep);
  const legal = board.moves({ verbose: true })
    .map((m) => INDEX.get(flipped ? mirrorMove(m.from + m.to + (m.promotion ?? "")) : m.from + m.to + (m.promotion ?? "")))
    .filter((i): i is number => i != null);
  return { planes, legal, flipped };
}

export type Choice = { uci: string; p: number };

/** The legal moves by the network's probability (a softmax over the legal moves only), most likely first. */
export function ranked(logits: Float32Array, enc: Encoded): Choice[] {
  const top = Math.max(...enc.legal.map((i) => logits[i]));
  const exp = enc.legal.map((i) => Math.exp(logits[i] - top));
  const sum = exp.reduce((a, b) => a + b, 0);
  return enc.legal
    .map((i, k) => ({ uci: enc.flipped ? mirrorMove(MOVES[i]) : MOVES[i], p: exp[k] / sum }))
    .sort((a, b) => b.p - a.p);
}
