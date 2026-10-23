"""Stockfish worker pool with a position-keyed SQLite cache.

Every search runs on a board with no move history, one thread, a fixed node limit and a
cleared hash (ucinewgame), so the same position always gets the same result regardless of
which worker runs it or in what order.
"""

from __future__ import annotations

import multiprocessing
import sqlite3
import time
from dataclasses import dataclass
from multiprocessing.util import Finalize

import chess
import chess.engine
from rich.console import Console
from rich.progress import BarColumn, MofNCompleteColumn, Progress, TextColumn, TimeElapsedColumn, TimeRemainingColumn

from coach import db
from coach.config import SearchSettings
from coach.positions import board_from_key

_engine: chess.engine.SimpleEngine | None = None


def engine_name(path: str) -> str:
    """The engine's UCI id name, e.g. 'Stockfish 19'."""
    engine = chess.engine.SimpleEngine.popen_uci(path)
    try:
        return engine.id.get("name", "unknown")
    finally:
        engine.quit()


def check_engine(path: str | None, expected: str) -> str:
    if not path:
        raise SystemExit("Set STOCKFISH_PATH in .env (copy .env.example).")
    name = engine_name(path)
    if name != expected:
        raise SystemExit(f"{path} is '{name}' but config.toml pins '{expected}'. Cached results would not be comparable.")
    return name


def line_from_info(info: chess.engine.InfoDict) -> dict:
    """One MultiPV line with its score from White's point of view."""
    score = info["score"].white()
    return {
        "cp": score.score() if not score.is_mate() else None,
        "mate": score.mate() if score.is_mate() else None,
        "pv": [move.uci() for move in info.get("pv", [])],
        "depth": info.get("depth"),
        "seldepth": info.get("seldepth"),
        "nodes": info.get("nodes"),
    }


def open_engine(path: str, settings: SearchSettings) -> chess.engine.SimpleEngine:
    engine = chess.engine.SimpleEngine.popen_uci(path)
    engine.configure({"Threads": settings.threads, "Hash": settings.hash_mb})
    return engine


def analyse_one(engine: chess.engine.SimpleEngine, key: str, settings: SearchSettings) -> dict:
    """Stockfish's MultiPV lines for one position, searched from a cleared hash."""
    infos = engine.analyse(
        board_from_key(key),
        chess.engine.Limit(nodes=settings.nodes),
        multipv=settings.multipv,
        game=object(),  # a new game object makes python-chess send ucinewgame, clearing the hash
        info=chess.engine.INFO_BASIC | chess.engine.INFO_SCORE | chess.engine.INFO_PV,
    )
    return {"lines": [line_from_info(info) for info in infos]}


def _init_worker(path: str, settings: SearchSettings) -> None:
    # Pool workers run their finalizers before exiting, which shuts the engine down.
    global _engine
    _engine = open_engine(path, settings)
    Finalize(None, _engine.quit, exitpriority=10)


def _analyse(task: tuple[str, SearchSettings]) -> tuple[str, dict, float]:
    key, settings = task
    assert _engine is not None
    started = time.perf_counter()
    return key, analyse_one(_engine, key, settings), time.perf_counter() - started


@dataclass
class RunStats:
    requested: int
    cached: int
    analysed: int
    seconds: float
    nodes: int

    @property
    def nps(self) -> float:
        return self.nodes / self.seconds if self.seconds else 0.0


def analyse_positions(
    conn: sqlite3.Connection,
    keys: list[str],
    settings: SearchSettings,
    *,
    engine_path: str,
    engine: str,
    workers: int,
    console: Console,
    label: str,
) -> RunStats:
    """Analyse every key not already cached for (engine, settings). Safe to interrupt and resume."""
    wanted = list(dict.fromkeys(keys))
    done = db.cached_keys(conn, engine, settings.key)
    todo = [key for key in wanted if key not in done]
    stats = RunStats(requested=len(wanted), cached=len(wanted) - len(todo), analysed=0, seconds=0.0, nodes=0)
    if not todo:
        console.print(f"{label}: all {len(wanted)} positions cached")
        return stats

    started = time.perf_counter()
    pending: list[tuple[str, dict]] = []
    last_flush = time.monotonic()
    columns = (
        TextColumn(f"[bold]{label}"), BarColumn(), MofNCompleteColumn(),
        TimeElapsedColumn(), TextColumn("eta"), TimeRemainingColumn(),
    )
    ctx = multiprocessing.get_context("spawn")
    with Progress(*columns, console=console) as progress:
        task_id = progress.add_task(label, total=len(todo))
        with ctx.Pool(min(workers, len(todo)), initializer=_init_worker, initargs=(engine_path, settings)) as pool:
            try:
                for key, result, _ in pool.imap_unordered(_analyse, [(k, settings) for k in todo]):
                    pending.append((key, result))
                    stats.analysed += 1
                    stats.nodes += max((line["nodes"] or 0 for line in result["lines"]), default=0)
                    progress.advance(task_id)
                    if len(pending) >= 50 or time.monotonic() - last_flush > 10:
                        db.store_evals(conn, engine, settings.key, pending, int(time.time()))
                        pending.clear()
                        last_flush = time.monotonic()
            finally:
                if pending:
                    db.store_evals(conn, engine, settings.key, pending, int(time.time()))
    stats.seconds = time.perf_counter() - started
    console.print(
        f"{label}: analysed {stats.analysed}, cached {stats.cached}, "
        f"{stats.seconds / 60:.1f} min, {stats.nps / 1e6:.2f}M nodes/s total"
    )
    return stats
