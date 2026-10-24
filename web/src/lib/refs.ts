// Moves and squares named in an explanation, found so they can be shown on the board (rules-level, chess.js).
// The text is a template filled from stored Stockfish lines (src/coach/why.py), so each move it names is a move
// of one of those lines: it's looked up there first, then tried in the position after the move named just
// before it ("Your Kf1 …; Stockfish answers Nd2+"). A square after "on" ("the knight on f6") is a square.
import { Chess } from "chess.js";
import type { ArrowKind, Peek } from "../components/Board";
import { sideToMove, uciParts, type Side } from "./chess";

/** A stored line the text may name moves from: its start position, its moves, and the arrow colour per ply. */
export type RefLine = { fen: string; ucis: readonly string[]; kind: (ply: number) => ArrowKind };
export type Segment = string | { text: string; peek: Peek };

const TOKEN = /\b(?:O-O-O|O-O|[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8](?:=[QRBN])?)[+#]?/g;
const bare = (san: string) => san.replace(/[+#]$/, "");

type Entry = { fen: string; uci: string; san: string; after: string; kind: ArrowKind };

function entries(lines: RefLine[]): Entry[] {
  const out: (Entry & { ply: number; li: number })[] = [];
  lines.forEach((line, li) => {
    let board: Chess;
    try { board = new Chess(line.fen); } catch { return; }
    for (const [ply, uci] of line.ucis.entries()) {
      const fen = board.fen();
      try {
        const m = board.move(uciParts(uci));
        out.push({ fen, uci, san: m.san, after: board.fen(), kind: line.kind(ply), ply, li });
      } catch { break; /* the line stops replaying here */ }
    }
  });
  // Earlier plies first: the text names first moves and their answers more than moves deep in a line.
  return out.sort((a, b) => a.ply - b.ply || a.li - b.li);
}

/** `san` played from `fen`, if it's legal there. */
function tryIn(fen: string, san: string) {
  try {
    const board = new Chess(fen);
    const m = board.move(san);
    return { uci: m.from + m.to + (m.promotion ?? ""), after: board.fen() };
  } catch {
    return null;
  }
}

/** The text split into plain strings and the moves and squares it names. `me` colours chained moves (mine in
    Stockfish's colour, theirs grey). */
export function segments(text: string, lines: RefLine[], me?: Side): Segment[] {
  const known = entries(lines);
  const out: Segment[] = [];
  let at = 0, cursor: string | null = null;
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0], i = match.index;
    const square = /^[a-h][1-8]$/.test(token);
    let peek: Peek | null = null;
    if (square && /\bon $/.test(text.slice(Math.max(0, i - 3), i))) {
      peek = { squares: [token] };
    } else {
      const e = known.find((x) => x.san === token) ?? known.find((x) => bare(x.san) === bare(token));
      const chained: { uci: string; after: string } | null = !e && cursor ? tryIn(cursor, bare(token)) : null;
      if (e) {
        peek = { fen: e.fen, uci: e.uci, kind: e.kind };
        cursor = e.after;
      } else if (chained && cursor) {
        peek = { fen: cursor, uci: chained.uci, kind: me && sideToMove(cursor) === me ? "best" : "them" };
        cursor = chained.after;
      } else if (square) {
        peek = { squares: [token] };
      }
    }
    if (!peek) continue;
    if (i > at) out.push(text.slice(at, i));
    out.push({ text: token, peek });
    at = i + token.length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Arrow colours along a line of Stockfish's from a position where I'm to move: its moves for me, then theirs. */
export const bestKinds = (ply: number): ArrowKind => (ply % 2 === 0 ? "best" : "them");
/** My move, then Stockfish's line after it. */
export const myKinds = (ply: number): ArrowKind => (ply === 0 ? "you" : ply % 2 === 0 ? "best" : "them");
/** A move of theirs (the one before mine). */
export const theirKinds = (): ArrowKind => "them";
