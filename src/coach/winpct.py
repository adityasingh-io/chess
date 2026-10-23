"""Win% and accuracy, implemented to match Lichess (lila AccuracyPercent, scalachess WinPercent).

Pure maths on Stockfish scores. Scores here are always from White's point of view:
a line is {"cp": int | None, "mate": int | None, ...}, mate > 0 meaning White mates.
"""

from __future__ import annotations

import math
from statistics import pstdev

CP_CEILING = 1000  # centipawns are clamped to ±1000 and a mate counts as ±1000
WIN_MULTIPLIER = -0.00368208

# Move accuracy curve fitted by Lichess, plus their +1 "uncertainty bonus".
ACC_A = 103.1668100711649
ACC_K = 0.04354415386753951
ACC_B = -3.166924740191411
ACC_UNCERTAINTY_BONUS = 1.0


def win_pct_from_cp(cp: float) -> float:
    cp = max(-CP_CEILING, min(CP_CEILING, cp))
    chances = 2 / (1 + math.exp(WIN_MULTIPLIER * cp)) - 1
    return 50 + 50 * max(-1.0, min(1.0, chances))


def line_cp(line: dict) -> int:
    """A line's score as centipawns for White, with mates mapped to the ceiling."""
    if line.get("mate") is not None:
        return CP_CEILING if line["mate"] > 0 else -CP_CEILING
    return int(line["cp"])


def position_win_pct(evaluation: dict) -> float:
    """White's Win% for a position: Stockfish's top line, or the rules outcome if the game is over."""
    terminal = evaluation.get("terminal")
    if terminal == "white":
        return win_pct_from_cp(CP_CEILING)
    if terminal == "black":
        return win_pct_from_cp(-CP_CEILING)
    if terminal == "draw":
        return 50.0
    return win_pct_from_cp(line_cp(evaluation["lines"][0]))


def line_win_pct(line: dict) -> float:
    return win_pct_from_cp(line_cp(line))


def for_side(white_win_pct: float, white: bool) -> float:
    return white_win_pct if white else 100.0 - white_win_pct


def move_accuracy(before: float, after: float) -> float:
    """Accuracy of one move from the mover's Win% before and after it."""
    if after >= before:
        return 100.0
    raw = ACC_A * math.exp(-ACC_K * (before - after)) + ACC_B + ACC_UNCERTAINTY_BONUS
    return max(0.0, min(100.0, raw))


def window_size(n_positions: int) -> int:
    return max(2, min(8, (n_positions - 1) // 10))


def game_accuracy(white_win_pcts: list[float], white_moves_first: bool = True) -> dict[str, float | None]:
    """Lichess game accuracy per colour.

    white_win_pcts holds White's Win% for every position of the game, starting with the
    initial one. The result is the mean of a volatility-weighted mean (weights are the
    population standard deviation of Win% in a sliding window, clamped to 0.5..12) and
    the harmonic mean of the move accuracies.
    """
    n = len(white_win_pcts)
    result: dict[str, float | None] = {"white": None, "black": None}
    if n < 2:
        return result

    size = window_size(n)
    windows = [white_win_pcts[:size]] * max(0, min(size, n) - 2)
    windows += [white_win_pcts[i : i + size] for i in range(n - size + 1)]
    weights = [max(0.5, min(12.0, pstdev(w))) for w in windows]

    per_color: dict[str, list[tuple[float, float]]] = {"white": [], "black": []}
    for i in range(n - 1):
        white = (i % 2 == 0) == white_moves_first
        before = for_side(white_win_pcts[i], white)
        after = for_side(white_win_pcts[i + 1], white)
        per_color["white" if white else "black"].append((move_accuracy(before, after), weights[i]))

    for color, items in per_color.items():
        if not items:
            continue
        total_weight = sum(w for _, w in items)
        weighted = sum(a * w for a, w in items) / total_weight
        harmonic = len(items) / sum(1 / max(1.0, a) for a, _ in items)
        result[color] = (weighted + harmonic) / 2
    return result
