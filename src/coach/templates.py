"""Explanation text, generated from stored engine facts by templates (BRIEF.md: no free-form judgement).

Every move, evaluation and material number in the text is filled in from the record.
"""

from __future__ import annotations

import chess

from coach.model import Record

SUBTYPE_NAMES = {
    "fork": "a fork", "pin": "a pin", "skewer": "a skewer", "discovered_attack": "a discovered attack",
    "double_check": "a double check", "other": "a tactic", "free_material": "free material",
}


def line_san(fen: str, line: list[str], plies: int | None = None) -> str:
    """'12. Nxe5 dxe5 13. Qh5' from a full FEN (so move numbers are right). Stops at an illegal move."""
    board = chess.Board(fen)
    moves = []
    for uci in line[:plies]:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            break
        moves.append(move)
        board.push(move)
    return chess.Board(fen).variation_san(moves) if moves else ""


def move_san(fen: str, uci: str | None) -> str | None:
    if not uci:
        return None
    board = chess.Board(fen)
    move = chess.Move.from_uci(uci)
    return board.san(move) if move in board.legal_moves else None


def eval_text(line: dict | None, white: bool, terminal: str | None = None) -> str:
    """Stockfish's score from my point of view: '+1.4', 'mate in 3', 'mated in 2'."""
    if terminal == "draw":
        return "a draw"
    if terminal:
        return "checkmate" if (terminal == "white") == white else "checkmated"
    if not line:
        return "?"
    if line.get("mate") is not None:
        n = line["mate"] if white else -line["mate"]
        return f"mate in {n}" if n > 0 else f"mated in {-n}"
    cp = line["cp"] if white else -line["cp"]
    return f"{cp / 100:+.1f}"


def explain(r: Record) -> str:
    move = r.ply.move
    me = r.ply.white
    san = move["san"]
    best = move_san(move["fen_before"], r.best_line[0] if r.best_line else None)
    best_line = line_san(move["fen_before"], r.best_line)
    reply = line_san(move["fen_after"], r.reply_line)
    best_eval = eval_text(r.before_top, me)
    after_eval = eval_text(r.after_top, me, r.after_terminal)
    better = f" Best was {best} ({best_eval})." if best else ""
    if r.primary == "allowed_mate":
        n = -(r.after_top["mate"] if me else -r.after_top["mate"])
        return f"{san} allowed mate in {n}: Stockfish's line is {reply}.{better}"
    if r.primary == "hung_piece":
        return (f"{san} hung material: Stockfish's line is {reply}, and you end {r.net_after:+d} in material."
                f"{better}")
    if r.primary == "tactic":
        return (f"{san} walked into {SUBTYPE_NAMES.get(r.subtype, 'a tactic')}: Stockfish's line is {reply}, "
                f"and you end {r.net_after:+d} in material.{better}")
    if r.primary == "missed_mate":
        return f"You had {best_eval}: {best_line}. {san} gives {after_eval}."
    if r.primary == "missed_win":
        what = "won material outright" if r.subtype == "free_material" else f"won material with {SUBTYPE_NAMES.get(r.subtype, 'a tactic')}"
        return f"{best} {what}: Stockfish's line is {best_line}, ending {r.net_best:+d} for you. {san} gives {after_eval}."
    text = f"{san} dropped your Win% from {r.ply.win_before:.0f} to {r.ply.win_after:.0f}.{better}"
    return f"{text} Stockfish's line: {best_line}." if best_line else text
