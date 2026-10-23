"""Copy Lichess puzzles into tests/fixtures/puzzles.json for the tagger tests.

Takes up to N non-mate puzzles per theme the tagger knows, plus N with none of those themes,
from the tagger-check sample (data/lichess_puzzle_sample.csv; `coach tagger-check` fetches it).
    uv run python scripts/record_puzzles.py
"""

from __future__ import annotations

import json

from coach import puzzledb
from coach.config import load_config
from coach.tactics import LICHESS_THEME

N = 40


def main() -> None:
    cfg = load_config()
    rows = [r for r in puzzledb.sample(cfg) if "mate" not in r["Themes"]]
    themes = set(LICHESS_THEME.values())
    picked: dict[str, dict] = {}
    for theme in sorted(themes):
        for r in [r for r in rows if theme in r["Themes"]][:N]:
            picked[r["PuzzleId"]] = r
    for r in [r for r in rows if not themes & set(r["Themes"])][:N]:
        picked[r["PuzzleId"]] = r
    out = {
        "note": "Lichess puzzle database (CC0), https://database.lichess.org/ — copied by scripts/record_puzzles.py. "
                "FEN is before the opponent's move; Moves starts with it.",
        "puzzles": [{k: r[k] for k in ("PuzzleId", "FEN", "Moves", "Rating", "Themes")} for r in picked.values()],
    }
    path = cfg.root / "tests" / "fixtures" / "puzzles.json"
    path.write_text(json.dumps(out, indent=0) + "\n")
    print(f"wrote {path}: {len(picked)} puzzles")


if __name__ == "__main__":
    main()
