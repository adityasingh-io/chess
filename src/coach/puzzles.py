"""Puzzles from my own mistakes and a subset of the Lichess puzzle database (BRIEF.md step 5).

Mine start in the position before my move. The solution is Stockfish's line from there, kept while each
of my moves in it is clearly best in pass 2 (best minus second-best at least min_gap), up to max_plies;
a missed-win record instead keeps the winning line the human-findable filter accepted, up to the move
that wins the material. Only records pass 2 confirms become puzzles. The opponent's moves are
Stockfish's replies.

The Lichess subset is read once from the CC0 puzzle file (streamed, never stored whole): puzzles in a
rating range with decent popularity and play counts, picked by the Lichess themes my mistakes match and
by my openings' OpeningTags, the most popular first, spread across rating bands. The selection is cached
in data/ so later builds don't download it again.
"""

from __future__ import annotations

import hashlib
import heapq
import json
import math
import re
from collections import Counter
from collections.abc import Iterable, Iterator
from dataclasses import asdict

import chess
from rich.console import Console

from coach import puzzledb
from coach.analysis import gap
from coach.config import Config
from coach.model import GameModel, Record, best_line

# My tags and the Lichess themes that train the same thing (BRIEF.md mapping; mates for both mate types).
MATES = ["mateIn1", "mateIn2", "mateIn3", "backRankMate"]
MOTIFS = ["fork", "pin", "skewer", "discoveredAttack", "doubleCheck"]
TAG_THEMES: dict[str, list[str]] = {
    "hung_piece": ["hangingPiece"],
    "free_material": ["hangingPiece"],
    "fork": ["fork"],
    "pin": ["pin"],
    "skewer": ["skewer"],
    "discovered_attack": ["discoveredAttack"],
    "double_check": ["doubleCheck"],
    "allowed_mate": MATES,
    "missed_mate": MATES,
    "tactic": MOTIFS,
    "missed_win": ["hangingPiece", *MOTIFS],
}
# Flags that only label Lichess puzzles (for filtering); they don't pick any.
FLAG_THEMES = {"opening": "opening", "endgame": "endgame"}
BUCKET_THEMES = ["hangingPiece", *MOTIFS, *MATES]


def sans(fen: str, ucis: list[str]) -> list[str]:
    board = chess.Board(fen)
    out = []
    for uci in ucis:
        move = chess.Move.from_uci(uci)
        out.append(board.san(move))
        board.push(move)
    return out


# --- mine ------------------------------------------------------------------------------------------

def my_solution(cfg: Config, r: Record, evals2: dict[str, dict]) -> tuple[list[str], list[bool]] | None:
    """The solution line and, per move of mine in it, whether it is clearly best; None if not a puzzle."""
    if r.confirmed is not True:
        return None
    min_gap, limit = cfg.engine.triggers.min_gap, cfg.puzzles.max_plies
    key, white = r.ply.move["key_before"], r.ply.white
    first = evals2.get(key)
    line, gaps = best_line(cfg, key, first, evals2, white)
    clear = lambda i: (g := gaps.get(i)) is not None and g >= min_gap  # noqa: E731
    if r.primary == "missed_win" and r.win_moves:
        solution = r.best_line[: 2 * r.win_moves - 1]
        return (solution, [clear(i) for i in range(0, len(solution), 2)]) if solution else None
    g = gap(first, white)
    if g is None or g < min_gap or not line:
        return None
    end = 1
    while end + 1 < len(line) and end + 2 <= limit and clear(end + 1):
        end += 2
    return line[:end], [True] * ((end + 1) // 2)


def my_puzzles(cfg: Config, models: list[GameModel], evals2: dict[str, dict]) -> list[dict]:
    out = []
    for m in models:
        for r in m.records:
            found = my_solution(cfg, r, evals2)
            if not found:
                continue
            solution, unique = found
            fen = r.ply.move["fen_before"]
            previous = m.plies[r.ply.number - 2] if r.ply.number >= 2 else None
            out.append(dict(
                id=f"m-{r.id}", source="mine", fen=fen, last_move=previous.move["uci"] if previous else None,
                solution=solution, solution_san=sans(fen, solution), unique=unique, tags=r.tags, themes=r.themes,
                rating=None, game=m.id, ply=r.ply.number, played_san=r.ply.move["san"], drop=round(r.ply.drop, 1),
                opening=m.opening.family if m.opening else None, url=None,
            ))
    return out


# --- Lichess ---------------------------------------------------------------------------------------

def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def lichess_tags(themes: Iterable[str]) -> list[str]:
    have = set(themes)
    tags = [tag for tag, wanted in TAG_THEMES.items() if have.intersection(wanted)]
    return tags + [flag for flag, theme in FLAG_THEMES.items() if theme in have]


def quotas(cfg: Config, records: list[Record]) -> tuple[dict[str, int], int]:
    """Puzzles per theme (at least theme_min, the rest shared by how often my records match the theme)
    and the number picked by opening."""
    p = cfg.puzzles
    weight = Counter(t for r in records for t in r.themes if t in BUCKET_THEMES)
    by_opening = round(p.lichess_count * p.lichess_opening_share)
    rest = max(0, p.lichess_count - by_opening - p.lichess_theme_min * len(BUCKET_THEMES))
    total = sum(weight.values()) or 1
    return {t: p.lichess_theme_min + round(rest * weight[t] / total) for t in BUCKET_THEMES}, by_opening


def top_families(models: list[GameModel], n: int) -> list[str]:
    count = Counter(m.opening.family for m in models if m.opening)
    return [f for f, _ in count.most_common(n)]


def select(cfg: Config, rows: Iterator[dict], theme_quota: dict[str, int], families: list[str], by_opening: int) -> list[dict]:
    """The most popular puzzles per (theme or family, rating band) within the quotas."""
    p = cfg.puzzles
    lo, hi = p.lichess_ratings
    bands = max(1, math.ceil((hi - lo) / p.lichess_band))
    wanted = {_norm(f): f for f in families}
    per_band = {**{("theme", t): math.ceil(q / bands) for t, q in theme_quota.items()},
                **{("opening", f): math.ceil(by_opening / max(1, len(families)) / bands) for f in families}}
    heaps: dict[tuple, list] = {}
    for row in rows:
        rating = int(row["Rating"])
        if not lo <= rating < hi or int(row["Popularity"]) < p.lichess_min_popularity or int(row["NbPlays"]) < p.lichess_min_plays:
            continue
        band = (rating - lo) // p.lichess_band
        rank = (int(row["Popularity"]), int(row["NbPlays"]), row["PuzzleId"])
        groups = [("theme", t) for t in row["Themes"] if ("theme", t) in per_band]
        tags = {_norm(t) for t in row["OpeningTags"]}
        groups += [("opening", f) for n, f in wanted.items() if n in tags]
        for group in groups:
            heap = heaps.setdefault((group, band), [])
            item = (rank, {k: row.get(k) for k in puzzledb.FIELDS})
            if len(heap) < per_band[group]:
                heapq.heappush(heap, item)
            elif rank > heap[0][0]:
                heapq.heapreplace(heap, item)
    chosen: dict[str, dict] = {}
    for heap in heaps.values():
        for _, row in heap:
            chosen.setdefault(row["PuzzleId"], row)
    return sorted(chosen.values(), key=lambda r: r["PuzzleId"])


def lichess_puzzle(row: dict) -> dict:
    """The export form of a Lichess row: its first move is the opponent's, played before the puzzle starts."""
    moves = row["Moves"].split()
    board = chess.Board(row["FEN"])
    board.push(chess.Move.from_uci(moves[0]))
    fen, solution = board.fen(), moves[1:]
    return dict(
        id=f"l-{row['PuzzleId']}", source="lichess", fen=fen, last_move=moves[0], solution=solution,
        solution_san=sans(fen, solution), unique=[True] * ((len(solution) + 1) // 2), tags=lichess_tags(row["Themes"]),
        themes=list(row["Themes"]), rating=int(row["Rating"]), game=None, ply=None, played_san=None, drop=None,
        opening=" ".join(row["OpeningTags"]).replace("_", " ") or None,
        url=f"https://lichess.org/training/{row['PuzzleId']}",
    )


def _cache_path(cfg: Config):
    return cfg.data_dir / "lichess_puzzles.json"


def signature(cfg: Config) -> str:
    """Selection settings that make a cached subset stale when they change."""
    p = {k: v for k, v in asdict(cfg.puzzles).items() if k.startswith("lichess")}
    return hashlib.sha256(json.dumps(p, sort_keys=True, default=list).encode()).hexdigest()[:16]


def load_subset(cfg: Config) -> list[dict] | None:
    path = _cache_path(cfg)
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    return data["rows"] if data.get("signature") == signature(cfg) else None


def fetch_subset(cfg: Config, models: list[GameModel], console: Console, refresh: bool = False) -> int:
    """Stream the puzzle file once and cache the selection; returns the number of puzzles kept."""
    if not refresh and (rows := load_subset(cfg)) is not None:
        console.print(f"lichess puzzles: {len(rows):,} cached")
        return len(rows)
    records = [r for m in models for r in m.records]
    theme_quota, by_opening = quotas(cfg, records)
    families = top_families(models, cfg.puzzles.lichess_families)
    full = cfg.data_dir / "lichess_db_puzzle.csv.zst"
    console.print("lichess puzzles: reading " + (str(full) if full.exists() else cfg.tagger_check.puzzle_url)
                  + " (about 300 MB, streamed)")
    lines = puzzledb._lines_from_file(full) if full.exists() else puzzledb._lines_from_url(
        cfg.tagger_check.puzzle_url, cfg.secrets.chesscom_contact_email)
    rows = select(cfg, puzzledb.puzzles(lines), theme_quota, families, by_opening)
    cfg.data_dir.mkdir(parents=True, exist_ok=True)
    _cache_path(cfg).write_text(json.dumps({"signature": signature(cfg), "families": families, "quota": theme_quota,
                                            "rows": rows}, separators=(",", ":")))
    console.print(f"lichess puzzles: kept {len(rows):,} for {len(theme_quota)} themes and {len(families)} openings")
    return len(rows)
