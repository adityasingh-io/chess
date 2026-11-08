"""chess.com client: backoff on 429, User-Agent, and which months need fetching."""

import httpx

from coach.chesscom import ChessCom, archive_month, month_end_ts, needs_fetch


def test_backs_off_on_429_then_succeeds():
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if len(calls) < 3:
            return httpx.Response(429, headers={"Retry-After": "7"} if len(calls) == 1 else {})
        return httpx.Response(200, json={"ok": True})

    slept = []
    api = ChessCom("me@example.com", client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=slept.append)
    assert api.get_json("https://api.chess.com/pub/x") == {"ok": True}
    assert slept == [7.0, 4.0]  # Retry-After first, then exponential backoff
    assert "me@example.com" in calls[0].headers["User-Agent"]


def test_archive_month():
    assert archive_month("https://api.chess.com/pub/player/r00k4ndr0ll/games/2026/03") == "2026-03"


def test_month_end():
    assert month_end_ts("2026-12") == 1798761600  # 2027-01-01 00:00 UTC


def test_needs_fetch():
    end = month_end_ts("2026-09")
    assert needs_fetch("2026-09", None)
    assert needs_fetch("2026-09", end - 10)  # fetched while the month was running
    assert needs_fetch("2026-09", end + 60)  # too soon after it ended
    assert not needs_fetch("2026-09", end + 3 * 3600)


def test_fetch_rivals_keeps_their_newest_months_and_skips_finished_ones(tmp_path):
    from dataclasses import replace
    from pathlib import Path

    from rich.console import Console

    from coach import db
    from coach.chesscom import fetch_rivals, rival_dir
    from coach.config import load_config

    base = load_config(Path(__file__).resolve().parents[1])
    cfg = replace(base, root=tmp_path, rivals=replace(base.rivals, usernames=("Friend",), months=2))
    conn = db.connect(cfg.db_path)
    months = ["2025/01", "2025/02", "2025/03"]
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request.url.path)
        if request.url.path.endswith("/archives"):
            return httpx.Response(200, json={"archives": [f"https://api.chess.com/pub/player/friend/games/{m}" for m in months]})
        return httpx.Response(200, json={"games": [{"url": request.url.path}]})

    api = ChessCom("me@example.com", client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=lambda s: None)
    assert fetch_rivals(cfg, conn, Console(quiet=True), api) == ["friend 2025-02", "friend 2025-03"]
    assert sorted(p.name for p in rival_dir(cfg, "Friend").iterdir()) == ["2025-02.json", "2025-03.json"]
    assert [r["month"] for r in conn.execute("SELECT month FROM rival_archives WHERE username = 'friend' ORDER BY month")] \
        == ["2025-02", "2025-03"]
    calls.clear()
    assert fetch_rivals(cfg, conn, Console(quiet=True), api) == []   # both months were over when fetched
    assert calls == ["/pub/player/friend/games/archives"]
