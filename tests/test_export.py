"""The JSON export: validates against the shared schema and a re-run writes nothing."""

import json

from coach import schema as S
from coach.export import build, write


def test_export_validates_and_is_idempotent(recorded):
    r = recorded
    built = build(r.cfg, r.models, len(r.games), r.evals1, r.evals2, {})
    written, unchanged = write(r.cfg, built)
    assert written == len(S.FILES) + len(r.models) and unchanged == 0
    out = r.cfg.export_dir
    for rel, model in S.FILES.items():
        model.model_validate_json((out / rel).read_text())
    for m in r.models:
        S.Game.model_validate_json((out / "games" / f"{m.id}.json").read_text())
    assert write(r.cfg, built) == (0, written)
    schema = json.loads((r.cfg.root / "web" / "schema" / "export.schema.json").read_text())
    assert {"Record", "Game", "Summary", "OpeningReport"} <= set(schema["$defs"])


def test_moves_carry_their_marks(recorded):
    r = recorded
    built = build(r.cfg, r.models, len(r.games), r.evals1, r.evals2, {})
    for m in r.models:
        moves = built.games[m.id].moves
        assert [(x.mark.kind if x.mark else None) for x in moves] == [(p.mark.kind if p.mark else None) for p in m.plies]
        for x in moves:
            if x.mark and x.mark.kind == "brilliant":
                assert x.mark.material < 0 and x.mark.line and x.mark.gap is None and x.mark.chance is None


def test_losses_cover_every_loss(recorded):
    r = recorded
    losses = build(r.cfg, r.models, len(r.games), r.evals1, r.evals2, {}).files["losses.json"]
    lost = sum(1 for m in r.models if m.row["result"] == "loss")
    assert losses.total == lost == sum(losses.causes.values()) == len(losses.losses)


def test_spoiled_endgames_start_before_the_spoiling_move(recorded):
    r = recorded
    built = build(r.cfg, r.models, len(r.games), r.evals1, r.evals2, {})
    by_id = {m.id: m for m in r.models}
    entries = built.files["endgames.json"].endgames
    assert entries and any(e.spoiler_fen for e in entries)
    for e in entries:
        m = by_id[e.game]
        assert e.colour == m.row["my_color"] and e.opponent == m.row["opp_username"]
        if e.info.outcome == "spoiled" and e.info.spoiler_ply:
            ply = m.plies[e.info.spoiler_ply - 1]
            assert ply.mine and e.spoiler_fen == ply.move["fen_before"] and e.spoiler_win == round(ply.win_before, 1)
        else:
            assert e.spoiler_fen is None and e.spoiler_win is None


def test_endgame_trend_counts_the_latest_endgames(recorded):
    r = recorded
    trend = build(r.cfg, r.models, len(r.games), r.evals1, r.evals2, {}).files["insights.json"].endgames
    ended = sorted((m for m in r.models if m.endgame), key=lambda m: m.row["start_ts"])[-r.cfg.analysis.insights.recent_games:]
    w = trend.recent
    assert w.endgames == len(ended) == w.winning + w.balanced + w.losing
    assert w.converted == sum(m.endgame.outcome == "converted" for m in ended) <= w.winning
    assert w.held <= w.balanced and w.saved <= w.losing


def test_explanations_use_stored_moves(recorded):
    r = recorded
    built = build(r.cfg, r.models, len(r.games), r.evals1, r.evals2, {})
    for rec in built.files["mistakes/index.json"].records:
        assert rec.explanation.startswith(rec.san) or rec.best_san and rec.best_san in rec.explanation
        if rec.best_san:
            assert rec.best_line_san == "" or rec.best_san in rec.best_line_san


def test_chesscom_ratings_on_lichess_scale():
    from coach.config import RatingMap
    m = RatingMap(chesscom=(600, 700, 800, 1000, 1100), lichess=(980, 1070, 1165, 1350, 1440))
    assert [m.lichess_of(r) for r in (500, 600, 654, 800, 900, 1100, 1300)] == [980, 980, 1029, 1165, 1258, 1440, 1440]


def test_each_game_says_where_it_left_my_lines_and_coverage_adds_it_up(recorded):
    r = recorded
    (r.cfg.root / r.cfg.repertoire.pgn).write_text('[Repertoire "white"]\n\n1. d4 d5 2. c4 *\n\n[Repertoire "black"]\n\n1. e4 c6 *\n')
    built = build(r.cfg, r.models, len(r.games), r.evals1, r.evals2, {})
    index = {g.id: g for g in built.files["games/index.json"].games}
    for colour in ("white", "black"):
        cov = built.files[f"openings/{colour}.json"].coverage
        checks = [built.games[m.id].repertoire for m in r.models if m.row["my_color"] == colour and m.plies]
        assert cov.games == len(checks) and all(checks)
        assert cov.mine + cov.theirs + cov.ended + sum(c.result == "over" for c in checks) == cov.games
        assert sum(g.games for g in cov.gaps) <= cov.theirs
    lines = {l.id: l for l in built.files["repertoire.json"].lines}
    for m in r.models:
        c = built.games[m.id].repertoire
        assert c == index[m.id].repertoire
        if c and c.result == "mine":
            assert c.line in lines and any(s.game == m.id for s in lines[c.line].slips) and c.expected
        elif c:
            assert c.line is None and not c.expected
    trend = built.files["insights.json"].openings
    assert trend.recent.games == min(len([m for m in r.models if m.plies]), r.cfg.analysis.insights.recent_games)
    assert sum(mo.games for mo in trend.months) == len([m for m in r.models if m.plies])
