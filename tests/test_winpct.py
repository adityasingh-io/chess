"""Win% and accuracy formulas. Expected values are hand-computed from the Lichess constants."""

import pytest

from coach.winpct import game_accuracy, move_accuracy, win_pct_from_cp, window_size


@pytest.mark.parametrize(
    ("cp", "expected"),
    [(0, 50.0), (100, 59.10259), (-100, 40.89741), (300, 75.11255), (1000, 97.544744), (-1000, 2.455256)],
)
def test_win_pct_from_cp(cp, expected):
    assert win_pct_from_cp(cp) == pytest.approx(expected, abs=1e-5)


def test_centipawns_are_clamped_at_1000():
    assert win_pct_from_cp(5000) == win_pct_from_cp(1000)
    assert win_pct_from_cp(-5000) == win_pct_from_cp(-1000)


def test_win_pct_is_symmetric():
    assert win_pct_from_cp(237) + win_pct_from_cp(-237) == pytest.approx(100.0)


@pytest.mark.parametrize(
    ("before", "after", "expected"),
    [
        (60, 60, 100.0),  # no change
        (60, 70, 100.0),  # improved
        (60, 50, 64.579828),  # 10 points lost, includes Lichess's +1 uncertainty bonus
        (70, 50, 41.016819),
        (100, 0, 0.0),  # clamped at 0
    ],
)
def test_move_accuracy(before, after, expected):
    assert move_accuracy(before, after) == pytest.approx(expected, abs=1e-5)


@pytest.mark.parametrize(("positions", "size"), [(2, 2), (5, 2), (31, 3), (81, 8), (400, 8)])
def test_window_size(positions, size):
    assert window_size(positions) == size


def test_game_accuracy_small_game():
    # White's Win% after each ply; windows of 2 -> weights 0.5, 5, 0.5, 10.
    # White's moves keep Win% (100, 100); Black gains 10 then loses 20 (100 at weight 5, 41.0168 at weight 10).
    acc = game_accuracy([50, 50, 40, 40, 60])
    assert acc["white"] == pytest.approx(100.0)
    assert acc["black"] == pytest.approx(59.425412, abs=1e-5)


def test_game_accuracy_black_to_move_first():
    acc = game_accuracy([50, 40], white_moves_first=False)
    assert acc["white"] is None
    assert acc["black"] == pytest.approx(100.0)


def test_game_accuracy_no_moves():
    assert game_accuracy([50]) == {"white": None, "black": None}
