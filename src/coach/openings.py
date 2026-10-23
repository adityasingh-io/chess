"""Opening names from the lichess-org chess-openings dataset (CC0), looked up by position.

A move is Book when the position it reaches is a named position in the dataset, and a game's
opening is the deepest named position it reaches (so transpositions get the right name).
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import chess

from coach.positions import position_key

MOVE_NUMBER = re.compile(r"^\d+\.+$")


@dataclass(frozen=True)
class Opening:
    eco: str
    name: str  # "Family: Variation, Subvariation, ..."

    @property
    def family(self) -> str:
        return self.name.split(":")[0].strip()

    @property
    def variation(self) -> str | None:
        rest = self.name.partition(":")[2]
        return rest.split(",")[0].strip() or None if rest else None


def _key_after(pgn: str) -> str:
    board = chess.Board()
    for token in pgn.split():
        if not MOVE_NUMBER.match(token):
            board.push_san(token)
    return position_key(board)


@cache
def load_openings(directory: Path, cache_dir: Path | None = None) -> dict[str, Opening]:
    """Position key -> opening. Where several lines name the same position, the first in file order wins.

    Replaying every line takes a second or two, so the index is cached in cache_dir, keyed by the
    dataset's contents.
    """
    paths = sorted(directory.glob("*.tsv"))
    digest = hashlib.sha256(b"".join(p.read_bytes() for p in paths)).hexdigest()[:16]
    cached = cache_dir / f"openings-{digest}.json" if cache_dir else None
    if cached and cached.exists():
        return {k: Opening(*v) for k, v in json.loads(cached.read_text()).items()}
    out: dict[str, Opening] = {}
    for path in paths:
        with path.open(newline="") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                out.setdefault(_key_after(row["pgn"]), Opening(row["eco"], row["name"]))
    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps({k: [o.eco, o.name] for k, o in out.items()}))
    return out


def openings_dir(root: Path) -> Path:
    return root / "vendor" / "chess-openings"
