"""Rivals: what they play, counted from their games, and their moves scored as mine are (PLAN.md, reading 26)."""

import json
from dataclasses import replace

import chess
import chess.pgn

from coach import rivals
from coach.analysis import evaluation
from coach.export import Built, ev, write
from coach.model import band, top
from coach.positions import position_key
from coach.winpct import for_side


def raw_game(n: int, white: str, black: str, moves: str, result: str = "1-0", time_class: str = "rapid",
             rules: str = "chess") -> dict:
    codes = {"1-0": ("win", "resigned"), "0-1": ("resigned", "win"), "1/2-1/2": ("agreed", "agreed")}[result]
    return {"url": f"https://www.chess.com/game/live/{n}", "pgn": f"{moves} {result}", "rules": rules,
            "time_class": time_class, "time_control": "600", "rated": True, "end_time": 1_767_225_600 + n,
            "white": {"username": white, "rating": 700, "result": codes[0]},
            "black": {"username": black, "rating": 700, "result": codes[1]}}


def with_rival(cfg, games: list[dict], name: str = "Friend", **settings):
    cfg = replace(cfg, rivals=replace(cfg.rivals, usernames=(name,), **settings))
    folder = cfg.raw_dir / "rivals" / name.lower()
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "2026-01.json").write_text(json.dumps({"games": games}))
    return cfg


def test_the_tree_counts_what_was_played_from_each_position(recorded):
    me = recorded.cfg.player.username
    cfg = with_rival(recorded.cfg, [
        raw_game(1, "Friend", me, "1. e4 e5 2. Nf3 Nc6"),
        raw_game(2, "Friend", "someone", "1. e4 c5 2. Nf3 d6", result="0-1"),
        raw_game(3, "Friend", "someone", "1. d4 d5 2. Nf3 Nf6 3. Ng1 Ng8 4. Nf3 Nf6"),   # a repetition counts once
        raw_game(4, "Friend", "someone", "1. e4 e5", time_class="blitz"),                # not my time classes
        raw_game(5, "Friend", "someone", "1. e4 e5", rules="chess960"),                  # not standard chess
        raw_game(6, "someone", "Friend", "1. e4 e5 2. Qh5", result="1/2-1/2"),
    ], plies=6)
    games, months = rivals.load(cfg, "Friend")
    assert [g.id for g in games] == ["1", "2", "3", "6"] and months == ["2026-01"]
    white = rivals.tree(cfg, games, "white")
    root = white["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"]
    assert root.rival_turn and len(root.games) == 3
    assert {uci: len(gs) for uci, gs in root.moves.items()} == {"e2e4": 2, "d2d4": 1}
    assert all(sum(len(gs) for gs in n.moves.values()) == len(n.games) for n in white.values())
    after_nf6 = white["rnbqkb1r/ppp1pppp/5n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq -"]
    assert len(after_nf6.games) == 1 and list(after_nf6.moves) == ["f3g1"]   # the second visit isn't counted
    assert rivals.score(root.games) == 100 * 2 / 3 and rivals.vs_me(cfg, root.games) == ["1"]
    black = rivals.tree(cfg, games, "black")
    assert not black["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"].rival_turn
    assert max(len(n.moves) for n in rivals.tree(replace(cfg, rivals=replace(cfg.rivals, plies=1)), games, "white").values()) == 2


def test_a_rivals_moves_get_the_labels_my_games_give_them(recorded):
    """My recorded games, read as a rival's archive (my opponents renamed): every move of theirs in the tree has
    the label and the drop the game model gave it, and every score is the stored Stockfish result."""
    r, me = recorded, recorded.cfg.player.username
    games = []
    for m in r.models:
        row = m.row
        sides = {row["my_color"]: (me, row["my_code"]), "black" if row["my_color"] == "white" else "white": ("Rival", row["opp_code"])}
        board = chess.Board(row["initial_fen"])   # the fixture keeps the moves, not the PGN text
        for move in m.game.moves:
            board.push_uci(move["uci"])
        games.append({"url": row["url"], "pgn": str(chess.pgn.Game.from_board(board)), "rules": "chess", "time_class": row["time_class"],
                      "time_control": row["time_control"], "rated": bool(row["rated"]), "end_time": row["end_ts"],
                      **{c: {"username": u, "rating": None, "result": code} for c, (u, code) in sides.items()}})
    cfg = with_rival(r.cfg, games, "Rival", min_times=1)
    parsed, months = rivals.load(cfg, "Rival")
    out = rivals.rival_out(cfg, "Rival", parsed, months, r.evals1, r.openings)
    assert out.games == len(r.models) == out.vs_me and out.white.games + out.black.games == out.games
    nodes = {(side.colour, n.key): n for side in (out.white, out.black) for n in side.tree}
    checked = 0
    for m in r.models:
        theirs = "black" if m.row["my_color"] == "white" else "white"
        for p in m.plies[: cfg.rivals.plies]:
            if p.mine:
                continue
            n = nodes[(theirs, p.move["key_before"])]
            move = next(x for x in n.moves if x.uci == p.move["uci"])
            white = p.move["side"] == "white"
            assert move.label == p.label
            assert move.drop == round(for_side(p.white_before, white) - for_side(p.white_after, white), 1)
            assert n.eval == ev(top(evaluation(n.key, r.evals1)))
            assert move.eval == ev(top(evaluation(p.move["key_after"], r.evals1)))
            checked += 1
    assert checked > 100
    for h in out.habits:
        assert h.move.games >= 1 and h.move.uci != h.best and band(cfg, h.move.drop) in rivals.COSTLY
        board = chess.Board(h.fen)
        board.push_uci(h.move.uci)
        after = top(evaluation(position_key(board), r.evals1))   # Stockfish's answer is its line after the habit
        assert h.move.reply_line == (after["pv"][: cfg.engine.pv_plies] if after else [])
    costs = [h.move.drop * h.move.games for h in out.habits]
    assert out.habits and costs == sorted(costs, reverse=True)


def test_rival_files_stay_while_the_rival_is_configured(recorded):
    cfg = replace(recorded.cfg, rivals=replace(recorded.cfg.rivals, usernames=("Friend",)))
    old = cfg.export_dir / "rivals" / "gone.json"
    old.parent.mkdir(parents=True)
    old.write_text("{}")
    (cfg.export_dir / "rivals" / "friend.json").write_text("{}")
    write(cfg, Built(files={}, games={}))
    assert not old.exists() and (cfg.export_dir / "rivals" / "friend.json").exists()
