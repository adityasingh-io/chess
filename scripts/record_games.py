"""Copy a few analysed games and their Stockfish results into tests/fixtures/games.json.

Model and export tests run on these instead of hand-written evaluations. The games are picked to
cover different loss causes, record types and marks. Stockfish lines are trimmed to pv_plies, which is
all the model reads. Run after `coach analyze`:
    uv run python scripts/record_games.py
"""

from __future__ import annotations

import json

from coach import db
from coach.analysis import load_games, planned_pass2_keys, select_game_ids
from coach.config import load_config
from coach.model import build_all
from coach.openings import load_openings, openings_dir

WANT = 14


def trim(result: dict, plies: int) -> dict:
    return {"lines": [{**line, "pv": line["pv"][:plies]} for line in result["lines"]]}


def main() -> None:
    cfg = load_config()
    conn = db.connect(cfg.db_path)
    engine = cfg.engine.version
    evals1 = db.load_evals(conn, engine, cfg.engine.pass1.key)
    evals2 = db.load_evals(conn, engine, cfg.engine.pass2.key)
    games = load_games(conn, select_game_ids(conn))
    models = build_all(cfg, games, evals1, evals2, load_openings(openings_dir(cfg.root), cfg.data_dir))

    # Greedy: each pick adds a loss cause or record type not covered yet; then fill with the rest.
    chosen, seen = [], set()
    for m in sorted(models, key=lambda m: m.id):
        tags = {f"cause:{m.loss.cause}"} if m.loss else {f"result:{m.row['result']}"}
        tags |= {f"type:{r.primary}" for r in m.records} | {f"sub:{r.subtype}" for r in m.records if r.subtype}
        tags |= {f"end:{m.endgame.outcome}"} if m.endgame else set()
        tags |= {f"mark:{p.mark.kind}" for p in m.plies if p.mark}
        if tags - seen:
            chosen.append(m)
            seen |= tags
        if len(chosen) >= WANT:
            break
    picked = [m.game for m in chosen]
    keys = {k for g in picked for k in g.position_keys()}
    keys2 = (keys | planned_pass2_keys(cfg, picked, evals1, evals2)) & set(evals2)
    plies = cfg.engine.pv_plies
    out = {
        "note": "Recorded from data/coach.sqlite by scripts/record_games.py: real games and Stockfish output "
                f"(lines trimmed to {plies} plies). Scores are White's view.",
        "engine": engine,
        "pass1": cfg.engine.pass1.key,
        "pass2": cfg.engine.pass2.key,
        "covers": sorted(seen),
        "games": [{**{k: g.row[k] for k in g.row.keys() if k != "pgn"}, "pgn": ""} for g in picked],
        "moves": [dict(m) for g in picked for m in g.moves],
        "evals1": {k: trim(evals1[k], plies) for k in sorted(keys) if k in evals1},
        "evals2": {k: trim(evals2[k], plies) for k in sorted(keys2)},
    }
    path = cfg.root / "tests" / "fixtures" / "games.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, separators=(",", ":")) + "\n")
    print(f"wrote {path}: {len(picked)} games covering {', '.join(sorted(seen))}")


if __name__ == "__main__":
    main()
