"""Reports built from the analysis model: leaks, openings, endgames, insights and losses.

Pure bookkeeping over the model: counts, averages and the thresholds in config.toml.
"""

from __future__ import annotations

import bisect
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from coach.config import Config
from coach.explorer import share
from coach.model import FLAGS, PRIMARY_TYPES, GameModel, Ply, band
from coach.tactics import ORDER as SUBTYPES

POINTS = {"win": 1.0, "draw": 0.5, "loss": 0.0}


def score(models: list[GameModel]) -> float | None:
    """My score in percent (win 1, draw ½)."""
    return 100 * sum(POINTS[m.row["result"]] for m in models) / len(models) if models else None


def mean(values) -> float | None:
    values = [v for v in values if v is not None]
    return statistics.fmean(values) if values else None


def by_time(models: list[GameModel]) -> list[GameModel]:
    return sorted(models, key=lambda m: m.row["start_ts"])


# --- leaks ---------------------------------------------------------------------------------------

LEAK_TAGS = (*PRIMARY_TYPES, *SUBTYPES, "other", "free_material", *FLAGS)


def recent_split(cfg: Config, models: list[GameModel]) -> tuple[list[GameModel], list[GameModel]]:
    n = cfg.analysis.insights.recent_games
    ordered = by_time(models)
    return ordered[-n:], ordered[-2 * n:-n]


@dataclass
class Leak:
    tag: str
    kind: str                # primary, subtype or flag
    count: int
    per_game: float
    recent: float | None     # per-game rate over the last N games
    previous: float | None   # and over the N before
    win_lost: float          # total Win% lost on these moves
    records: list[str] = field(default_factory=list)


def _rate(records: list, ids: set[str]) -> float | None:
    """Records per game over the games in `ids`."""
    return sum(1 for r in records if r.game.id in ids) / len(ids) if ids else None


def leaks(cfg: Config, models: list[GameModel]) -> list[Leak]:
    recent, previous = recent_split(cfg, models)
    recent_ids, previous_ids = {m.id for m in recent}, {m.id for m in previous}
    out = []
    for tag in dict.fromkeys(LEAK_TAGS):
        kind = "primary" if tag in PRIMARY_TYPES else "flag" if tag in FLAGS else "subtype"
        recs = [r for m in models for r in m.records if tag in r.tags]
        out.append(Leak(tag, kind, len(recs), len(recs) / len(models) if models else 0.0, _rate(recs, recent_ids),
                        _rate(recs, previous_ids), sum(r.ply.drop for r in recs), [r.id for r in recs]))
    return out


def top_leaks(cfg: Config, all_leaks: list[Leak], n: int = 3) -> list[Leak]:
    """The leaks costing the most Win% in total; primary types and sub-types only (flags describe context)."""
    return sorted((l for l in all_leaks if l.kind != "flag" and l.count), key=lambda l: -l.win_lost)[:n]


# --- losses --------------------------------------------------------------------------------------

def loss_summary(models: list[GameModel], since_ts: int | None = None) -> Counter:
    return Counter(m.loss.cause for m in models if m.loss and (since_ts is None or m.row["end_ts"] >= since_ts))


# --- openings ------------------------------------------------------------------------------------

@dataclass
class Node:
    """A position in my opening tree, merged across games (transpositions combine)."""
    key: str
    fen: str
    my_turn: bool
    games: list[str] = field(default_factory=list)
    results: list[str] = field(default_factory=list)
    moves: dict[str, list[Ply]] = field(default_factory=lambda: defaultdict(list))
    best: str | None = None
    best_top: dict | None = None


def tree(cfg: Config, models: list[GameModel], colour: str, evals1: dict[str, dict]) -> dict[str, Node]:
    nodes: dict[str, Node] = {}
    for m in models:
        if m.row["my_color"] != colour:
            continue
        for p in m.plies:
            if p.phase != "opening":
                break
            key = p.move["key_before"]
            node = nodes.get(key)
            if node is None:
                result = evals1.get(key)
                top_line = result["lines"][0] if result and result.get("lines") else None
                node = nodes[key] = Node(key, p.move["fen_before"], p.mine, best=p.best, best_top=top_line)
            if m.id not in node.games:
                node.games.append(m.id)
                node.results.append(m.row["result"])
            node.moves[p.move["uci"]].append(p)
    return nodes


def leak_positions(cfg: Config, nodes: dict[str, Node], colour_score: float | None) -> list[tuple[Node, float, float | None]]:
    """My-turn positions where my move loses leak_drop+ on average, or my score is leak_score_gap+ below average."""
    o = cfg.analysis.openings
    out = []
    for node in nodes.values():
        if not node.my_turn or len(node.games) < o.leak_min_games:
            continue
        plies = [p for ps in node.moves.values() for p in ps]
        avg_drop = statistics.fmean(p.drop for p in plies)
        node_score = 100 * sum(POINTS[r] for r in node.results) / len(node.results)
        gap = node_score - colour_score if colour_score is not None else None
        if avg_drop >= o.leak_drop or (gap is not None and gap <= -o.leak_score_gap):
            out.append((node, avg_drop, gap))
    return sorted(out, key=lambda x: -x[1])


def surprise_candidates(cfg: Config, models: list[GameModel]) -> list[tuple[GameModel, Ply, Ply]]:
    """(game, opponent's opening move, my reply) where my reply was a Mistake or worse."""
    out = []
    for m in models:
        plies = m.plies
        for i in range(len(plies) - 1):
            theirs, mine = plies[i], plies[i + 1]
            if theirs.phase != "opening" or theirs.mine or not mine.mine:
                continue
            if band(cfg, mine.drop) in ("mistake", "blunder"):
                out.append((m, theirs, mine))
    return out


def surprises(cfg: Config, models: list[GameModel], explorer: dict[str, dict]) -> list[dict]:
    o = cfg.analysis.openings
    out = []
    for m, theirs, mine in surprise_candidates(cfg, models):
        pct, total = share(explorer.get(theirs.move["key_before"]), theirs.move["uci"])
        if pct is not None and total >= o.surprise_min_games and pct < o.surprise_share:
            out.append({"game": m, "theirs": theirs, "mine": mine, "share": pct, "explorer_games": total})
    return out


def explorer_keys(cfg: Config, models: list[GameModel], evals1: dict[str, dict]) -> set[str]:
    """Positions whose explorer stats get exported: tree positions I reached often enough, plus surprise candidates."""
    keys = set()
    for colour in ("white", "black"):
        keys |= {k for k, n in tree(cfg, models, colour, evals1).items() if len(n.games) >= cfg.analysis.openings.tree_min_games}
    keys |= {theirs.move["key_before"] for _, theirs, _ in surprise_candidates(cfg, models)}
    return keys


def opening_families(cfg: Config, models: list[GameModel], colour: str) -> list[dict]:
    """Per family and variation: games, score, score vs my other openings of the colour, Win% after move 12."""
    mine = [m for m in models if m.row["my_color"] == colour]
    after = 2 * cfg.analysis.phases.opening_moves

    def stats(group: list[GameModel]) -> dict:
        ids = {m.id for m in group}
        rest = [m for m in mine if m.id not in ids]
        s, r = score(group), score(rest)
        return {
            "games": len(group),
            "wins": sum(1 for m in group if m.row["result"] == "win"),
            "draws": sum(1 for m in group if m.row["result"] == "draw"),
            "losses": sum(1 for m in group if m.row["result"] == "loss"),
            "score": s,
            "score_vs_rest": s - r if s is not None and r is not None else None,
            "win_after_opening": mean(m.my_win[after] for m in group if len(m.my_win) > after),
            "accuracy": mean(m.my_accuracy for m in group),
            "game_ids": [m.id for m in by_time(group)],
        }

    families: dict[str, list[GameModel]] = defaultdict(list)
    for m in mine:
        families[m.opening.family if m.opening else "Unknown"].append(m)
    out = []
    for family, group in sorted(families.items(), key=lambda kv: -len(kv[1])):
        variations: dict[str, list[GameModel]] = defaultdict(list)
        for m in group:
            variations[(m.opening.variation if m.opening else None) or "(main line)"].append(m)
        out.append({"family": family, **stats(group),
                    "variations": [{"variation": v, **stats(g)} for v, g in sorted(variations.items(), key=lambda kv: -len(kv[1]))]})
    return out


# --- endgames ------------------------------------------------------------------------------------

def endgame_table(models: list[GameModel]) -> dict[str, Counter]:
    table: dict[str, Counter] = defaultdict(Counter)
    for m in models:
        if m.endgame:
            table[m.endgame.type][m.endgame.outcome] += 1
    return table


# --- insights ------------------------------------------------------------------------------------

def _group(models: list[GameModel], key) -> list[dict]:
    groups: dict = defaultdict(list)
    for m in models:
        if (k := key(m)) is not None:
            groups[k].append(m)
    return [{"key": k, "games": len(g), "score": score(g), "accuracy": mean(m.my_accuracy for m in g)}
            for k, g in sorted(groups.items(), key=lambda kv: kv[0])]


def _bucket(edges: tuple, value: float) -> str:
    i = bisect.bisect_right(edges, value)
    lo = edges[i - 1] if i else 0
    return f"{lo}+" if i == len(edges) else f"{lo}-{edges[i]}"


def previous_result(cfg: Config, models: list[GameModel]) -> dict[str, str]:
    """For each game, the result of the game before it if that ended within after_loss_minutes, else 'first'."""
    window = cfg.analysis.flags.after_loss_minutes * 60
    ordered = by_time(models)
    out = {}
    for prev, m in zip([None, *ordered], ordered):
        near = prev is not None and 0 <= m.row["start_ts"] - prev.row["end_ts"] <= window
        out[m.id] = f"after a {prev.row['result']}" if near else "first of a session"
    return out


def insights(cfg: Config, models: list[GameModel]) -> dict:
    i = cfg.analysis.insights
    tz = ZoneInfo(cfg.export.timezone)
    after = previous_result(cfg, models)
    mine = [(m, p) for m in models for p in m.mine() if not p.book]

    think = defaultdict(list)
    for _, p in mine:
        if p.move["think_time"] is not None:
            think[_bucket(i.think_buckets, p.move["think_time"])].append(p)
    think_rows = [
        {"key": k, "moves": len(ps), "blunder_rate": 100 * sum(p.label == "blunder" for p in ps) / len(ps),
         "mistake_or_worse_rate": 100 * sum(p.label in ("mistake", "blunder") for p in ps) / len(ps)}
        for k, ps in sorted(think.items(), key=lambda kv: float(kv[0].split("-")[0].rstrip("+")))
    ]

    phases = defaultdict(list)
    for _, p in mine:
        phases[p.phase].append(p)
    per_phase = [{"key": k, "moves": len(ps), "accuracy": mean(p.accuracy for p in ps),
                  "mistakes_per_game": sum(p.label in ("mistake", "blunder") for p in ps) / len(models)}
                 for k, ps in phases.items()]

    recent, previous = recent_split(cfg, models)
    def rates(group: list[GameModel]) -> dict[str, float | None]:
        if not group:
            return {}
        return {tag: sum(1 for m in group for r in m.records if tag in r.tags) / len(group) for tag in (*PRIMARY_TYPES, *FLAGS)}

    rated = [m for m in by_time(models) if m.row["rated"] and m.row["my_rating"]]
    return {
        "by_colour": _group(models, lambda m: m.row["my_color"]),
        "by_opening": _group(models, lambda m: f"{m.row['my_color']}: {m.opening.family}" if m.opening else None),
        "by_phase": per_phase,
        "by_opponent_rating": _group(models, lambda m: (m.row["opp_rating"] // i.rating_band) * i.rating_band if m.row["opp_rating"] else None),
        "by_hour": _group(models, lambda m: datetime.fromtimestamp(m.row["start_ts"], tz).hour),
        "by_length": _group(models, lambda m: _bucket(i.length_buckets, m.row["ply_count"])),
        "by_previous_result": _group(models, lambda m: after[m.id]),
        "think_time": think_rows,
        "time_losses": {"count": sum(1 for m in models if m.row["result"] == "loss" and m.row["my_code"] == "timeout"),
                        "by_month": dict(Counter(m.row["month"] for m in models if m.row["result"] == "loss" and m.row["my_code"] == "timeout"))},
        "rating": [{"ts": m.row["end_ts"], "rating": m.row["my_rating"]} for m in rated],
        "leak_rates": {"recent": rates(recent), "previous": rates(previous), "games": [len(recent), len(previous)]},
    }


def as_of(models: list[GameModel]) -> int:
    """The newest game's end time; used instead of the wall clock so exports are reproducible."""
    return max((m.row["end_ts"] for m in models), default=int(datetime.now(UTC).timestamp()))
