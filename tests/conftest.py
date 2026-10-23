"""Shared fixtures: a temporary database loaded with recorded games and Stockfish output."""

from __future__ import annotations

import json
from dataclasses import dataclass, replace
from pathlib import Path

import pytest

from coach import db
from coach.analysis import Game, load_games, select_game_ids
from coach.config import Config, SearchSettings, load_config
from coach.model import GameModel, build_all
from coach.openings import Opening, load_openings, openings_dir

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"


def settings_from_key(key: str) -> SearchSettings:
    parts = dict(p.split("=") for p in key.split(";"))
    return SearchSettings(int(parts["nodes"]), int(parts["multipv"]), int(parts["hash"]), int(parts["threads"]))


@dataclass
class Recorded:
    cfg: Config
    conn: object
    games: list[Game]
    evals1: dict[str, dict]
    evals2: dict[str, dict]
    openings: dict[str, Opening]
    models: list[GameModel]


@pytest.fixture(scope="session")
def openings(tmp_path_factory) -> dict[str, Opening]:
    return load_openings(openings_dir(ROOT), tmp_path_factory.mktemp("openings"))


@pytest.fixture
def recorded(tmp_path: Path, openings: dict[str, Opening]) -> Recorded:
    """The recorded games in a fresh database, with the engine settings they were analysed at."""
    data = json.loads((FIXTURES / "games.json").read_text())
    base = load_config(ROOT)
    engine = replace(base.engine, version=data["engine"], pass1=settings_from_key(data["pass1"]),
                     pass2=settings_from_key(data["pass2"]))
    (tmp_path / "vendor").symlink_to(ROOT / "vendor")
    cfg = replace(base, root=tmp_path, engine=engine)
    conn = db.connect(cfg.db_path)
    for g in data["games"]:
        cols = ", ".join(g)
        conn.execute(f"INSERT INTO games ({cols}) VALUES ({', '.join('?' * len(g))})", list(g.values()))
    for m in data["moves"]:
        cols = ", ".join(m)
        conn.execute(f"INSERT INTO moves ({cols}) VALUES ({', '.join('?' * len(m))})", list(m.values()))
    db.store_evals(conn, data["engine"], data["pass1"], list(data["evals1"].items()), 0)
    db.store_evals(conn, data["engine"], data["pass2"], list(data["evals2"].items()), 0)
    games = load_games(conn, select_game_ids(conn))
    evals1, evals2 = data["evals1"], data["evals2"]
    return Recorded(cfg, conn, games, evals1, evals2, openings, build_all(cfg, games, evals1, evals2, openings))
