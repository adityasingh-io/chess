"""Tactic sub-types, measured on the board along a line Stockfish already chose.

Written from the theme descriptions in Lichess's puzzleTheme.xml (no lichess-puzzler code):
- fork: "a piece attacks two or more opposing pieces simultaneously"
- pin: "a piece is unable to move without revealing an attack on a higher value piece"
- skewer: "a high value piece being attacked, moving out the way, and allowing a lower value piece
  behind it to be captured or attacked, the inverse of a pin"
- discoveredAttack: "moving a piece ... that previously blocked an attack by a long range piece ...
  out of the way of that piece"
- doubleCheck: "checking with two pieces at once"

These describe geometry only (what attacks what, what stands behind what). Whether the line wins
or loses anything is decided elsewhere, by net material along Stockfish's line.
"""

from __future__ import annotations

from dataclasses import dataclass

import chess

# For comparing "higher" and "lower value" pieces; the king outranks everything.
VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100}
SLIDERS = (chess.BISHOP, chess.ROOK, chess.QUEEN)

# Precedence when several apply. Every double check is also a discovered attack, so it goes first.
ORDER = ("double_check", "fork", "pin", "skewer", "discovered_attack")
LICHESS_THEME = {
    "fork": "fork",
    "pin": "pin",
    "skewer": "skewer",
    "discovered_attack": "discoveredAttack",
    "double_check": "doubleCheck",
}


def _value(board: chess.Board, square: chess.Square) -> int:
    return VALUES[board.piece_type_at(square)]


def _behind(board: chess.Board, origin: chess.Square, target: chess.Square) -> chess.Square | None:
    """The first occupied square beyond `target` on the line from `origin` through it."""
    beyond = [
        s for s in chess.SquareSet(chess.ray(origin, target))
        if s not in (origin, target) and target in chess.SquareSet(chess.between(origin, s))
    ]
    beyond.sort(key=lambda s: chess.square_distance(target, s))
    return next((s for s in beyond if board.piece_at(s)), None)


def _x_rays(board: chess.Board, square: chess.Square, side: chess.Color) -> list[tuple[chess.Square, chess.Square]]:
    """(front, back) pairs of opposing pieces lined up on a ray the slider on `square` attacks."""
    piece = board.piece_at(square)
    if piece is None or piece.color != side or piece.piece_type not in SLIDERS:
        return []
    pairs = []
    for front in board.attacks(square) & chess.SquareSet(board.occupied_co[not side]):
        back = _behind(board, square, front)
        if back is not None and board.color_at(back) == (not side):
            pairs.append((front, back))
    return pairs


def _opposing(board: chess.Board) -> chess.SquareSet:
    """Squares of the pieces of the side to move (the opponent of whoever just moved)."""
    return chess.SquareSet(board.occupied_co[board.turn])


def fork_targets(board: chess.Board, move: chess.Move) -> set[chess.Square]:
    """Opposing pieces (pawns not counted) the moved piece attacks, if there are two or more."""
    targets = {s for s in board.attacks(move.to_square) & _opposing(board) if board.piece_type_at(s) != chess.PAWN}
    return targets if len(targets) >= 2 else set()


def discovered_targets(board: chess.Board, move: chess.Move) -> set[chess.Square]:
    """Opposing pieces another long-range piece of the mover now attacks through the square the moved piece left.

    With a discovered check, the moved piece's own targets count too: the check is what lets it take them.
    """
    side = not board.turn
    sliders = board.pieces_mask(chess.BISHOP, side) | board.pieces_mask(chess.ROOK, side) | board.pieces_mask(chess.QUEEN, side)
    unveiled = {
        target
        for square in chess.SquareSet(sliders) if square != move.to_square
        for target in board.attacks(square) & _opposing(board)
        if board.piece_type_at(target) != chess.PAWN and move.from_square in chess.SquareSet(chess.between(square, target))
    }
    if any(board.piece_type_at(t) == chess.KING for t in unveiled):
        unveiled |= set(board.attacks(move.to_square) & _opposing(board))
    return unveiled


def _pins(board: chess.Board, side: chess.Color) -> list[tuple[chess.Square, chess.Square, chess.Square]]:
    """(pinner, pinned, behind) where an opposing piece can't move without exposing a higher value piece."""
    out = []
    for square in chess.SquareSet(board.occupied_co[side]):
        for front, back in _x_rays(board, square, side):
            if _value(board, back) > _value(board, front):
                out.append((square, front, back))
    return out


def pin_targets(board: chess.Board, move: chess.Move) -> set[chess.Square]:
    """Pinned opposing pieces where the moved piece is the pinner or attacks the pinned piece."""
    side = not board.turn
    attacked = board.attacks(move.to_square)
    return {pinned for pinner, pinned, _ in _pins(board, side) if pinner == move.to_square or pinned in attacked}


def skewer_targets(board: chess.Board, move: chess.Move) -> set[chess.Square]:
    """Lower value pieces behind a higher value piece the moved long-range piece attacks."""
    side = not board.turn
    return {back for front, back in _x_rays(board, move.to_square, side) if _value(board, front) > _value(board, back)}


def pin_blocks_recapture(key: KeyMove) -> bool:
    """The mover captures on a square a pinned opposing piece covers, so the pinned piece can't take back.

    Checks the key move itself and each later capture by the same side, with the pins on the board then.
    """
    side = key.before.turn
    if key.before.is_capture(key.move) and any(key.move.to_square in key.after.attacks(p) for _, p, _ in _pins(key.after, side)):
        return True
    board = key.after.copy(stack=False)
    for uci in key.rest:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            return False
        if board.turn == side and board.is_capture(move):
            if any(move.to_square in board.attacks(p) for _, p, _ in _pins(board, side)):
                return True
        board.push(move)
    return False


def captured_later(board: chess.Board, rest: list[str], targets: set[chess.Square]) -> bool:
    """Whether the side that just moved captures one of the target pieces later in the line.

    Targets are followed as they move, so a forked rook that steps away and is taken still counts.
    """
    if not targets:
        return False
    side = not board.turn
    board = board.copy(stack=False)
    tracked = set(targets)
    for uci in rest:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            return False
        if board.turn == side and board.is_capture(move):
            square = move.to_square
            if board.is_en_passant(move):
                square = chess.square(chess.square_file(move.to_square), chess.square_rank(move.from_square))
            if square in tracked:
                return True
        elif move.from_square in tracked:
            tracked = (tracked - {move.from_square}) | {move.to_square}
        board.push(move)
    return False


@dataclass(frozen=True)
class KeyMove:
    before: chess.Board
    move: chess.Move
    after: chess.Board
    rest: list[str]  # the line after the key move


def motifs(key: KeyMove) -> set[str]:
    """Motifs at the key move that the rest of the line goes on to use.

    Double check counts on its own. Fork, skewer and discovered attack need the line to capture a
    piece they target; a pin needs the pinned piece captured, or a capture it can't answer.
    """
    board, move, rest = key.after, key.move, key.rest
    found = {"double_check"} if len(board.checkers()) >= 2 else set()
    for name, targets in (
        ("fork", fork_targets),
        ("pin", pin_targets),
        ("skewer", skewer_targets),
        ("discovered_attack", discovered_targets),
    ):
        if captured_later(board, rest, targets(board, move)):
            found.add(name)
    if "pin" not in found and pin_blocks_recapture(key):
        found.add("pin")
    return found


def subtype(found: set[str]) -> str:
    return next((name for name in ORDER if name in found), "other")


def key_move(board: chess.Board, line: list[str], side: chess.Color, previous: chess.Move | None = None,
             previous_board: chess.Board | None = None) -> KeyMove | None:
    """The first move by `side` in the line that isn't a recapture.

    A recapture is a capture on the square the previous move captured on. `previous` is the move
    played just before the line starts (on `previous_board`), if any. If every move by `side` is a
    recapture, the first one is used.
    """
    board = board.copy(stack=False)
    captured_on = previous.to_square if previous and previous_board and previous_board.is_capture(previous) else None
    first = None
    for i, uci in enumerate(line):
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            break
        capture = board.is_capture(move)
        recapture = capture and captured_on == move.to_square
        before = board.copy(stack=False)
        board.push(move)
        if before.turn == side:
            found = KeyMove(before, move, board.copy(stack=False), line[i + 1:])
            if not recapture:
                return found
            first = first or found
        captured_on = move.to_square if capture else None
    return first
