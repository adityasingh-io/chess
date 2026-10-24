"""Explanation text, generated from stored engine facts by templates (BRIEF.md: no free-form judgement).

Every move, evaluation and material number in the text is filled in from the record.
"""

from __future__ import annotations

import chess

from coach.model import Record
from coach.why import mistake_why

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
    """What kind of mistake it was and the scores, then what each line does on the board (why.py)."""
    move = r.ply.move
    me = r.ply.white
    san = move["san"]
    best = move_san(move["fen_before"], r.best_line[0] if r.best_line else None)
    best_eval = eval_text(r.before_top, me)
    after_eval = eval_text(r.after_top, me, r.after_terminal)
    better = f" Best was {best} ({best_eval})." if best else ""
    if r.primary == "allowed_mate":
        n = -(r.after_top["mate"] if me else -r.after_top["mate"])
        head = f"{san} allowed mate in {n}.{better}"
    elif r.primary == "hung_piece":
        head = f"{san} hung material: you end {r.net_after:+d} in material.{better}"
    elif r.primary == "tactic":
        head = f"{san} walked into {SUBTYPE_NAMES.get(r.subtype, 'a tactic')}: you end {r.net_after:+d} in material.{better}"
    elif r.primary == "missed_mate":
        head = f"You had {best_eval} with {best}. {san} gives {after_eval}."
    elif r.primary == "missed_win":
        what = "won material outright" if r.subtype == "free_material" else f"won material with {SUBTYPE_NAMES.get(r.subtype, 'a tactic')}"
        head = f"{best} {what}, ending {r.net_best:+d} for you. {san} gives {after_eval}."
    else:
        head = f"{san} dropped your Win% from {r.ply.win_before:.0f} to {r.ply.win_after:.0f}.{better}"
    measured = why(r)
    return f"{head} {measured}" if measured else head


def why(r: Record) -> str:
    """What the best move and my move do on the board along Stockfish's two lines (why.py)."""
    move, n = r.ply.move, r.ply.number
    prev = r.game.plies[n - 2].move if n >= 2 else None
    return mistake_why(move["fen_before"], move["uci"], r.best_line, r.reply_line,
                       chess.WHITE if r.ply.white else chess.BLACK, max(len(r.best_line), len(r.reply_line)),
                       (prev["fen_before"], prev["uci"]) if prev else None)
