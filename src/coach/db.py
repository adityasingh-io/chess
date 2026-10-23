"""SQLite storage: fetched archives, parsed games and moves, and the engine cache."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS archives (
    month       TEXT PRIMARY KEY,           -- YYYY-MM
    url         TEXT NOT NULL,
    fetched_at  INTEGER NOT NULL,           -- unix seconds
    sha256      TEXT NOT NULL,              -- of the raw JSON file
    parsed_sha  TEXT                        -- sha256 last parsed into games/moves
);

CREATE TABLE IF NOT EXISTS games (
    id            TEXT PRIMARY KEY,         -- chess.com game id (last URL segment)
    url           TEXT NOT NULL,
    month         TEXT NOT NULL,
    start_ts      INTEGER NOT NULL,
    end_ts        INTEGER NOT NULL,
    time_class    TEXT NOT NULL,
    time_control  TEXT NOT NULL,
    base_seconds  INTEGER NOT NULL,
    increment     INTEGER NOT NULL,
    rated         INTEGER NOT NULL,
    my_color      TEXT NOT NULL,            -- 'white' | 'black'
    my_rating     INTEGER,
    opp_username  TEXT NOT NULL,
    opp_rating    INTEGER,
    my_code       TEXT NOT NULL,            -- chess.com result code for me, e.g. 'resigned'
    opp_code      TEXT NOT NULL,
    result        TEXT NOT NULL,            -- 'win' | 'draw' | 'loss' (mine)
    termination   TEXT,
    eco           TEXT,
    eco_url       TEXT,
    initial_fen   TEXT NOT NULL,
    ply_count     INTEGER NOT NULL,
    cc_acc_white  REAL,                     -- chess.com accuracies, only for reviewed games
    cc_acc_black  REAL,
    pgn           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moves (
    game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    ply         INTEGER NOT NULL,           -- 1-based
    side        TEXT NOT NULL,              -- 'white' | 'black'
    is_mine     INTEGER NOT NULL,
    san         TEXT NOT NULL,
    uci         TEXT NOT NULL,
    fen_before  TEXT NOT NULL,
    fen_after   TEXT NOT NULL,
    key_before  TEXT NOT NULL,              -- position key (FEN without move counters)
    key_after   TEXT NOT NULL,
    clock       REAL,                       -- mover's clock after the move, seconds
    think_time  REAL,                       -- seconds
    PRIMARY KEY (game_id, ply)
);

-- One row per (position, engine, settings). Scores are from White's point of view.
CREATE TABLE IF NOT EXISTS evals (
    key         TEXT NOT NULL,
    engine      TEXT NOT NULL,              -- e.g. 'Stockfish 19'
    settings    TEXT NOT NULL,              -- SearchSettings.key
    result      TEXT NOT NULL,              -- JSON: {"lines": [...]}
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (key, engine, settings)
);

-- Lichess opening explorer responses, one row per (position, query settings).
CREATE TABLE IF NOT EXISTS explorer (
    key         TEXT NOT NULL,
    params      TEXT NOT NULL,              -- e.g. 'speeds=rapid;ratings=1000,1200;moves=12'
    result      TEXT NOT NULL,              -- JSON response with topGames/recentGames dropped
    fetched_at  INTEGER NOT NULL,
    PRIMARY KEY (key, params)
);
"""


def connect(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.executescript(SCHEMA)
    return conn


def cached_keys(conn: sqlite3.Connection, engine: str, settings: str) -> set[str]:
    rows = conn.execute("SELECT key FROM evals WHERE engine = ? AND settings = ?", (engine, settings))
    return {row["key"] for row in rows}


def load_evals(conn: sqlite3.Connection, engine: str, settings: str, keys: set[str] | None = None) -> dict[str, dict]:
    rows = conn.execute("SELECT key, result FROM evals WHERE engine = ? AND settings = ?", (engine, settings))
    return {row["key"]: json.loads(row["result"]) for row in rows if keys is None or row["key"] in keys}


def store_evals(conn: sqlite3.Connection, engine: str, settings: str, results: list[tuple[str, dict]], now: int) -> None:
    conn.executemany(
        "INSERT OR REPLACE INTO evals (key, engine, settings, result, created_at) VALUES (?, ?, ?, ?, ?)",
        [(key, engine, settings, json.dumps(result, separators=(",", ":")), now) for key, result in results],
    )
    conn.commit()
