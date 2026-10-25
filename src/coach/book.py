"""Where each game left the lines the trainer teaches: by my move, by my opponent's, or at a line's end.

The lines are the trainer's: the repertoire PGN, coverage lines and leak lines. A leak line teaches only
its last move (the moves before it are how one of my games got there, not moves to learn). Positions are
matched by key, so a transposition into a line counts as staying in it. Only rules-level facts are
measured here: which move was played and whether a line has it.
"""

from __future__ import annotations

from collections import defaultdict

import chess

from coach.model import GameModel
from coach.positions import position_key
from coach.repertoire import line_id

# colour, name, source, UCI moves, plies played for me before the drill asks (trainer.Line)
Line = tuple[str, str, str, list[str], int]
# colour -> position key -> move -> ids of the lines that play it there; a key with no moves ends a line
Book = dict[str, dict[str, dict[str, list[str]]]]


def book(lines: list[Line]) -> Book:
    out: Book = {"white": defaultdict(lambda: defaultdict(list)), "black": defaultdict(lambda: defaultdict(list))}
    for colour, _, source, moves, start in lines:
        lid, board = line_id(colour, moves), chess.Board()
        for i, uci in enumerate(moves):
            if source != "leak" or i >= start:
                out[colour][position_key(board)][uci].append(lid)
            board.push_uci(uci)
        out[colour].setdefault(position_key(board), defaultdict(list))  # the line's end
    return out


def check(bk: Book, m: GameModel) -> dict | None:
    """The first move that left my lines and whose it was, or where the game reached a line's end; None for a
    game with no moves, from another start position, or in a colour I have no lines for."""
    lines = bk[m.row["my_color"]]
    if not m.plies or not lines or m.row["initial_fen"] != chess.STARTING_FEN:
        return None
    for p in m.plies:
        here = lines.get(p.move["key_before"])
        if here is None:
            return None
        if not here:
            return {"result": "end", "ply": p.number, "san": p.move["san"], "expected": [], "line": None}
        if p.move["uci"] in here:
            continue
        if not p.mine:
            return {"result": "theirs", "ply": p.number, "san": p.move["san"], "expected": [], "line": None}
        board = chess.Board(p.move["fen_before"])
        expected = [board.san(chess.Move.from_uci(u)) for u in here]
        return {"result": "mine", "ply": p.number, "san": p.move["san"], "expected": expected,
                "line": next(iter(here.values()))[0]}
    return {"result": "over", "ply": len(m.plies) + 1, "san": None, "expected": [], "line": None}
