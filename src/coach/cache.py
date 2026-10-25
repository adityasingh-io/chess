"""The shared cache (docs/PLAN.md): the Mac and the nightly Action never redo each other's work.

What is slow to rebuild goes up as one compressed SQLite file on a GitHub release named `cache`: Stockfish
results, explorer responses and AI notes, with the Lichess puzzle subset next to it. Games and moves stay
out, since `coach fetch` and `coach parse` rebuild them from chess.com in seconds. Pulling merges and never
overwrites (a row already here stays), so either machine can add rows and push. Pushing pulls first, since
the upload replaces the release's file: rows the other machine added since this one last pulled stay in it.

Uses the GitHub CLI: signed in with `gh auth login` on the Mac, GITHUB_TOKEN in the Action.
"""

from __future__ import annotations

import shutil
import sqlite3
import subprocess
import tempfile
from pathlib import Path

import zstandard

from coach.config import Config
from coach.notes import SCHEMA as NOTES_SCHEMA

RELEASE = "cache"
DB_ASSET = "coach-cache.sqlite.zst"
PUZZLES_ASSET = "lichess_puzzles.json"
TABLES = ("evals", "explorer", "notes")


def pack(conn: sqlite3.Connection, out: Path) -> dict[str, int]:
    """Write the shared tables to `out` (zstd-compressed SQLite). Returns rows per table."""
    conn.executescript(NOTES_SCHEMA)
    conn.commit()
    with tempfile.TemporaryDirectory() as tmp:
        slim = Path(tmp) / "slim.sqlite"
        conn.execute("VACUUM INTO ?", (str(slim),))
        small = sqlite3.connect(slim)
        names = [r[0] for r in small.execute("SELECT name FROM sqlite_master WHERE type = 'table'")]
        for name in names:
            if name not in TABLES:
                small.execute(f"DROP TABLE {name}")
        small.commit()
        small.execute("VACUUM")
        counts = {t: small.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in TABLES}
        small.close()
        with slim.open("rb") as src, out.open("wb") as dst:
            zstandard.ZstdCompressor(level=10).copy_stream(src, dst)
    return counts


def merge(conn: sqlite3.Connection, packed: Path) -> dict[str, int]:
    """Add the rows of a packed cache that aren't here yet. Returns rows added per table."""
    conn.executescript(NOTES_SCHEMA)
    conn.commit()
    added = {}
    with tempfile.TemporaryDirectory() as tmp:
        slim = Path(tmp) / "slim.sqlite"
        with packed.open("rb") as src, slim.open("wb") as dst:
            zstandard.ZstdDecompressor().copy_stream(src, dst)
        conn.execute("ATTACH DATABASE ? AS shared", (str(slim),))
        try:
            present = {r[0] for r in conn.execute("SELECT name FROM shared.sqlite_master WHERE type = 'table'")}
            for t in TABLES:
                if t not in present:
                    continue
                cols = ", ".join(r[1] for r in conn.execute(f"PRAGMA shared.table_info({t})"))
                before = conn.total_changes
                conn.execute(f"INSERT OR IGNORE INTO main.{t} ({cols}) SELECT {cols} FROM shared.{t}")
                added[t] = conn.total_changes - before
            conn.commit()
        finally:
            if conn.in_transaction:
                conn.rollback()
            conn.execute("DETACH DATABASE shared")
    return added


def _gh(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    if not shutil.which("gh"):
        raise SystemExit("The shared cache needs the GitHub CLI (https://cli.github.com), signed in with `gh auth login`.")
    return subprocess.run(["gh", *args], capture_output=True, text=True, check=check)


def push(cfg: Config, conn: sqlite3.Connection, log) -> None:
    if _gh("release", "view", RELEASE, check=False).returncode == 0:
        _take(cfg, conn, log)
    else:
        _gh("release", "create", RELEASE, "--title", "Pipeline cache", "--latest=false", "--notes",
            "Stockfish results, explorer responses and notes for `coach cache pull` (src/coach/cache.py).")
    with tempfile.TemporaryDirectory() as tmp:
        packed = Path(tmp) / DB_ASSET
        counts = pack(conn, packed)
        assets = [str(packed)]
        puzzles = cfg.data_dir / PUZZLES_ASSET
        if puzzles.exists():
            assets.append(str(puzzles))
        _gh("release", "upload", RELEASE, *assets, "--clobber")
        size = packed.stat().st_size / 1e6
    log(f"cache: pushed {', '.join(f'{n} {t}' for t, n in counts.items())} ({size:.1f} MB)")


def pull(cfg: Config, conn: sqlite3.Connection, log) -> bool:
    """False if there's no cache release yet."""
    if _gh("release", "view", RELEASE, check=False).returncode != 0:
        log("cache: no `cache` release yet; run `coach cache push` on a machine that has the analysis")
        return False
    _take(cfg, conn, log)
    return True


def _take(cfg: Config, conn: sqlite3.Connection, log) -> None:
    """Merge the release's rows into `conn`, and take its puzzle subset when there's none here."""
    with tempfile.TemporaryDirectory() as tmp:
        _gh("release", "download", RELEASE, "--dir", tmp, "--clobber", "--pattern", DB_ASSET, "--pattern", PUZZLES_ASSET)
        added = merge(conn, Path(tmp) / DB_ASSET)
        puzzles = Path(tmp) / PUZZLES_ASSET
        mine = cfg.data_dir / PUZZLES_ASSET
        if puzzles.exists() and not mine.exists():
            shutil.copyfile(puzzles, mine)
            log("cache: took the Lichess puzzle subset")
    log(f"cache: added {', '.join(f'{n} {t}' for t, n in added.items())}")
