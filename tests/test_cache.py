"""The shared cache: packing keeps only the shared tables, and merging adds rows without replacing any."""

from coach import cache, db


def test_pack_then_merge_adds_only_missing_rows(recorded, tmp_path):
    r = recorded
    packed = tmp_path / cache.DB_ASSET
    counts = cache.pack(r.conn, packed)
    assert counts["evals"] == r.conn.execute("SELECT count(*) FROM evals").fetchone()[0] > 0

    other = db.connect(tmp_path / "other.sqlite")
    row = r.conn.execute("SELECT key, engine, settings FROM evals LIMIT 1").fetchone()
    other.execute("INSERT INTO evals VALUES (?, ?, ?, ?, ?)", (*row, '{"lines": []}', 1))
    other.commit()
    added = cache.merge(other, packed)
    assert added["evals"] == counts["evals"] - 1
    kept = other.execute("SELECT result FROM evals WHERE key = ? AND engine = ? AND settings = ?", tuple(row)).fetchone()
    assert kept[0] == '{"lines": []}'
    assert other.execute("SELECT count(*) FROM games").fetchone()[0] == 0
    assert cache.merge(other, packed) == {t: 0 for t in cache.TABLES}
