"""Checks on real Stockfish output recorded from my games (tests/fixtures/recorded_evals.json)."""

import json
from pathlib import Path

import chess
import pytest

from coach.analysis import gap, next_line_position
from coach.positions import board_from_key, position_key
from coach.winpct import CP_CEILING, for_side, line_win_pct, position_win_pct, win_pct_from_cp

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "recorded_evals.json").read_text())["positions"]
MATE_WIN = win_pct_from_cp(CP_CEILING)


def case(name):
    entry = FIXTURE[name]
    return entry["key"], entry["result"], board_from_key(entry["key"]).turn == chess.WHITE


def test_recorded_mate_for_side_to_move():
    key, result, white = case("mate_for_side_to_move")
    assert for_side(position_win_pct(result), white) == pytest.approx(MATE_WIN)


def test_recorded_mate_against_side_to_move():
    key, result, white = case("mated_side_to_move")
    assert for_side(position_win_pct(result), white) == pytest.approx(100 - MATE_WIN)


def test_gap_is_first_minus_second_for_side_to_move():
    key, result, white = case("one_clear_best_pass2")
    first, second = result["lines"][:2]
    assert gap(result, white) == pytest.approx(for_side(line_win_pct(first), white) - for_side(line_win_pct(second), white))


def test_line_follow_plays_two_plies_of_stockfish_line():
    key, result, white = case("one_clear_best_pass2")
    board = board_from_key(key)
    for uci in result["lines"][0]["pv"][:2]:
        board.push(chess.Move.from_uci(uci))
    assert next_line_position(key, result, white, min_gap=20.0) == (None if board.is_game_over() else position_key(board))


def test_line_follow_stops_unless_findable():
    key, result, white = case("close_pass2")
    board = board_from_key(key)
    move = chess.Move.from_uci(result["lines"][0]["pv"][0])
    findable = board.gives_check(move) or board.is_capture(move)  # gap here is below 20 by construction
    assert (next_line_position(key, result, white, min_gap=20.0) is not None) == findable
