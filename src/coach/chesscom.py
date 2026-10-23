"""Incremental fetch of monthly game archives from the chess.com public API."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from collections.abc import Callable
from datetime import UTC, datetime

import httpx
from rich.console import Console

from coach import __version__
from coach.config import Config

API = "https://api.chess.com/pub"
# A month is complete once we've fetched it this long after it ended.
COMPLETE_AFTER_MONTH_END = 2 * 3600


class ChessCom:
    """Sequential client that identifies itself and backs off on HTTP 429 and 5xx."""

    def __init__(
        self,
        contact_email: str,
        *,
        client: httpx.Client | None = None,
        max_attempts: int = 6,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.client = client or httpx.Client(timeout=30, follow_redirects=True)
        self.client.headers["User-Agent"] = f"chess-coach/{__version__} (personal analysis; contact: {contact_email})"
        self.max_attempts = max_attempts
        self.sleep = sleep

    def get_json(self, url: str) -> dict:
        for attempt in range(self.max_attempts):
            response = self.client.get(url)
            if response.status_code == 429 or response.status_code >= 500:
                retry_after = response.headers.get("Retry-After")
                wait = float(retry_after) if retry_after and retry_after.isdigit() else min(60.0, 2.0 * 2**attempt)
                self.sleep(wait)
                continue
            response.raise_for_status()
            return response.json()
        raise RuntimeError(f"chess.com kept refusing {url} after {self.max_attempts} attempts")


def archive_month(url: str) -> str:
    """'https://api.chess.com/pub/player/x/games/2026/03' -> '2026-03'."""
    year, month = url.rstrip("/").split("/")[-2:]
    return f"{year}-{month}"


def month_end_ts(month: str) -> int:
    year, mon = (int(part) for part in month.split("-"))
    year, mon = (year + 1, 1) if mon == 12 else (year, mon + 1)
    return int(datetime(year, mon, 1, tzinfo=UTC).timestamp())


def needs_fetch(month: str, fetched_at: int | None) -> bool:
    """Fetch months never seen, and re-fetch any month last fetched before it was over."""
    return fetched_at is None or fetched_at < month_end_ts(month) + COMPLETE_AFTER_MONTH_END


def fetch(cfg: Config, conn: sqlite3.Connection, console: Console, api: ChessCom | None = None) -> list[str]:
    if api is None:
        if not cfg.secrets.chesscom_contact_email:
            raise SystemExit("Set CHESSCOM_CONTACT_EMAIL in .env (copy .env.example) before fetching.")
        api = ChessCom(cfg.secrets.chesscom_contact_email)

    since_month = cfg.player.since.strftime("%Y-%m")
    archives = api.get_json(f"{API}/player/{cfg.player.username.lower()}/games/archives")["archives"]
    cfg.raw_dir.mkdir(parents=True, exist_ok=True)

    updated = []
    for url in archives:
        month = archive_month(url)
        if month < since_month:
            continue
        row = conn.execute("SELECT fetched_at FROM archives WHERE month = ?", (month,)).fetchone()
        if not needs_fetch(month, row["fetched_at"] if row else None):
            continue
        data = api.get_json(url)
        body = json.dumps(data, sort_keys=True, separators=(",", ":"))
        (cfg.raw_dir / f"{month}.json").write_text(body)
        conn.execute(
            """INSERT INTO archives (month, url, fetched_at, sha256) VALUES (?, ?, ?, ?)
               ON CONFLICT(month) DO UPDATE SET url = excluded.url, fetched_at = excluded.fetched_at,
               sha256 = excluded.sha256""",
            (month, url, int(time.time()), hashlib.sha256(body.encode()).hexdigest()),
        )
        conn.commit()
        updated.append(month)
        console.print(f"fetched {month}: {len(data.get('games', []))} games")
    if not updated:
        console.print("archives up to date")
    return updated
