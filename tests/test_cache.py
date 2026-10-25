"""The shared cache: packing keeps only the shared tables, merging adds rows without replacing any, and a
push keeps what the other machine added since this one last pulled."""

import shutil
import subprocess
from pathlib import Path

from coach import cache, db


def _gh_on(release: Path):
    """`gh release` view, create, download and upload, on a folder; an upload replaces files, like --clobber."""
    def gh(*args: str, check: bool = True) -> subprocess.CompletedProcess:
        cmd, rest = args[1], args[3:]
        if cmd == "view":
            return subprocess.CompletedProcess(args, 0 if release.exists() else 1)
        if cmd == "create":
            release.mkdir()
        elif cmd == "download":
            for f in release.iterdir():
                shutil.copyfile(f, Path(rest[rest.index("--dir") + 1]) / f.name)
        elif cmd == "upload":
            for f in (Path(a) for a in rest if a != "--clobber"):
                shutil.copyfile(f, release / f.name)
        return subprocess.CompletedProcess(args, 0)
    return gh


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


def test_push_merges_the_shared_cache_first_so_nothing_the_other_machine_added_is_lost(recorded, tmp_path, monkeypatch):
    r = recorded
    release = tmp_path / "release"
    monkeypatch.setattr(cache, "_gh", _gh_on(release))
    cache.push(r.cfg, r.conn, lambda _: None)   # the nightly's push creates the release with every recorded result
    shared = r.conn.execute("SELECT count(*) FROM evals").fetchone()[0]

    mac = db.connect(tmp_path / "mac.sqlite")   # a machine that hasn't pulled since, with one result of its own
    engine, settings = r.conn.execute("SELECT engine, settings FROM evals LIMIT 1").fetchone()
    mac.execute("INSERT INTO evals VALUES (?, ?, ?, ?, ?)", ("mac-only", engine, settings, '{"lines": []}', 1))
    mac.commit()
    cache.push(r.cfg, mac, lambda _: None)

    fresh = db.connect(tmp_path / "fresh.sqlite")
    assert cache.merge(fresh, release / cache.DB_ASSET)["evals"] == shared + 1
    assert mac.execute("SELECT count(*) FROM evals").fetchone()[0] == shared + 1   # the push pulled them here too
