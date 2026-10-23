"""Load config.toml and .env into typed settings."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from dotenv import dotenv_values


def find_root(start: Path | None = None) -> Path:
    """The project root is the nearest directory holding config.toml (or $COACH_ROOT)."""
    if env := os.environ.get("COACH_ROOT"):
        return Path(env).resolve()
    here = (start or Path.cwd()).resolve()
    for path in (here, *here.parents):
        if (path / "config.toml").exists():
            return path
    raise FileNotFoundError("config.toml not found; run inside the project or set COACH_ROOT")


@dataclass(frozen=True)
class SearchSettings:
    """One engine configuration. Its key is part of every cache entry, so results stay comparable."""

    nodes: int
    multipv: int
    hash_mb: int
    threads: int = 1

    @property
    def key(self) -> str:
        return f"nodes={self.nodes};multipv={self.multipv};hash={self.hash_mb};threads={self.threads}"


@dataclass(frozen=True)
class Pass2Triggers:
    min_drop: float
    min_gap: float
    follow_min_drop: float
    line_my_moves: int


@dataclass(frozen=True)
class EngineConfig:
    version: str
    workers: int
    pass1: SearchSettings
    pass2: SearchSettings
    triggers: Pass2Triggers
    pv_plies: int


@dataclass(frozen=True)
class GarbageTime:
    below: float
    above: float
    still_above: float


@dataclass(frozen=True)
class Calibration:
    moves: int
    pass1_budgets: list[int]
    pass2_budgets: list[int]
    reference_nodes: int
    reference_hash_mb: int
    seed: int


@dataclass(frozen=True)
class Player:
    username: str
    since: date
    time_classes: list[str]
    rating_goal: int
    goal_date: date


@dataclass(frozen=True)
class Secrets:
    """Values from .env. Never logged, never exported."""

    stockfish_path: str | None
    chesscom_contact_email: str | None
    lichess_token: str | None
    anthropic_api_key: str | None


@dataclass(frozen=True)
class Config:
    root: Path
    player: Player
    engine: EngineConfig
    garbage_time: GarbageTime
    calibration: Calibration
    secrets: Secrets

    @property
    def data_dir(self) -> Path:
        return self.root / "data"

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def db_path(self) -> Path:
        return self.data_dir / "coach.sqlite"

    @property
    def docs_dir(self) -> Path:
        return self.root / "docs"


def _search(section: dict, threads: int = 1) -> SearchSettings:
    return SearchSettings(
        nodes=int(section["nodes"]),
        multipv=int(section["multipv"]),
        hash_mb=int(section["hash_mb"]),
        threads=threads,
    )


def load_config(root: Path | None = None) -> Config:
    root = root or find_root()
    raw = tomllib.loads((root / "config.toml").read_text())
    env = {**dotenv_values(root / ".env"), **os.environ}

    def secret(name: str) -> str | None:
        value = env.get(name)
        return value.strip() if value and value.strip() else None

    player = raw["player"]
    engine = raw["engine"]
    triggers = engine["pass2"]["triggers"]
    garbage = raw["analysis"]["garbage_time"]
    calib = raw["calibration"]
    return Config(
        root=root,
        player=Player(
            username=player["username"],
            since=date.fromisoformat(player["since"]),
            time_classes=list(player["time_classes"]),
            rating_goal=int(player["rating_goal"]),
            goal_date=date.fromisoformat(player["goal_date"]),
        ),
        engine=EngineConfig(
            version=engine["version"],
            workers=int(engine["workers"]),
            pass1=_search(engine["pass1"]),
            pass2=_search(engine["pass2"]),
            triggers=Pass2Triggers(
                min_drop=float(triggers["min_drop"]),
                min_gap=float(triggers["min_gap"]),
                follow_min_drop=float(triggers["follow_min_drop"]),
                line_my_moves=int(triggers["line_my_moves"]),
            ),
            pv_plies=int(engine["lines"]["pv_plies"]),
        ),
        garbage_time=GarbageTime(
            below=float(garbage["below"]),
            above=float(garbage["above"]),
            still_above=float(garbage["still_above"]),
        ),
        calibration=Calibration(
            moves=int(calib["moves"]),
            pass1_budgets=[int(n) for n in calib["pass1_budgets"]],
            pass2_budgets=[int(n) for n in calib["pass2_budgets"]],
            reference_nodes=int(calib["reference_nodes"]),
            reference_hash_mb=int(calib["reference_hash_mb"]),
            seed=int(calib["seed"]),
        ),
        secrets=Secrets(
            stockfish_path=secret("STOCKFISH_PATH"),
            chesscom_contact_email=secret("CHESSCOM_CONTACT_EMAIL"),
            lichess_token=secret("LICHESS_TOKEN"),
            anthropic_api_key=secret("ANTHROPIC_API_KEY"),
        ),
    )
