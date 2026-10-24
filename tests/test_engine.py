"""Runs real Stockfish: results must not depend on what the engine searched before."""

import pytest
from rich.console import Console

from coach import db
from coach.config import SearchSettings, load_config
from coach.engine import analyse_one, analyse_positions, check_engine, open_engine

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"
AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -"
SETTINGS = SearchSettings(nodes=100_000, multipv=2, hash_mb=16)

cfg = load_config()
pytestmark = [
    pytest.mark.engine,
    pytest.mark.skipif(not cfg.secrets.stockfish_path, reason="STOCKFISH_PATH not set"),
]


def test_same_position_same_result_regardless_of_order():
    with open_engine(cfg.secrets.stockfish_path, SETTINGS) as engine:
        first = analyse_one(engine, START, SETTINGS)
        analyse_one(engine, AFTER_E4, SETTINGS)
        again = analyse_one(engine, START, SETTINGS)
    assert first == again


def test_engine_version_is_pinned():
    assert check_engine(cfg.secrets.stockfish_path, cfg.engine.version) == cfg.engine.version
    with pytest.raises(SystemExit):
        check_engine(cfg.secrets.stockfish_path, "Stockfish 0")


def test_pool_caches_and_skips(tmp_path):
    conn = db.connect(tmp_path / "t.sqlite")
    common = dict(engine_path=cfg.secrets.stockfish_path, engine=cfg.engine.version, workers=2,
                  console=Console(quiet=True), label="t")
    first = analyse_positions(conn, [START, AFTER_E4, START], SETTINGS, **common)
    assert (first.requested, first.analysed) == (2, 2)
    second = analyse_positions(conn, [START, AFTER_E4], SETTINGS, **common)
    assert (second.cached, second.analysed) == (2, 0)
    stored = db.load_evals(conn, cfg.engine.version, SETTINGS.key)
    assert set(stored) == {START, AFTER_E4}
    assert len(stored[START]["lines"]) == 2


def test_recorded_results_repeat_exactly():
    """Stockfish output recorded on the Mac comes back the same here, so machines can share the cache."""
    import json
    from pathlib import Path

    from conftest import settings_from_key

    data = json.loads((Path(__file__).parent / "fixtures" / "games.json").read_text())
    settings = settings_from_key(data["pass1"])
    keys = sorted(data["evals1"])[:: max(1, len(data["evals1"]) // 4)][:4]
    plies = max(len(line["pv"]) for key in keys for line in data["evals1"][key]["lines"])  # scripts/record_games.py trims lines
    with open_engine(cfg.secrets.stockfish_path, settings) as engine:
        for key in keys:
            now = analyse_one(engine, key, settings)
            assert [{**line, "pv": line["pv"][:plies]} for line in now["lines"]] == data["evals1"][key]["lines"], key
