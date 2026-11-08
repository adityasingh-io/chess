"""Opening names, looked up by position: the lichess-org chess-openings dataset (CC0), and the positions Scid's
ECO file (GPL, vendor/scid) adds, named in Lichess's terms.

A move is Book when the position it reaches is on the list, and a game's opening is the deepest listed position
it reaches (so transpositions get the right name). A position only Scid lists is named after the deepest position
Lichess's dataset names along Scid's own line to it, so every name is one of Lichess's (PLAN.md, Decisions).
"""

from __future__ import annotations

import csv
import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path

import chess

from coach.positions import position_key

MOVE_NUMBER = re.compile(r"^\d+\.+$")
SCID_ENTRY = re.compile(r'\s*[A-E]\d\d[a-z]?\d?\s+"[^"]*"\s*(.*)', re.S)   # code "name" moves, ended by '*'


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


def scid_lines(path: Path) -> list[list[str]]:
    """The SAN moves of each line in Scid's ECO file, in file order ('#' starts a comment)."""
    text = "\n".join(line.split("#")[0] for line in path.read_text(encoding="latin-1").splitlines())
    lines = []
    for chunk in text.split("*"):
        if m := SCID_ENTRY.match(chunk):
            lines.append([t for t in (re.sub(r"^\d+\.+", "", tok) for tok in m.group(1).split()) if t])
    return lines


_INDEXES: dict[str, dict[str, Opening]] = {}   # by the files' digest, so every caller in a process shares one


def load_openings(directory: Path, cache_dir: Path | None = None) -> dict[str, Opening]:
    """Position key -> opening: Lichess's lines (`directory`), then the positions Scid's lines (`directory`'s
    sibling scid/scid.eco, when present) add. Where several lines name the same position, the first in file
    order wins, Lichess's before Scid's.

    Replaying every line takes a few seconds, so the index is kept in memory and cached in cache_dir, both keyed
    by the files' contents.
    """
    paths = sorted(directory.glob("*.tsv"))
    scid = directory.parent / "scid" / "scid.eco"
    digest = hashlib.sha256(b"".join(p.read_bytes() for p in [*paths, *([scid] if scid.exists() else [])])).hexdigest()[:16]
    if digest not in _INDEXES:
        _INDEXES[digest] = _index(paths, scid, cache_dir / f"openings-{digest}.json" if cache_dir else None)
    return _INDEXES[digest]


def _index(paths: list[Path], scid: Path, cached: Path | None) -> dict[str, Opening]:
    if cached and cached.exists():
        return {k: Opening(*v) for k, v in json.loads(cached.read_text()).items()}
    lichess: dict[str, Opening] = {}
    for path in paths:
        with path.open(newline="") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                lichess.setdefault(_key_after(row["pgn"]), Opening(row["eco"], row["name"]))
    out = dict(lichess)
    for moves in scid_lines(scid) if scid.exists() else []:
        board, name = chess.Board(), None
        try:
            for san in moves:
                board.push_san(san)
                name = lichess.get(position_key(board), name)
        except ValueError:
            continue   # a line that doesn't replay names nothing
        if name:
            out.setdefault(position_key(board), name)
    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps({k: [o.eco, o.name] for k, o in out.items()}))
    return out


def openings_dir(root: Path) -> Path:
    return root / "vendor" / "chess-openings"
