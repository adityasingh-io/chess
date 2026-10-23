"""Explorer client: one request at a time, waits on 429, caches every response."""

from dataclasses import replace

import httpx
from rich.console import Console

from coach import db, explorer


def test_fetch_backs_off_and_caches(recorded):
    cfg = replace(recorded.cfg, secrets=replace(recorded.cfg.secrets, lichess_token="test-token"))
    calls, sleeps = [], []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        assert request.headers["Authorization"] == "Bearer test-token"
        if len(calls) == 1:
            return httpx.Response(429)
        return httpx.Response(200, json={"white": 6, "draws": 1, "black": 3, "moves": [
            {"uci": "e7e5", "san": "e5", "white": 3, "draws": 1, "black": 1, "averageRating": 1100, "game": None, "opening": None}
        ], "topGames": [], "opening": None})

    client = explorer.Explorer(cfg, client=httpx.Client(transport=httpx.MockTransport(handler)), sleep=sleeps.append)
    conn = db.connect(cfg.db_path)
    key = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq -"
    assert explorer.fetch(cfg, conn, [key], Console(quiet=True), client) == 1
    assert sleeps == [60] and calls[-1].url.params["ratings"] == "1000,1200"
    assert explorer.fetch(cfg, conn, [key], Console(quiet=True), client) == 0 and len(calls) == 2
    stats = explorer.load(conn, cfg)[key]
    assert explorer.share(stats, "e7e5") == (50.0, 10)
    assert explorer.share(stats, "c7c5") == (0.0, 10)
