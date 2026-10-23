"""How well the sub-type tagger agrees with Lichess's own theme tags on Lichess puzzles."""

from __future__ import annotations

from dataclasses import dataclass

import chess

from coach.tactics import LICHESS_THEME, ORDER, key_move, motifs, subtype


def puzzle_motifs(row: dict) -> set[str] | None:
    """Motifs at the solver's key move (first solver move that isn't a recapture); None if unplayable."""
    board = chess.Board(row["FEN"])
    moves = row["Moves"].split()
    first = chess.Move.from_uci(moves[0])
    before = board.copy(stack=False)
    board.push(first)
    found = key_move(board, moves[1:], board.turn, previous=first, previous_board=before)
    return None if found is None else motifs(found)


@dataclass
class ThemeAgreement:
    name: str
    theme: str
    tagged: int      # puzzles Lichess tags with the theme
    detected: int    # puzzles where our detector fires
    both: int
    subtype_hits: int  # among puzzles tagged with only this theme of ours, how often subtype() picks it
    only_tagged: int

    @property
    def recall(self) -> float:
        return 100 * self.both / self.tagged if self.tagged else float("nan")

    @property
    def precision(self) -> float:
        return 100 * self.both / self.detected if self.detected else float("nan")

    @property
    def subtype_agreement(self) -> float:
        return 100 * self.subtype_hits / self.only_tagged if self.only_tagged else float("nan")


def agreement(rows: list[dict]) -> tuple[list[ThemeAgreement], int]:
    """Per-theme agreement on puzzles that don't end in mate, and how many puzzles were used.

    Mating puzzles are left out because records with a mate get a mate type, never a sub-type.
    """
    stats = {name: ThemeAgreement(name, LICHESS_THEME[name], 0, 0, 0, 0, 0) for name in ORDER}
    used = 0
    for row in rows:
        if "mate" in row["Themes"]:
            continue
        found = puzzle_motifs(row)
        if found is None:
            continue
        used += 1
        themes = set(row["Themes"])
        ours = {name for name in ORDER if LICHESS_THEME[name] in themes}
        for name, s in stats.items():
            tagged, detected = name in ours, name in found
            s.tagged += tagged
            s.detected += detected
            s.both += tagged and detected
            if ours == {name}:
                s.only_tagged += 1
                s.subtype_hits += subtype(found) == name
    return list(stats.values()), used
