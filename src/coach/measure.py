"""Scorekeeping on the board: material counts along Stockfish's lines. Describes, never judges."""

from __future__ import annotations

import chess

PIECE_VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}


def material(board: chess.Board, color: chess.Color) -> int:
    return sum(len(board.pieces(piece, color)) * value for piece, value in PIECE_VALUES.items())


def balance(board: chess.Board, color: chess.Color) -> int:
    """color's material minus the opponent's."""
    return material(board, color) - material(board, not color)


def play_line(board: chess.Board, pv: list[str], plies: int) -> chess.Board:
    """A copy of board with up to `plies` moves of the line played (stops at an illegal move)."""
    board = board.copy(stack=False)
    for uci in pv[:plies]:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            break
        board.push(move)
    return board


def net_material(reference: chess.Board, start: chess.Board, pv: list[str], plies: int, color: chess.Color) -> int:
    """color's material balance at the end of the line from `start`, minus its balance in `reference`."""
    return balance(play_line(start, pv, plies), color) - balance(reference, color)
