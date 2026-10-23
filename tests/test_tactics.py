"""Tactic sub-types: recapture rules, and agreement with Lichess puzzle themes."""

import json
from pathlib import Path

import chess

from coach.taggercheck import agreement, puzzle_motifs
from coach.tactics import LICHESS_THEME, key_move

PUZZLES = json.loads((Path(__file__).parent / "fixtures" / "puzzles.json").read_text())["puzzles"]


def _after(*sans: str) -> tuple[chess.Board, chess.Board, chess.Move]:
    board = chess.Board()
    for san in sans[:-1]:
        board.push_san(san)
    before = board.copy()
    move = board.push_san(sans[-1])
    return before, board, move


def test_key_move_skips_recaptures():
    # 1.e4 d5 2.exd5: Black's Qxd5 recaptures on d5, so the key move is Black's next one.
    before, board, last = _after("e4", "d5", "exd5")
    key = key_move(board, ["d8d5", "b1c3", "d5a5"], chess.BLACK, previous=last, previous_board=before)
    assert key.move.uci() == "d5a5" and key.before.turn == chess.BLACK


def test_key_move_falls_back_to_first_when_all_recapture():
    before, board, last = _after("e4", "d5", "exd5")
    key = key_move(board, ["d8d5"], chess.BLACK, previous=last, previous_board=before)
    assert key.move.uci() == "d8d5" and key.rest == []


def test_agreement_with_lichess_themes():
    """Recorded Lichess puzzles: each detector finds a fair share of its theme and rarely fires on
    puzzles without any of the themes. Floors sit below what `coach tagger-check` measured."""
    rows = [{**p, "Themes": p["Themes"]} for p in PUZZLES]
    stats, used = agreement(rows)
    assert used == len(rows)
    by_theme = {s.theme: s for s in stats}
    for theme in LICHESS_THEME.values():
        assert by_theme[theme].tagged >= 20, theme
        assert by_theme[theme].recall >= 35, (theme, by_theme[theme].recall)
    plain = [p for p in rows if not set(LICHESS_THEME.values()) & set(p["Themes"])]
    fired = sum(1 for p in plain if puzzle_motifs(p))
    assert fired / len(plain) <= 0.5
