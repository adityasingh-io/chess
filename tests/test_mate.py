"""Mate scores: parsing from python-chess, White's point of view, and Win% mapping."""

import chess
import chess.engine
import pytest

from coach.engine import line_from_info
from coach.winpct import CP_CEILING, for_side, line_cp, position_win_pct, win_pct_from_cp

MATE_WIN = win_pct_from_cp(CP_CEILING)


def test_mate_for_white_counts_as_ceiling():
    assert line_cp({"cp": None, "mate": 3}) == CP_CEILING
    assert line_cp({"cp": None, "mate": -2}) == -CP_CEILING


def test_engine_mate_win_pct():
    assert position_win_pct({"lines": [{"cp": None, "mate": 1}]}) == pytest.approx(97.544744, abs=1e-5)
    assert position_win_pct({"lines": [{"cp": None, "mate": -4}]}) == pytest.approx(2.455256, abs=1e-5)


def test_terminal_outcomes():
    assert position_win_pct({"terminal": "white"}) == MATE_WIN
    assert position_win_pct({"terminal": "black"}) == pytest.approx(100 - MATE_WIN)
    assert position_win_pct({"terminal": "draw"}) == 50.0


def test_mover_view_flips():
    white = position_win_pct({"lines": [{"cp": None, "mate": 2}]})
    assert for_side(white, white=False) == pytest.approx(100 - MATE_WIN)


def test_line_from_info_stores_whites_view():
    # Stockfish reports scores for the side to move; here Black to move with mate in 2 for Black.
    info = {
        "score": chess.engine.PovScore(chess.engine.Mate(2), chess.BLACK),
        "pv": [chess.Move.from_uci("e7e5")],
        "depth": 20,
        "seldepth": 24,
        "nodes": 1000,
    }
    line = line_from_info(info)
    assert line["mate"] == -2 and line["cp"] is None
    assert line["pv"] == ["e7e5"]


def test_line_from_info_centipawns():
    info = {"score": chess.engine.PovScore(chess.engine.Cp(35), chess.BLACK), "pv": [], "depth": 1}
    line = line_from_info(info)
    assert line["cp"] == -35 and line["mate"] is None
