"""Position keys and rules-level facts about positions (python-chess only, no judgement)."""

from __future__ import annotations

import chess


def position_key(board: chess.Board) -> str:
    """FEN without the move counters; the en passant square only when a capture is legal."""
    return board.epd(en_passant="legal")


def board_from_key(key: str) -> chess.Board:
    """A board with no move history: the engine sees the position, not how it was reached."""
    return chess.Board(f"{key} 0 1")


def terminal_outcome(board: chess.Board) -> str | None:
    """'white' or 'black' if that side has delivered checkmate, 'draw' for a rules draw, else None.

    Without move history, repetition and move-count draws can't be detected; only positional ones.
    """
    if board.is_checkmate():
        return "black" if board.turn == chess.WHITE else "white"
    if board.is_stalemate() or board.is_insufficient_material():
        return "draw"
    return None
