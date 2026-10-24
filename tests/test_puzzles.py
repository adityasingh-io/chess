"""Puzzles from my records (recorded Stockfish output), the Lichess puzzle form and subset selection,
and the repertoire PGN reader."""

import json
from dataclasses import replace
from pathlib import Path

import chess

from coach.analysis import gap
from coach.puzzles import ENDGAME_THEMES, BUCKET_THEMES, endgame_tags, lichess_puzzle, lichess_tags, my_puzzles, quotas, select
from coach.repertoire import line_id, named_line, read_pgn

PUZZLES = json.loads((Path(__file__).parent / "fixtures" / "puzzles.json").read_text())["puzzles"]


def test_my_puzzles_follow_stockfish(recorded):
    r = recorded
    min_gap, limit = r.cfg.engine.triggers.min_gap, r.cfg.puzzles.max_plies
    records = {rec.id: rec for m in r.models for rec in m.records}
    puzzles = my_puzzles(r.cfg, r.models, r.evals2)
    assert puzzles
    for p in puzzles:
        rec = records[p["id"].removeprefix("m-")]
        assert rec.confirmed is True
        assert p["fen"] == rec.ply.move["fen_before"] and p["played_san"] == rec.ply.move["san"]
        # My move's line: what I played, then Stockfish's line after it.
        assert p["played_line"] == [rec.ply.move["uci"], *rec.reply_line][: len(p["played_line"])]
        assert p["played_line_san"][0] == rec.ply.move["san"] and len(p["played_line_san"]) == len(p["played_line"])
        # The solution starts with Stockfish's best move and is Stockfish's line, ending on my move.
        assert p["solution"] == rec.best_line[: len(p["solution"])]
        assert len(p["solution"]) % 2 == 1 and len(p["solution"]) <= limit
        assert len(p["unique"]) == (len(p["solution"]) + 1) // 2
        board = chess.Board(p["fen"])
        for uci, san in zip(p["solution"], p["solution_san"], strict=True):
            move = chess.Move.from_uci(uci)
            assert move in board.legal_moves and board.san(move) == san
            board.push(move)
        if rec.primary != "missed_win":
            assert all(p["unique"])
            assert gap(r.evals2[rec.ply.move["key_before"]], rec.ply.white) >= min_gap
        else:
            assert len(p["solution"]) == 2 * rec.win_moves - 1


def test_lichess_puzzle_starts_after_the_first_move():
    row = {**PUZZLES[0], "OpeningTags": [], "Popularity": "90", "NbPlays": "1000"}
    p = lichess_puzzle(row)
    moves = row["Moves"].split()
    board = chess.Board(row["FEN"])
    board.push_uci(moves[0])
    assert p["fen"] == board.fen() and p["last_move"] == moves[0] and p["solution"] == moves[1:]
    assert p["id"] == f"l-{row['PuzzleId']}" and p["url"].endswith(row["PuzzleId"])
    assert "discovered_attack" in p["tags"] and "tactic" in p["tags"]


def test_endgame_tags_by_the_material_on_the_board(recorded):
    cfg = recorded.cfg
    assert endgame_tags(cfg, "8/5k2/3r4/8/8/2R5/2K5/8 w - - 0 1") == ["endgame_rook"]
    assert endgame_tags(cfg, "8/5k2/3p4/8/8/2P5/2K5/8 w - - 0 1") == ["endgame_pawn"]
    assert endgame_tags(cfg, "r3k3/8/8/8/8/8/8/R2QK3 w - - 0 1") == []   # White has 14 points of pieces
    for p in my_puzzles(cfg, recorded.models, recorded.evals2):
        assert [t for t in p["tags"] if t.startswith("endgame_")] == endgame_tags(cfg, p["fen"])


def test_endgame_themes_are_picked_on_top(recorded):
    cfg = recorded.cfg
    quota, _ = quotas(cfg, [r for m in recorded.models for r in m.records])
    assert {t: quota[t] for t in ENDGAME_THEMES} == {t: cfg.puzzles.lichess_endgame_min for t in ENDGAME_THEMES}
    # The themes my mistakes match still share lichess_count between them and the openings.
    assert sum(quota[t] for t in BUCKET_THEMES) <= cfg.puzzles.lichess_count


def test_lichess_tags_follow_the_mapping():
    assert lichess_tags(["hangingPiece", "endgame"]) == ["hung_piece", "free_material", "missed_win", "endgame"]
    assert set(lichess_tags(["mateIn2"])) == {"allowed_mate", "missed_mate"}
    assert lichess_tags(["advantage"]) == []


def test_select_keeps_the_most_popular_within_limits(recorded):
    cfg = replace(recorded.cfg, puzzles=replace(recorded.cfg.puzzles, lichess_ratings=(400, 2600), lichess_band=1100,
                                                lichess_min_popularity=50, lichess_min_plays=100))
    rows = [{**p, "Popularity": str(40 + i % 60), "NbPlays": str(50 + 10 * i), "OpeningTags": ["Caro-Kann_Defense"] if i % 7 == 0 else []}
            for i, p in enumerate(PUZZLES)]
    chosen = select(cfg, iter(rows), {"fork": 4, "pin": 2}, ["Caro-Kann Defense"], 2)
    for p in chosen:
        assert 400 <= int(p["Rating"]) < 2600 and int(p["Popularity"]) >= 50 and int(p["NbPlays"]) >= 100
        assert {"fork", "pin"} & set(p["Themes"]) or "Caro-Kann_Defense" in p["OpeningTags"]
    # Two bands, so each group keeps ceil(quota / 2) per band, the most popular first.
    forks = [p for p in rows if "fork" in p["Themes"] and int(p["Popularity"]) >= 50 and int(p["NbPlays"]) >= 100]
    low = sorted((p for p in forks if int(p["Rating"]) < 1500), key=lambda p: (int(p["Popularity"]), int(p["NbPlays"])))
    assert low[-1]["PuzzleId"] in {p["PuzzleId"] for p in chosen}
    assert sum("fork" in p["Themes"] for p in chosen) <= 4 + 2 * 1 + 2   # fork quota, plus picks for pin and the opening


def test_read_pgn_splits_variations(tmp_path):
    pgn = tmp_path / "rep.pgn"
    pgn.write_text('[Event "Test"]\n[Repertoire "black"]\n[Opening "Caro-Kann Defense"]\n\n'
                   "1. e4 c6 2. d4 d5 (2... g6) 3. e5 *\n\n"
                   '[Event "Second"]\n\n1. d4 d5 *\n')
    lines = read_pgn(pgn)
    assert lines == [
        ("black", "Caro-Kann Defense", ["e2e4", "c7c6", "d2d4", "d7d5", "e4e5"]),
        ("black", "Caro-Kann Defense", ["e2e4", "c7c6", "d2d4", "g7g6"]),
        ("white", "Second", ["d2d4", "d7d5"]),
    ]
    assert line_id("black", lines[0][2]) != line_id("white", lines[0][2])


def test_named_lines_come_from_the_dataset(recorded):
    assert named_line(recorded.cfg.root, "Caro-Kann Defense: Advance Variation") == ["e2e4", "c7c6", "d2d4", "d7d5", "e4e5"]
    assert named_line(recorded.cfg.root, "No Such Opening") is None
