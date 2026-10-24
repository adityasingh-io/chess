"""Load config.toml and .env into typed settings."""

from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, fields
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
class Labels:
    excellent: float
    good: float
    inaccuracy: float
    mistake: float


@dataclass(frozen=True)
class Marks:
    great_gap: float
    brilliant_material: int
    brilliant_max_before: float
    brilliant_min_after: float
    miss_chance: float
    miss_gave_back: float


@dataclass(frozen=True)
class Phases:
    opening_moves: int
    endgame_non_pawn: int


@dataclass(frozen=True)
class Types:
    material_loss: int
    material_win: int
    missed_mate_max: int


@dataclass(frozen=True)
class Flags:
    threw_win_before: float
    threw_win_after: float
    fast_percentile: float
    fast_min_moves: int
    time_trouble: float
    after_loss_minutes: float


@dataclass(frozen=True)
class Losses:
    playable: float
    turning_from: float
    turning_to: float
    winning: float


@dataclass(frozen=True)
class Openings:
    leak_drop: float
    leak_score_gap: float
    leak_min_games: int
    surprise_share: float
    surprise_min_games: int
    tree_min_games: int


@dataclass(frozen=True)
class Endgames:
    winning: float
    losing: float


@dataclass(frozen=True)
class Insights:
    recent_games: int
    rating_band: int
    think_buckets: tuple[float, ...]
    length_buckets: tuple[int, ...]


@dataclass(frozen=True)
class Analysis:
    """Every threshold of the analysis model (BRIEF.md, Analysis model)."""

    labels: Labels
    marks: Marks
    phases: Phases
    types: Types
    flags: Flags
    losses: Losses
    openings: Openings
    endgames: Endgames
    insights: Insights


@dataclass(frozen=True)
class Explorer:
    url: str
    speeds: tuple[str, ...]
    ratings: tuple[int, ...]
    moves: int


@dataclass(frozen=True)
class RatingMap:
    chesscom: tuple[int, ...]
    lichess: tuple[int, ...]

    def lichess_of(self, chesscom: float) -> int:
        """A chess.com rapid rating on Lichess's rapid scale: straight lines between the map's points, held at its
        ends."""
        xs, ys = self.chesscom, self.lichess
        if chesscom <= xs[0]:
            return ys[0]
        for (x0, y0), (x1, y1) in zip(zip(xs, ys), zip(xs[1:], ys[1:])):
            if chesscom <= x1:
                return round(y0 + (y1 - y0) * (chesscom - x0) / (x1 - x0))
        return ys[-1]


@dataclass(frozen=True)
class Bots:
    maia_chesscom: tuple[int, ...]


@dataclass(frozen=True)
class Export:
    dir: str
    timezone: str


@dataclass(frozen=True)
class TaggerCheck:
    puzzle_url: str
    sample: int


@dataclass(frozen=True)
class Puzzles:
    max_plies: int
    lichess_ratings: tuple[int, ...]
    lichess_min_popularity: int
    lichess_min_plays: int
    lichess_count: int
    lichess_band: int
    lichess_theme_min: int
    lichess_opening_share: float
    lichess_families: int
    lichess_endgame_min: int


@dataclass(frozen=True)
class Repertoire:
    pgn: str
    plies: int
    min_games: int
    white: tuple[str, ...]
    black: tuple[str, ...]


@dataclass(frozen=True)
class Notes:
    enabled: bool
    count: int
    model: str
    effort: str
    max_tokens: int


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


@dataclass(frozen=True)
class Config:
    root: Path
    player: Player
    engine: EngineConfig
    garbage_time: GarbageTime
    analysis: Analysis
    explorer: Explorer
    rating_map: RatingMap
    bots: Bots
    export: Export
    tagger_check: TaggerCheck
    puzzles: Puzzles
    repertoire: Repertoire
    notes: Notes
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

    @property
    def export_dir(self) -> Path:
        return self.root / self.export.dir


def _search(section: dict, threads: int = 1) -> SearchSettings:
    return SearchSettings(
        nodes=int(section["nodes"]),
        multipv=int(section["multipv"]),
        hash_mb=int(section["hash_mb"]),
        threads=threads,
    )


def _section(cls: type, section: dict):
    """A dataclass from a TOML table with the same field names; lists become tuples."""
    return cls(**{f.name: tuple(v) if isinstance(v := section[f.name], list) else v for f in fields(cls)})


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
    analysis = raw["analysis"]
    garbage = analysis["garbage_time"]
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
            # COACH_WORKERS fits the pool to the machine (the nightly runner); results don't depend on it.
            workers=int(os.environ.get("COACH_WORKERS") or engine["workers"]),
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
        analysis=Analysis(
            labels=_section(Labels, analysis["labels"]),
            marks=_section(Marks, analysis["marks"]),
            phases=_section(Phases, analysis["phases"]),
            types=_section(Types, analysis["types"]),
            flags=_section(Flags, analysis["flags"]),
            losses=_section(Losses, analysis["losses"]),
            openings=_section(Openings, analysis["openings"]),
            endgames=_section(Endgames, analysis["endgames"]),
            insights=_section(Insights, analysis["insights"]),
        ),
        explorer=_section(Explorer, raw["explorer"]),
        rating_map=_section(RatingMap, raw["rating_map"]),
        bots=_section(Bots, raw["bots"]),
        export=_section(Export, raw["export"]),
        tagger_check=_section(TaggerCheck, raw["tagger_check"]),
        puzzles=_section(Puzzles, raw["puzzles"]),
        repertoire=_section(Repertoire, raw["repertoire"]),
        notes=_section(Notes, raw["notes"]),
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
        ),
    )
