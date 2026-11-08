"""Rivals: what they play, counted from their games; their moves scored as mine are; and my games against them
(PLAN.md, reading 26)."""

import json
from dataclasses import replace
from statistics import mean

import chess
import chess.pgn
import pytest

from coach import keymoments, rivals
from coach.analysis import evaluation
from coach.export import Built, ev, loss_info, write
from coach.keymoments import key_out
from coach.model import band, top
from coach.positions import position_key
from coach.winpct import for_side

START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -"


def raw_game(n: int, white: str, black: str, moves: str, result: str = "1-0", time_class: str = "rapid",
             rules: str = "chess", codes: tuple[str, str] | None = None) -> dict:
    codes = codes or {"1-0": ("win", "resigned"), "0-1": ("resigned", "win"), "1/2-1/2": ("agreed", "agreed")}[result]
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


def as_rival_archive(r) -> list[dict]:
    """My recorded games as chess.com would list them in my opponents' archives, every opponent renamed Rival
    (the fixture keeps the moves, not the PGN text)."""
    me, games = r.cfg.player.username, []
    for m in r.models:
        row = m.row
        sides = {row["my_color"]: (me, row["my_code"]), rivals.OTHER[row["my_color"]]: ("Rival", row["opp_code"])}
        board = chess.Board(row["initial_fen"])
        for move in m.game.moves:
            board.push_uci(move["uci"])
        games.append({"url": row["url"], "pgn": str(chess.pgn.Game.from_board(board)), "rules": "chess",
                      "time_class": row["time_class"], "time_control": row["time_control"], "rated": bool(row["rated"]),
                      "end_time": row["end_ts"], **{c: {"username": u, "rating": None, "result": code} for c, (u, code) in sides.items()}})
    return games


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
    root = white[START]
    assert root.rival_turn and len(root.games) == 3
    assert {uci: len(gs) for uci, gs in root.moves.items()} == {"e2e4": 2, "d2d4": 1}
    assert all(sum(len(gs) for gs in n.moves.values()) == len(n.games) for n in white.values())
    after_nf6 = white["rnbqkb1r/ppp1pppp/5n2/3p4/3P4/5N2/PPP1PPPP/RNBQKB1R w KQkq -"]
    assert len(after_nf6.games) == 1 and list(after_nf6.moves) == ["f3g1"]   # the second visit isn't counted
    assert rivals.score(root.games) == 100 * 2 / 3 and rivals.vs_me(cfg, root.games) == ["1"]
    assert not rivals.tree(cfg, games, "black")[START].rival_turn
    # Kept: reached in min_times games, or reached by my games too however rarely.
    after_c5 = position_key(chess.Board("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2"))
    kept = rivals.kept(replace(cfg, rivals=replace(cfg.rivals, min_times=2)), white, {after_c5})
    assert [n.key for n in kept][:1] == [START] and after_c5 in {n.key for n in kept}
    assert all(len(n.games) >= 2 or n.key == after_c5 for n in kept)


def test_endings_and_time_trouble_count_the_rivals_games(recorded):
    clk = lambda s: f"{{[%clk 0:{s // 60:02d}:{s % 60:02d}]}}"   # noqa: E731
    cfg = with_rival(recorded.cfg, [
        raw_game(1, "Friend", "a", f"1. e4 {clk(590)} e5 {clk(595)} 2. Qh5 {clk(30)} Nc6 {clk(580)} 3. Qxf7# {clk(25)}",
                 codes=("win", "checkmated")),
        raw_game(2, "b", "Friend", f"1. d4 {clk(590)} d5 {clk(40)} 2. c4 {clk(580)}", result="1-0", codes=("win", "timeout")),
        raw_game(3, "Friend", "c", "1. e4 e5", result="1/2-1/2", codes=("repetition", "repetition")),
        raw_game(4, "d", "Friend", f"1. e4 {clk(590)} e5 {clk(300)}", result="0-1", codes=("resigned", "win")),
    ])
    games, _ = rivals.load(cfg, "Friend")
    assert rivals.endings(games).model_dump() == {"won": {"checkmated": 1, "resigned": 1}, "lost": {"timeout": 1},
                                                   "drawn": {"repetition": 1}}
    t = rivals.time_trouble(cfg, games)   # 10% of 600 s is 60 s; game 3 has no clocks
    assert (t.share, t.timed, t.games, t.lost_on_time, t.score) == (0.1, 3, 2, 1, 50.0)


def test_a_rivals_moves_get_the_labels_my_games_give_them(recorded):
    """Every move of theirs in the tree has the label and the drop the game model gave it, and every score is
    the stored Stockfish result."""
    r = recorded
    cfg = with_rival(r.cfg, as_rival_archive(r), "Rival", min_times=1)
    parsed, months = rivals.load(cfg, "Rival")
    out = rivals.rival_out(cfg, "Rival", parsed, months, r.evals1, r.openings, rivals.my_positions(cfg, r.conn))
    assert out.games == len(r.models) == out.vs_me and out.white.games + out.black.games == out.games
    nodes = {(side.colour, n.key): n for side in (out.white, out.black) for n in side.tree}
    checked = 0
    for m in r.models:
        theirs = rivals.OTHER[m.row["my_color"]]
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
        assert h.move.uci != h.best and band(cfg, h.move.drop) in rivals.COSTLY
        board = chess.Board(h.fen)
        board.push_uci(h.move.uci)
        after = top(evaluation(position_key(board), r.evals1))   # Stockfish's answer is its line after the habit
        assert h.move.reply_line == (after["pv"][: cfg.engine.pv_plies] if after else [])
    costs = [h.move.drop * h.move.games for h in out.habits]
    assert out.habits and costs == sorted(costs, reverse=True)


def test_my_openings_keep_every_position_and_costly_move(recorded):
    """With the usual min_times, a position my games reach is kept however rarely the rival reached it; habits
    need min_times plays, "in your openings" lists every costly move from such a position."""
    r = recorded
    cfg = with_rival(r.cfg, as_rival_archive(r), "Rival")
    parsed, months = rivals.load(cfg, "Rival")
    out = rivals.rival_out(cfg, "Rival", parsed, months, r.evals1, r.openings, rivals.my_positions(cfg, r.conn))
    tree = [n for side in (out.white, out.black) for n in side.tree]
    assert tree and all(n.yours for n in tree)   # they're my games, so every position is one of mine
    assert any(n.games < cfg.rivals.min_times for n in tree)
    assert all(h.move.games >= cfg.rivals.min_times for h in out.habits)
    every = [(n.key, m.uci) for n in tree if n.rival_turn for m in n.moves if rivals.costly(cfg, m, n.best)]
    assert sorted((h.key, h.move.uci) for h in out.your_openings) == sorted(every) and len(every) > len(out.habits)
    assert {(h.key, h.move.uci) for h in out.habits} <= {(h.key, h.move.uci) for h in out.your_openings}


def test_head_to_head_is_my_games_against_each_rival(recorded):
    r = recorded
    rival = r.models[0].row["opp_username"]
    cfg = replace(r.cfg, rivals=replace(r.cfg.rivals, usernames=(rival.upper(),)))
    keys = {m.id: key_out(cfg, m, r.evals1) for m in r.models}
    h = rivals.head_to_head(cfg, r.models, keys, 0).rivals[0]
    vs = [m for m in r.models if m.row["opp_username"] == rival]
    assert h.username == rival.upper() and [g.id for g in h.games] == [m.id for m in sorted(vs, key=lambda m: -m.row["start_ts"])]
    for g, m in zip(h.games, sorted(vs, key=lambda m: -m.row["start_ts"])):
        assert g.loss == loss_info(m) and g.their_accuracy == round(m.accuracy[rivals.OTHER[m.row["my_color"]]], 1)
        assert g.key_ply == (keys[m.id].ply if keys[m.id] else None)
    for rate in h.rates:
        assert rate.against == round(sum(rate.tag in rec.tags for m in vs for rec in m.records) / len(vs), 3)
        assert rate.usual == round(sum(rate.tag in rec.tags for m in r.models for rec in m.records) / len(r.models), 3)
    for ph in h.phases:
        acc = [p.accuracy for m in vs for p in m.plies if not p.mine and p.phase == ph.phase]
        assert ph.their_moves == len(acc) and ph.theirs == (round(mean(acc), 1) if acc else None)


def test_every_game_against_a_rival_gets_its_key_moment(recorded):
    old = next(m for m in sorted(recorded.models, key=lambda m: m.row["start_ts"]) if m.key)
    assert set(keymoments.wanted(recorded.models, 0)) == set()
    assert set(keymoments.wanted(recorded.models, 0, frozenset({old.id}))) == set(keymoments.wanted([old]))


def test_rivals_must_be_in_the_config(recorded):
    cfg = replace(recorded.cfg, rivals=replace(recorded.cfg.rivals, usernames=("rk200123",)))
    assert rivals.names(cfg, None) == ["rk200123"] and rivals.names(cfg, ["RK200123"]) == ["rk200123"]
    with pytest.raises(SystemExit):
        rivals.names(cfg, ["nobody"])


def test_rival_files_stay_while_the_rival_is_configured(recorded):
    cfg = replace(recorded.cfg, rivals=replace(recorded.cfg.rivals, usernames=("Friend",)))
    old = cfg.export_dir / "rivals" / "gone.json"
    old.parent.mkdir(parents=True)
    old.write_text("{}")
    (cfg.export_dir / "rivals" / "friend.json").write_text("{}")
    write(cfg, Built(files={}, games={}))
    assert not old.exists() and (cfg.export_dir / "rivals" / "friend.json").exists()
