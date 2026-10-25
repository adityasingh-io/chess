"""The derive-and-export step: model, reports and JSON from what's already in the cache.

Never runs the engine. Games without complete pass-1 results are left out until they have them.
"""

from __future__ import annotations

import sqlite3
import time
from dataclasses import dataclass

from rich.console import Console

from coach import db, explorer, notes
from coach.analysis import load_games, select_game_ids
from coach.config import Config
from coach.export import Built, build, write
from coach.model import GameModel, build_all
from coach.openings import load_openings, openings_dir
from coach.reports import explorer_keys


@dataclass
class BuildResult:
    games: int
    models: list[GameModel]
    built: Built
    written: int
    unchanged: int
    seconds: float
    explorer_missing: int


def load_inputs(cfg: Config, conn: sqlite3.Connection) -> tuple:
    engine = cfg.engine.version
    evals1 = db.load_evals(conn, engine, cfg.engine.pass1.key)
    evals2 = db.load_evals(conn, engine, cfg.engine.pass2.key)
    games = load_games(conn, select_game_ids(conn))
    models = build_all(cfg, games, evals1, evals2, load_openings(openings_dir(cfg.root), cfg.data_dir))
    return games, models, evals1, evals2


def fetch_explorer(cfg: Config, conn: sqlite3.Connection, console: Console) -> int:
    """Both databases for my tree's positions: players at my level, and masters."""
    _, models, evals1, _ = load_inputs(cfg, conn)
    keys = explorer_keys(cfg, models, evals1)
    return explorer.fetch(cfg, conn, keys, console) + explorer.fetch(cfg, conn, keys, console, database="masters")


def fetch_puzzles(cfg: Config, conn: sqlite3.Connection, console: Console, refresh: bool = False) -> int:
    from coach.puzzles import fetch_subset

    _, models, _, _ = load_inputs(cfg, conn)
    return fetch_subset(cfg, models, console, refresh)


def fetch_trainer(cfg: Config, conn: sqlite3.Connection, console: Console) -> None:
    """Score every move I could play where the trainer asks, and fetch the explorer stats along its lines."""
    from coach import trainer

    _, models, evals1, _ = load_inputs(cfg, conn)
    trainer.analyse(cfg, conn, trainer.all_lines(cfg, models, evals1), console)


def write_notes(cfg: Config, conn: sqlite3.Connection, console: Console) -> tuple[int, int]:
    """Ask Claude to reword the explanations of my costliest mistakes that have no cached note yet."""
    _, models, _, _ = load_inputs(cfg, conn)
    return notes.write(conn, cfg, notes.costliest(cfg, models), notes.claude(cfg), console.print)


def run_build(cfg: Config, conn: sqlite3.Connection, console: Console) -> BuildResult:
    started = time.perf_counter()
    games, models, evals1, evals2 = load_inputs(cfg, conn)
    stats = explorer.load(conn, cfg)
    missing = len(explorer_keys(cfg, models, evals1) - set(stats))
    worded = notes.load(conn, cfg, notes.costliest(cfg, models)) if cfg.notes.enabled else {}
    built = build(cfg, models, len(games), evals1, evals2, stats, worded, explorer.load(conn, cfg, "masters"))
    written, unchanged = write(cfg, built)
    return BuildResult(len(games), models, built, written, unchanged, time.perf_counter() - started, missing)
