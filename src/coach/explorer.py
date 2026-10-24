"""Lichess opening explorer: what players at my level play in a position.

Fetched by the pipeline only, one request at a time as the Lichess API asks, and cached in
SQLite; the frontend gets the numbers from the export and never sees the token.
"""

from __future__ import annotations

import json
import sqlite3
import time
from collections.abc import Callable, Iterable

import httpx
from rich.console import Console

from coach import __version__
from coach.config import Config


def params_key(cfg: Config) -> str:
    e = cfg.explorer
    return f"speeds={','.join(e.speeds)};ratings={','.join(map(str, e.ratings))};moves={e.moves}"


def load(conn: sqlite3.Connection, cfg: Config) -> dict[str, dict]:
    rows = conn.execute("SELECT key, result FROM explorer WHERE params = ?", (params_key(cfg),))
    return {row["key"]: json.loads(row["result"]) for row in rows}


class Explorer:
    def __init__(self, cfg: Config, client: httpx.Client | None = None, sleep: Callable[[float], None] = time.sleep,
                 max_attempts: int = 4):
        if not cfg.secrets.lichess_token:
            raise SystemExit("Set LICHESS_TOKEN in .env (a Lichess personal API token, no scopes needed).")
        self.cfg = cfg
        self.client = client or httpx.Client(timeout=30)
        self.client.headers["Authorization"] = f"Bearer {cfg.secrets.lichess_token}"
        self.client.headers["User-Agent"] = (
            f"chess-coach/{__version__} (personal analysis; contact: {cfg.secrets.chesscom_contact_email or 'unset'})"
        )
        self.sleep = sleep
        self.max_attempts = max_attempts

    def position(self, key: str) -> dict:
        e = self.cfg.explorer
        params = {"variant": "standard", "fen": key, "speeds": ",".join(e.speeds),
                  "ratings": ",".join(map(str, e.ratings)), "moves": e.moves, "topGames": 0, "recentGames": 0}
        for attempt in range(self.max_attempts):
            try:
                response = self.client.get(e.url, params=params)
            except httpx.TransportError:
                self.sleep(10 * (attempt + 1))  # a dropped or slow connection: wait and try again
                continue
            if response.status_code == 429:
                self.sleep(60 * (attempt + 1))  # the API docs: wait a minute, longer for some limits
                continue
            response.raise_for_status()
            data = response.json()
            return {k: data.get(k) for k in ("white", "draws", "black", "moves", "opening")}
        raise RuntimeError(f"explorer still unavailable after {self.max_attempts} attempts")


def fetch(cfg: Config, conn: sqlite3.Connection, keys: Iterable[str], console: Console,
          explorer: Explorer | None = None) -> int:
    """Fetch every key not cached yet. Safe to interrupt: each response is stored as it arrives."""
    params = params_key(cfg)
    have = {row["key"] for row in conn.execute("SELECT key FROM explorer WHERE params = ?", (params,))}
    todo = sorted(set(keys) - have)
    if not todo:
        console.print(f"explorer: all {len(have)} positions cached")
        return 0
    explorer = explorer or Explorer(cfg)
    started = time.perf_counter()
    for i, key in enumerate(todo, 1):
        result = explorer.position(key)
        conn.execute("INSERT OR REPLACE INTO explorer (key, params, result, fetched_at) VALUES (?, ?, ?, ?)",
                     (key, params, json.dumps(result, separators=(",", ":")), int(time.time())))
        conn.commit()
        if i % 100 == 0:
            console.print(f"explorer: {i}/{len(todo)} positions")
    console.print(f"explorer: fetched {len(todo)} positions in {(time.perf_counter() - started) / 60:.1f} min")
    return len(todo)


def share(stats: dict | None, uci: str) -> tuple[float | None, int]:
    """How often players at my level chose `uci` here (percent of games), and how many games there are."""
    if not stats:
        return None, 0
    total = (stats.get("white") or 0) + (stats.get("draws") or 0) + (stats.get("black") or 0)
    if not total:
        return None, 0
    for m in stats.get("moves") or []:
        if m["uci"] == uci:
            return 100 * (m["white"] + m["draws"] + m["black"]) / total, total
    return 0.0, total
