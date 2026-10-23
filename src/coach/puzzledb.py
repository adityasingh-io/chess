"""The Lichess puzzle database (CC0): engine-verified puzzles with human-voted themes.

The FEN is the position before the opponent's move; the first move in `Moves` is that move and
the rest is the solution.
"""

from __future__ import annotations

import codecs
import csv
import io
from collections.abc import Iterator
from itertools import islice
from pathlib import Path

import httpx
import zstandard

from coach import __version__

FIELDS = ["PuzzleId", "FEN", "Moves", "Rating", "RatingDeviation", "Popularity", "NbPlays", "Themes",
          "GameUrl", "OpeningTags"]


def _lines_from_url(url: str, contact_email: str | None) -> Iterator[str]:
    """Decompressed lines streamed from the URL; stops downloading when the caller stops reading."""
    headers = {"User-Agent": f"chess-coach/{__version__} (personal analysis; contact: {contact_email or 'unset'})"}
    decompressor = zstandard.ZstdDecompressor().decompressobj(read_across_frames=True)
    text = codecs.getincrementaldecoder("utf-8")()
    pending = ""
    with httpx.stream("GET", url, headers=headers, timeout=60, follow_redirects=True) as response:
        response.raise_for_status()
        for chunk in response.iter_bytes():
            pending += text.decode(decompressor.decompress(chunk))
            *lines, pending = pending.split("\n")
            yield from lines
    if pending:
        yield pending


def _lines_from_file(path: Path) -> Iterator[str]:
    with path.open("rb") as raw:
        reader = zstandard.ZstdDecompressor().stream_reader(raw, read_across_frames=True)
        yield from (line.rstrip("\n") for line in io.TextIOWrapper(reader, encoding="utf-8"))


def puzzles(lines: Iterator[str]) -> Iterator[dict]:
    reader = csv.DictReader(lines)
    for row in reader:
        row["Themes"] = row["Themes"].split()
        row["OpeningTags"] = row.get("OpeningTags", "").split()
        yield row


def sample(cfg, n: int | None = None) -> list[dict]:
    """The first n puzzles, from the local full file if downloaded, else streamed once and kept in data/."""
    n = n or cfg.tagger_check.sample
    full = cfg.data_dir / "lichess_db_puzzle.csv.zst"
    cached = cfg.data_dir / "lichess_puzzle_sample.csv"
    if not full.exists() and cached.exists():
        with cached.open(newline="") as f:
            rows = list(islice(puzzles(iter(f.read().splitlines())), n))
        if len(rows) >= n:
            return rows
    lines = _lines_from_file(full) if full.exists() else _lines_from_url(cfg.tagger_check.puzzle_url, cfg.secrets.chesscom_contact_email)
    try:
        header = next(lines)
        raw = list(islice(lines, n))
    finally:
        lines.close()
    if not full.exists():
        cfg.data_dir.mkdir(parents=True, exist_ok=True)
        cached.write_text("\n".join([header, *raw]) + "\n")
    return list(puzzles(iter([header, *raw])))
