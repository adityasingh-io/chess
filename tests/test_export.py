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
