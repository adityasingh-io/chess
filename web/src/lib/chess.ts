// Rules-level board work only (chess.js): replaying stored moves and lines, and checking legality in
// Explore. Nothing here judges a move.
import { Chess, type Square } from "chess.js";

export type Side = "white" | "black";

export const uciParts = (uci: string) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });

/** FEN after each UCI move from `fen`. Stops at the first move that isn't legal (a broken export). */
export function replay(fen: string, ucis: readonly string[]): string[] {
  const board = new Chess(fen);
  const out: string[] = [];
  for (const uci of ucis) {
    try { board.move(uciParts(uci)); } catch { break; }
    out.push(board.fen());
  }
  return out;
}

/** UCI line → SAN list, for the live engine's lines. Stops at the first illegal move. */
export function lineSan(fen: string, ucis: readonly string[], limit = ucis.length): string[] {
  const board = new Chess(fen);
  const out: string[] = [];
  for (const uci of ucis.slice(0, limit)) {
    try { out.push(board.move(uciParts(uci)).san); } catch { break; }
  }
  return out;
}

/** Numbered SAN for a line starting at `fen`: ["14…Rb6", "15. Qa5", "Rb8"]. */
export function numberedLine(fen: string, sans: readonly string[]): string[] {
  const [, turn, , , , full] = fen.split(" ");
  let no = Number(full) || 1, white = turn !== "b";
  return sans.map((san, i) => {
    const label = white ? `${no}. ${san}` : i === 0 ? `${no}…${san}` : san;
    if (!white) no += 1;
    white = !white;
    return label;
  });
}

/** A position's key as the pipeline writes it (python-chess EPD): the FEN without its move counters. chess.js,
    like python-chess, writes the en passant square only when the capture is legal. */
export const posKey = (fen: string) => fen.split(" ").slice(0, 4).join(" ");

export const sideToMove = (fen: string): Side => (fen.split(" ")[1] === "b" ? "black" : "white");

/** Try a move in Explore; a pawn reaching the last rank becomes a queen unless `promotion` says otherwise.
    Returns the move, or null if it isn't legal. */
export function tryMove(fen: string, from: string, to: string, promotion?: string) {
  const board = new Chess(fen);
  const piece = board.get(from as Square);
  const lastRank = to[1] === "8" || to[1] === "1";
  try {
    const m = board.move({ from, to, promotion: piece?.type === "p" && lastRank ? promotion || "q" : undefined });
    return { uci: m.from + m.to + (m.promotion ?? ""), san: m.san, fen: board.fen() };
  } catch {
    return null;
  }
}

/** Squares a piece on `from` can legally move to (for tap-to-move highlights). */
export function targets(fen: string, from: string): string[] {
  try {
    return new Chess(fen).moves({ square: from as Square, verbose: true }).map((m) => m.to);
  } catch {
    return [];
  }
}

/** Pieces other than kings that the other side attacks and their own side doesn't defend, by colour. A count
    of attackers and defenders on the board, like python-chess's: pins aren't considered. */
export function hanging(fen: string): { square: string; side: Side }[] {
  let board: Chess;
  try { board = new Chess(fen); } catch { return []; }
  const out: { square: string; side: Side }[] = [];
  for (const row of board.board()) {
    for (const p of row) {
      if (!p || p.type === "k") continue;
      const them = p.color === "w" ? "b" : "w";
      if (board.isAttacked(p.square, them) && !board.isAttacked(p.square, p.color)) {
        out.push({ square: p.square, side: p.color === "w" ? "white" : "black" });
      }
    }
  }
  return out;
}

/** The legal move that leads from `before` to `after`, if one does (stepping one move along a game or a line).
    Compares piece placement, side to move and castling rights. */
export function moveBetween(before: string, after: string) {
  const key = (f: string) => f.split(" ").slice(0, 3).join(" ");
  try {
    const board = new Chess(before);
    for (const m of board.moves({ verbose: true })) {
      board.move(m);
      const same = key(board.fen()) === key(after);
      board.undo();
      if (same) return { san: m.san, capture: m.isCapture() || m.isEnPassant(), castle: m.isKingsideCastle() || m.isQueensideCastle(),
        check: m.san.endsWith("+"), mate: m.san.endsWith("#"), promotion: m.isPromotion() };
    }
  } catch { /* not a position chess.js reads */ }
  return null;
}

/** The same position with the other side to move, for "what would they play if it were their move?" (the
    threat). Null when the side to move is in check: passing would leave the king in check. */
export function passTurn(fen: string): string | null {
  try {
    if (new Chess(fen).inCheck()) return null;
    const f = fen.split(" ");
    const next = new Chess([f[0], f[1] === "w" ? "b" : "w", f[2], "-", "0", f[5] ?? "1"].join(" "));
    return next.fen();
  } catch {
    return null;
  }
}

/** Game over in this position, by the rules (no engine needed): "Checkmate", "Stalemate", "Draw" or null. */
export function gameOver(fen: string): string | null {
  const board = new Chess(fen);
  if (board.isCheckmate()) return "Checkmate";
  if (board.isStalemate()) return "Stalemate";
  if (board.isInsufficientMaterial()) return "Draw by insufficient material";
  if (board.isDrawByFiftyMoves()) return "Draw by the fifty-move rule";
  return null;
}

/** Who won, by the rules, if the game is over in this position: a checkmate is won by the side not to move. */
export function outcome(fen: string): Side | "draw" | null {
  const over = gameOver(fen);
  if (!over) return null;
  return over === "Checkmate" ? (sideToMove(fen) === "white" ? "black" : "white") : "draw";
}
