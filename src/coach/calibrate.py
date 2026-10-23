"""Engine budget study: how much do results change with more nodes?

Samples my moves, analyses the position before and after each at every candidate budget and
at a much deeper reference, then reports how often each budget agrees with the reference on
the things the app is built from. Stockfish is the judge throughout; the reference is just
Stockfish thinking for longer.
"""

from __future__ import annotations

import json
import random
import sqlite3
import statistics
from dataclasses import asdict, dataclass
from datetime import date

import chess
from rich.console import Console
from rich.table import Table

from coach import db
from coach.analysis import Game, gap, is_garbage_time, my_moves, needs_engine
from coach.config import Config, SearchSettings
from coach.engine import RunStats, analyse_positions, check_engine
from coach.measure import net_material
from coach.positions import board_from_key
from coach.winpct import for_side, line_win_pct

BANDS = [(2.0, "excellent"), (5.0, "good"), (10.0, "inaccuracy"), (15.0, "mistake")]


def label(my_uci: str, before: dict, after: dict, white: bool) -> str:
    """Move label from one budget's results: 'best' if it matches Stockfish's top move, else the drop band."""
    if before["lines"][0]["pv"][:1] == [my_uci]:
        return "best"
    drop = for_side(line_win_pct(before["lines"][0]), white) - for_side(line_win_pct(after["lines"][0]), white)
    return next((name for limit, name in BANDS if drop < limit), "blunder")


def material_class(value: int) -> str:
    return "lost 2+" if value <= -2 else "won 2+" if value >= 2 else "level"


@dataclass
class Sample:
    my_uci: str
    before: str
    after: str
    white: bool


def sample_moves(cfg: Config, games: list[Game], evals1: dict[str, dict]) -> list[Sample]:
    """Half from my Win%-dropping moves, half from the rest, skipping garbage time and the first moves."""
    rng = random.Random(cfg.calibration.seed)
    pool = [
        mm for g in games for mm in my_moves(g, evals1)
        if mm.move["ply"] > 8 and not is_garbage_time(cfg, mm.win_before, mm.win_after)
        and needs_engine(mm.move["key_before"]) and needs_engine(mm.move["key_after"])
    ]
    drops = [mm for mm in pool if mm.drop >= cfg.engine.triggers.min_drop]
    rest = [mm for mm in pool if mm.drop < cfg.engine.triggers.min_drop]
    n = cfg.calibration.moves
    chosen = rng.sample(drops, min(len(drops), n // 2))
    chosen += rng.sample(rest, min(len(rest), n - len(chosen)))
    return [Sample(mm.move["uci"], mm.move["key_before"], mm.move["key_after"], mm.game.i_am_white) for mm in chosen]


def _drop(before: dict, after: dict, white: bool) -> float:
    return for_side(line_win_pct(before["lines"][0]), white) - for_side(line_win_pct(after["lines"][0]), white)


def _pct(flags: list[bool]) -> float:
    return 100.0 * sum(flags) / len(flags) if flags else float("nan")


def metrics(cfg: Config, samples: list[Sample], res: dict[str, dict], ref: dict[str, dict]) -> dict[str, float]:
    plies = cfg.engine.pv_plies
    best, win_err, labels, records, gaps, mats = [], [], [], [], [], []
    for s in samples:
        b, a, rb, ra = res[s.before], res[s.after], ref[s.before], ref[s.after]
        for mine, theirs in ((b, rb), (a, ra)):
            best.append(mine["lines"][0]["pv"][:1] == theirs["lines"][0]["pv"][:1])
            win_err.append(abs(line_win_pct(mine["lines"][0]) - line_win_pct(theirs["lines"][0])))
        labels.append(label(s.my_uci, b, a, s.white) == label(s.my_uci, rb, ra, s.white))
        records.append((_drop(b, a, s.white) >= cfg.engine.triggers.min_drop) == (_drop(rb, ra, s.white) >= cfg.engine.triggers.min_drop))
        g, rg = gap(b, s.white), gap(rb, s.white)
        if g is not None and rg is not None:
            gaps.append((g >= cfg.engine.triggers.min_gap) == (rg >= cfg.engine.triggers.min_gap))
        color = chess.WHITE if s.white else chess.BLACK
        before_board, after_board = board_from_key(s.before), board_from_key(s.after)
        for start, mine, theirs in ((before_board, b, rb), (after_board, a, ra)):
            m = net_material(before_board, start, mine["lines"][0]["pv"], plies, color)
            r = net_material(before_board, start, theirs["lines"][0]["pv"], plies, color)
            mats.append(material_class(m) == material_class(r))
    return {
        "best_move": _pct(best),
        "label": _pct(labels),
        "record": _pct(records),
        "gap_class": _pct(gaps),
        "material_class": _pct(mats),
        "win_err_mean": statistics.fmean(win_err),
        "win_err_p90": statistics.quantiles(win_err, n=10)[-1] if len(win_err) >= 10 else max(win_err),
    }


def load_or_sample(cfg: Config, games: list[Game], evals1: dict[str, dict], resample: bool) -> list[Sample]:
    """The study's moves are drawn once and saved, so a resumed run uses the same positions."""
    path = cfg.data_dir / "calibration_sample.json"
    if path.exists() and not resample:
        return [Sample(**s) for s in json.loads(path.read_text())]
    samples = sample_moves(cfg, games, evals1)
    path.write_text(json.dumps([asdict(s) for s in samples], indent=1))
    return samples


def throughput(cfg: Config, measured: list[RunStats]) -> float | None:
    """Nodes per second over this run's searches, else the figure saved by the last run that searched."""
    path = cfg.data_dir / "calibration_throughput.json"
    if measured:
        nps = sum(s.nodes for s in measured) / sum(s.seconds for s in measured)
        path.write_text(json.dumps({"nodes_per_second": nps, "workers": cfg.engine.workers}))
        return nps
    return json.loads(path.read_text())["nodes_per_second"] if path.exists() else None


def run(
    cfg: Config,
    conn: sqlite3.Connection,
    games: list[Game],
    console: Console,
    full_year_counts: tuple[int, int],
    resample: bool = False,
) -> None:
    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)
    common = dict(engine_path=cfg.secrets.stockfish_path, engine=engine, workers=cfg.engine.workers, console=console)
    evals1 = db.load_evals(conn, engine, cfg.engine.pass1.key)
    samples = load_or_sample(cfg, games, evals1, resample)
    keys = list(dict.fromkeys(k for s in samples for k in (s.before, s.after)))
    console.print(f"calibration: {len(samples)} moves, {len(keys)} positions")

    c = cfg.calibration
    candidates = [("pass 1", SearchSettings(n, 2, cfg.engine.pass1.hash_mb)) for n in c.pass1_budgets]
    candidates += [("pass 2", SearchSettings(n, 3, cfg.engine.pass2.hash_mb)) for n in c.pass2_budgets]
    reference = SearchSettings(c.reference_nodes, 3, c.reference_hash_mb)

    runs: list[tuple[str, SearchSettings, RunStats]] = []
    for kind, settings in candidates:
        runs.append((kind, settings, analyse_positions(conn, keys, settings, label=f"{kind} @ {settings.nodes:,}", **common)))
    ref_stats = analyse_positions(conn, keys, reference, label=f"reference @ {reference.nodes:,}", **common)
    ref = db.load_evals(conn, engine, reference.key, set(keys))

    measured = [s for _, _, s in runs if s.analysed] + ([ref_stats] if ref_stats.analysed else [])
    nps = throughput(cfg, measured)
    n1, n2 = full_year_counts

    # Compact enough for an 80-column terminal; docs/calibration.md explains the columns.
    table = Table(
        title=f"% agreement with {reference.nodes:,} nodes ({len(samples)} moves)",
        box=None, collapse_padding=True, pad_edge=False, header_style="bold underline",
    )
    for col in ("pass", "nodes", "pv", "best", "label", "≥5", "clear", "mat", "Win% err", "hours"):
        table.add_column(col, justify="left" if col == "pass" else "right")
    rows = []
    for kind, settings, _ in runs:
        m = metrics(cfg, samples, db.load_evals(conn, engine, settings.key, set(keys)), ref)
        count = n1 if kind == "pass 1" else n2
        hours = count * settings.nodes / nps / 3600 if nps else float("nan")
        rows.append((kind, settings, m, hours))
        table.add_row(
            kind[-1], f"{settings.nodes:,}", str(settings.multipv), f"{m['best_move']:.1f}", f"{m['label']:.1f}",
            f"{m['record']:.1f}", f"{m['gap_class']:.1f}", f"{m['material_class']:.1f}",
            f"{m['win_err_mean']:.2f}/{m['win_err_p90']:.2f}", f"{hours:.1f}",
        )
    console.print(table)
    if nps:
        console.print(f"throughput: {nps / 1e6:.2f}M nodes/s with {cfg.engine.workers} workers (hours = full year)")
    write_report(cfg, rows, len(samples), reference, nps, full_year_counts)


def write_report(cfg: Config, rows, n_samples: int, reference: SearchSettings, nps: float | None, counts: tuple[int, int]) -> None:
    lines = [
        "# Engine budget study",
        "",
        f"Generated by `coach calibrate` on {date.today().isoformat()} with {cfg.engine.version}, "
        f"{cfg.engine.workers} workers, one thread each.",
        "",
        f"{n_samples} of my moves (half of them Win% drops of {cfg.engine.triggers.min_drop:g}+), each analysed "
        f"before and after the move at every budget, compared with Stockfish at {reference.nodes:,} nodes "
        f"(MultiPV {reference.multipv}, {reference.hash_mb} MB hash).",
        "",
        "| Pass | Nodes | MultiPV | Best move | Label | ≥5 drop | One clear best | Material along line "
        "| Win% error mean / p90 | Full year (h) |",
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for kind, s, m, hours in rows:
        lines.append(
            f"| {kind} | {s.nodes:,} | {s.multipv} | {m['best_move']:.1f}% | {m['label']:.1f}% | {m['record']:.1f}% | "
            f"{m['gap_class']:.1f}% | {m['material_class']:.1f}% | {m['win_err_mean']:.2f} / {m['win_err_p90']:.2f} | {hours:.1f} |"
        )
    lines += [
        "",
        "Columns: how often the budget agrees with the reference on Stockfish's top move (before and after "
        "positions), the move label, whether the move is a 5+ Win% drop, whether one move is clearly best "
        f"(gap ≥ {cfg.engine.triggers.min_gap:g}), and the material class (lost 2+, level, won 2+) at the end of "
        f"Stockfish's line ({cfg.engine.pv_plies} plies). Win% error is the absolute difference in the position's "
        "Win% from the reference.",
        "",
        f"Full-year hours assume {counts[0]:,} pass-1 positions and {counts[1]:,} pass-2 positions"
        + (f" at the measured {nps / 1e6:.2f}M nodes/s." if nps else "."),
        "",
    ]
    cfg.docs_dir.mkdir(exist_ok=True)
    (cfg.docs_dir / "calibration.md").write_text("\n".join(lines))
