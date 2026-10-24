"""AI notes: what the model is sent, the check every reply must pass, and the cache. No API calls: the
model is a stand-in, and the notes it "writes" are built from the recorded facts or break them on purpose."""

from dataclasses import replace

import pytest

from coach import notes
from coach.export import build


def _records(recorded):
    return [r for m in recorded.models for r in m.records if r.best_line]


def _good(f: notes.Facts, r) -> str:
    """A rewording that uses only moves and numbers from the facts."""
    move = r.ply.move
    return (f"You played {move['san']} and your Win% went from {r.ply.win_before:.1f} to {r.ply.win_after:.1f}. "
            f"{f.text.split('best move instead: ')[1].split(',')[0]} was Stockfish's choice.")


def test_facts_come_from_the_record_and_leave_out_the_position(recorded):
    r = _records(recorded)[0]
    f = notes.facts(r)
    assert f.template in f.text and r.ply.move["san"] in f.text
    assert r.ply.move["fen_before"] not in f.text
    assert notes.check(_good(f, r), f) is None


def test_the_check_refuses_anything_not_in_the_facts(recorded):
    r = _records(recorded)[0]
    f = notes.facts(r)
    good = _good(f, r)
    sans = set(notes.SAN.findall(f.text))
    invented = next(m for m in ("Nf3", "Qxh7+", "Bb5", "O-O-O") if m not in sans)
    assert "move" in notes.check(f"{good} {invented} was also good.", f)
    assert "number" in notes.check(f"{good} That cost you 123.4 points.", f)
    assert "square" in notes.check(f"{good} Watch the {next(s for s in ('a1', 'h8', 'b7', 'g2') if s not in f.text)} square.", f)
    assert notes.check(f"{good} It took you three moves.", f) == "a number written as a word"
    assert notes.check(" ".join([good] * 4), f) == "length"
    assert notes.check("", f) == "length"


def test_replies_are_asked_once_and_failing_ones_keep_the_template(recorded):
    r = recorded
    cfg = replace(r.cfg, notes=replace(r.cfg.notes, enabled=True))
    records = _records(r)[:3]
    asked = []

    def ask(text):
        asked.append(text)
        rec = records[len(asked) - 1]
        f = notes.facts(rec)
        return _good(f, rec) if len(asked) != 2 else f"{_good(f, rec)} Nothing else beats 99.9 here."

    assert notes.write(r.conn, cfg, records, ask, lambda _: None) == (2, 1)
    assert notes.write(r.conn, cfg, records, ask, lambda _: None) == (0, 0) and len(asked) == 3
    worded = notes.load(r.conn, cfg, records)
    assert set(worded) == {records[0].id, records[2].id}

    built = build(cfg, r.models, len(r.games), r.evals1, r.evals2, {}, worded)
    by_id = {x.id: x for x in built.files["mistakes/index.json"].records}
    assert by_id[records[0].id].note == worded[records[0].id]
    assert by_id[records[1].id].note is None and by_id[records[1].id].explanation


def test_the_costliest_confirmed_mistakes_come_first(recorded):
    picked = notes.costliest(recorded.cfg, recorded.models)
    assert picked and all(r.confirmed for r in picked)
    assert [r.ply.drop for r in picked] == sorted((r.ply.drop for r in picked), reverse=True)


def test_a_stored_api_key_is_refused(recorded, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "not-a-key")
    with pytest.raises(RuntimeError, match="ANTHROPIC_API_KEY"):
        notes.claude(recorded.cfg)
