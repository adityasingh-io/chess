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
