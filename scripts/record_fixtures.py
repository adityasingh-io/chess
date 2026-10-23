"""Copy a few real Stockfish results from the cache into tests/fixtures/recorded_evals.json.

Tests use these instead of hand-written evaluations. Run after `coach analyze`:
    uv run python scripts/record_fixtures.py
"""

from __future__ import annotations

import json

from coach import db
from coach.analysis import gap
from coach.config import load_config
from coach.positions import board_from_key


def main() -> None:
    cfg = load_config()
    conn = db.connect(cfg.db_path)
    engine = cfg.engine.version
    evals1 = db.load_evals(conn, engine, cfg.engine.pass1.key)
    evals2 = db.load_evals(conn, engine, cfg.engine.pass2.key)

    def white(key: str) -> bool:
        return board_from_key(key).turn

    def first(evals: dict[str, dict], pred) -> tuple[str, dict]:
        return next((k, v) for k, v in sorted(evals.items()) if pred(k, v))

    picks = {
        "mate_for_side_to_move": first(evals1, lambda k, v: (m := v["lines"][0]["mate"]) is not None and (m > 0) == white(k)),
        "mated_side_to_move": first(evals1, lambda k, v: (m := v["lines"][0]["mate"]) is not None and (m > 0) != white(k)),
        "one_clear_best_pass2": first(evals2, lambda k, v: (g := gap(v, white(k))) is not None and g >= 20 and len(v["lines"][0]["pv"]) >= 4),
        "close_pass2": first(evals2, lambda k, v: (g := gap(v, white(k))) is not None and g < 2 and len(v["lines"]) == 3),
    }
    out = {
        "engine": engine,
        "note": "Recorded Stockfish output copied from data/coach.sqlite by scripts/record_fixtures.py. Scores are White's view.",
        "positions": {
            name: {"key": key, "settings": cfg.engine.pass1.key if name.startswith("mate") else cfg.engine.pass2.key, "result": result}
            for name, (key, result) in picks.items()
        },
    }
    path = cfg.root / "tests" / "fixtures" / "recorded_evals.json"
    path.write_text(json.dumps(out, indent=2) + "\n")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()
