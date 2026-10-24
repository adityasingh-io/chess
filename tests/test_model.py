"""The analysis model on recorded games: every rule checked against what it measured."""

import chess

from coach.analysis import is_garbage_time, load_games, select_game_ids
from coach.model import (
    LOSS_CAUSES,
    band,
    build_all,
    endgame_type,
    is_endgame,
    mate_for,
    top,
)
from coach.positions import board_from_key
from coach.reports import opening_families


def test_every_game_is_modelled(recorded):
    assert len(recorded.models) == len(recorded.games)


def test_every_loss_has_exactly_one_cause(recorded):
    for m in recorded.models:
        if m.row["result"] == "loss":
            assert m.loss is not None and m.loss.cause in LOSS_CAUSES
        else:
            assert m.loss is None


def test_a_loss_with_no_moves_still_gets_one_cause(recorded):
    """Abandoned before the first move: the rule reads my Win% off the stored result for the start position."""
    conn, cfg = recorded.conn, recorded.cfg
    row = dict(conn.execute("SELECT * FROM games WHERE id = '147999020662'").fetchone())
    row.update(id="1", url="https://www.chess.com/game/live/1", ply_count=0, my_code="abandoned", result="loss")
    conn.execute(f"INSERT INTO games ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})", list(row.values()))
    models = build_all(cfg, load_games(conn, select_game_ids(conn)), recorded.evals1, recorded.evals2, recorded.openings)

    m = next(m for m in models if m.id == "1")
    assert m.plies == [] and m.records == [] and len(m.my_win) == 1
    assert m.loss.cause == ("gave_up" if m.my_win[0] >= cfg.analysis.losses.playable else "outplayed")
    played = sum(1 for g in models if g.row["my_color"] == row["my_color"] and g.plies)
    assert sum(f["games"] for f in opening_families(cfg, models, row["my_color"])) == played


def test_turning_point_matches_its_record(recorded):
    l = recorded.cfg.analysis.losses
    for m in recorded.models:
        if m.loss and m.loss.turning_point:
            p = m.loss.turning_point
            assert p.win_before >= l.turning_from and p.win_after <= l.turning_to
            assert m.loss.record.ply is p and m.loss.cause == m.loss.record.primary


def test_labels(recorded):
    for m in recorded.models:
        for p in m.plies:
            if p.move["key_after"] in recorded.openings:
                assert p.label == "book"
            elif p.move["uci"] == p.best:
                assert p.label == "best"
            else:
                assert p.label == band(recorded.cfg, p.drop)


def test_bands_include_their_lower_edge(recorded):
    cfg = recorded.cfg
    assert band(cfg, 4.99) == "good" and band(cfg, 5.0) == "inaccuracy"
    assert band(cfg, 15.0) == "blunder" and band(cfg, -3.0) == "excellent"


def test_phases_run_in_order(recorded):
    order = {"opening": 0, "middlegame": 1, "endgame": 2}
    for m in recorded.models:
        seen = [order[p.phase] for p in m.plies]
        assert seen == sorted(seen)
        if m.endgame:
            assert all(p.phase == "endgame" for p in m.plies[m.endgame.start:])


def test_records_follow_their_rules(recorded):
    cfg = recorded.cfg
    t = cfg.analysis.types
    assert any(m.records for m in recorded.models)
    for m in recorded.models:
        for r in m.records:
            p = r.ply
            assert p.mine and p.drop >= cfg.engine.triggers.min_drop and p.label != "best"
            assert not is_garbage_time(cfg, p.win_before, p.win_after)
            assert r.severity == band(cfg, p.drop)
            me = p.white
            after = board_from_key(p.move["key_after"])
            loses = r.net_after <= t.material_loss and r.net_after - r.net_best <= t.material_loss
            reply_capture = bool(r.reply_line) and after.is_capture(chess.Move.from_uci(r.reply_line[0]))
            if r.primary == "allowed_mate":
                assert mate_for(r.after_top, me) < 0
            elif r.primary == "hung_piece":
                assert loses and reply_capture
            elif r.primary == "tactic":
                assert loses and not reply_capture and r.subtype
            elif r.primary == "missed_mate":
                assert 0 < mate_for(r.before_top, me) <= t.missed_mate_max
            elif r.primary == "missed_win":
                assert r.net_best >= t.material_win and r.net_best - r.net_after >= t.material_win and r.subtype
            else:
                assert r.primary == "quiet" and not loses


def test_flags_match_their_definitions(recorded):
    f = recorded.cfg.analysis.flags
    for m in recorded.models:
        for r in m.records:
            p = r.ply
            assert ("threw_away_win" in r.flags) == (p.win_before >= f.threw_win_before and p.win_after < f.threw_win_after)
            clock = p.move["clock"]
            assert ("time_trouble" in r.flags) == (clock is not None and clock < f.time_trouble * m.row["base_seconds"])
            assert ("endgame" in r.flags) == (p.phase == "endgame")
            assert ("opening" in r.flags) == (p.phase == "opening")


def test_thrown_wins(recorded):
    w = recorded.cfg.analysis.losses.winning
    for m in recorded.models:
        reached = max(m.my_win) >= w
        assert (m.thrown is not None) == (reached and m.row["result"] != "win")


def test_endgame_outcomes(recorded):
    e = recorded.cfg.analysis.endgames
    for m in recorded.models:
        if not m.endgame:
            continue
        win, result, outcome = m.endgame.win_start, m.row["result"], m.endgame.outcome
        if win >= e.winning:
            assert outcome == ("converted" if result == "win" else "spoiled")
        elif win > e.losing:
            assert outcome == ("spoiled" if result == "loss" else "held")
        else:
            assert outcome == ("lost_as_expected" if result == "loss" else "saved")


def test_endgame_material_count():
    # Each side's non-pawn material, counted from the position key; the limit is 13.
    assert is_endgame("8/5k2/8/8/8/8/2K5/8 w - -", 13)
    assert is_endgame("r3k3/pppp4/8/8/8/8/PPPP4/R3K3 w - -", 13)
    assert not is_endgame("r3k3/8/8/8/8/8/8/R2QK3 w - -", 13)  # White has Q + R = 14
    assert not is_endgame("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -", 13)


def test_endgame_types():
    assert endgame_type(board_from_key("8/5k2/3p4/8/8/2P5/2K5/8 w - -")) == "pawn"
    assert endgame_type(board_from_key("8/5k2/3r4/8/8/2R5/2K5/8 w - -")) == "rook"
    assert endgame_type(board_from_key("8/5k2/3n4/8/8/2B5/2K5/8 w - -")) == "minor"
    assert endgame_type(board_from_key("8/5k2/3q4/8/8/2R5/2K5/8 w - -")) == "queen"
    assert endgame_type(board_from_key("8/5k2/3r4/8/8/2B5/2K5/8 w - -")) == "mixed"


def test_top_line_helpers():
    assert top(None) is None and top({"terminal": "draw"}) is None
    assert mate_for({"mate": 3}, white=False) == -3 and mate_for({"mate": None}, True) is None
