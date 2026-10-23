"""Clock, think-time, time-control, result and position-key parsing."""

import chess
import pytest

from coach.parse import parse_game, parse_time_control, result_of, think_times
from coach.positions import position_key, terminal_outcome

PGN = """[Event "Live Chess"]
[UTCDate "2026.10.20"]
[UTCTime "14:03:11"]
[TimeControl "600+5"]
[ECO "C44"]
[ECOUrl "https://www.chess.com/openings/Kings-Pawn-Opening"]
[Termination "test"]

1. e4 {[%clk 0:09:58.5]} 1... e5 {[%clk 0:09:55]} 2. Nf3 {[%clk 0:09:50.1]} 2... Nc6 {[%clk 0:09:40]} *
"""


def raw_game(**overrides):
    raw = {
        "url": "https://www.chess.com/game/live/123456789",
        "pgn": PGN,
        "time_control": "600+5",
        "end_time": 1792500000,
        "rated": True,
        "time_class": "rapid",
        "rules": "chess",
        "white": {"username": "R00k4ndr0ll", "rating": 812, "result": "win"},
        "black": {"username": "someone", "rating": 790, "result": "resigned"},
    }
    raw.update(overrides)
    return raw


@pytest.mark.parametrize(("tc", "expected"), [("600", (600, 0)), ("600+5", (600, 5)), ("900+10", (900, 10)), ("1/86400", None)])
def test_parse_time_control(tc, expected):
    assert parse_time_control(tc) == expected


def test_think_times_with_increment():
    # White: 600 - 598.5 + 5, then 598.5 - 590.1 + 5. Black: 600 - 595 + 5, then 595 - 580 + 5.
    assert think_times([598.5, 595.0, 590.1, 580.0], 600, 5) == [6.5, 10.0, 13.4, 20.0]


def test_think_times_missing_clock():
    assert think_times([598.0, None, 590.0, 580.0], 600, 0) == [2.0, None, 8.0, None]


def test_think_time_never_negative():
    assert think_times([600.0], 600, 5) == [5.0]
    assert think_times([603.0], 600, 0) == [0.0]


def test_parse_game_clocks_and_metadata():
    game = parse_game(raw_game(), "r00k4ndr0ll", "2026-10")
    assert game.id == "123456789"
    assert game.my_color == "white" and game.result == "win"
    assert (game.base_seconds, game.increment) == (600, 5)
    assert [m.clock for m in game.moves] == [598.5, 595.0, 590.1, 580.0]
    assert [m.think_time for m in game.moves] == [6.5, 10.0, 13.4, 20.0]
    assert [m.san for m in game.moves] == ["e4", "e5", "Nf3", "Nc6"]
    assert [m.side for m in game.moves] == ["white", "black", "white", "black"]
    assert game.moves[0].key_after == game.moves[1].key_before
    assert game.start_ts == 1792504991  # 2026-10-20 14:03:11 UTC


def test_parse_game_skips_variants_and_daily():
    assert parse_game(raw_game(rules="chess960"), "r00k4ndr0ll", "2026-10") is None
    assert parse_game(raw_game(time_control="1/86400"), "r00k4ndr0ll", "2026-10") is None


def test_parse_game_other_players():
    assert parse_game(raw_game(), "nobody", "2026-10") is None


@pytest.mark.parametrize(
    ("code", "result"),
    [("win", "win"), ("agreed", "draw"), ("repetition", "draw"), ("stalemate", "draw"),
     ("insufficient", "draw"), ("50move", "draw"), ("timevsinsufficient", "draw"),
     ("checkmated", "loss"), ("timeout", "loss"), ("resigned", "loss"), ("abandoned", "loss")],
)
def test_result_of(code, result):
    assert result_of(code) == result


def test_position_key_drops_counters_and_unusable_en_passant():
    board = chess.Board("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1")  # no pawn can take on e3
    assert position_key(board) == "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -"


def test_terminal_outcome_checkmate_and_draw():
    board = chess.Board()
    for san in ["f3", "e5", "g4", "Qh4#"]:  # rules fact: python-chess reports checkmate
        board.push_san(san)
    assert board.is_checkmate()
    assert terminal_outcome(board) == "black"
    assert terminal_outcome(chess.Board("8/8/8/8/8/8/6k1/4K3 w - - 0 1")) == "draw"  # bare kings
    assert terminal_outcome(chess.Board()) is None
