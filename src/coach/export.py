"""Write the static JSON the web app reads, validated against coach.schema.

Files are rewritten only when their content changes, so a re-run with no new games touches nothing.
"""

from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import chess
from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from coach import schema as S
from coach.config import Config
from coach.model import GameModel, Ply, Record
from coach.puzzles import lichess_puzzle, load_subset, my_puzzles, sans
from coach.repertoire import leak_lines, line_id, read_pgn
from coach.reports import (
    POINTS, as_of, by_time, endgame_table, insights, leak_positions, leaks, loss_summary, opening_families,
    score, surprises, top_leaks, tree,
)
from coach.templates import explain, line_san, move_san


def r1(x: float | None) -> float | None:
    return None if x is None else round(x, 1)


def ev(line: dict | None) -> S.Eval | None:
    return S.Eval(cp=line.get("cp"), mate=line.get("mate")) if line else None


def record_out(r: Record, notes: dict[str, str]) -> S.Record:
    move = r.ply.move
    best = r.best_line[0] if r.best_line else None
    return S.Record(
        id=r.id, game=r.game.id, ply=r.ply.number, ts=r.game.row["start_ts"], colour=r.game.row["my_color"],
        fen=move["fen_before"], san=move["san"], uci=move["uci"],
        best=best, best_san=move_san(move["fen_before"], best),
        best_line=r.best_line, best_line_san=line_san(move["fen_before"], r.best_line),
        reply_line=r.reply_line, reply_line_san=line_san(move["fen_after"], r.reply_line),
        best_eval=ev(r.before_top), after_eval=ev(r.after_top), after_terminal=r.after_terminal,
        win_before=r1(r.ply.win_before), win_after=r1(r.ply.win_after), drop=r1(r.ply.drop),
        severity=r.severity, phase=r.ply.phase,
        opening=r.game.opening.family if r.game.opening else None,
        endgame_type=r.game.endgame.type if r.game.endgame and r.ply.phase == "endgame" else None,
        think=r1(move["think_time"]), clock=r1(move["clock"]), opp_rating=r.game.row["opp_rating"],
        primary=r.primary, subtype=r.subtype, flags=r.flags, tags=r.tags, themes=r.themes,
        confirmed=r.confirmed, source=r.source, net_after=r.net_after, net_best=r.net_best,
        rule=r.rule, explanation=explain(r), note=notes.get(r.id),
    )


def endgame_out(m: GameModel, evals2: dict[str, dict], evals1: dict[str, dict]) -> S.EndgameInfo | None:
    e = m.endgame
    if not e:
        return None
    line_text = None
    if e.spoiler:
        key = e.spoiler.move["key_before"]
        result = evals2.get(key) or evals1.get(key)
        if result and result.get("lines"):
            line_text = line_san(e.spoiler.move["fen_before"], result["lines"][0]["pv"])
    return S.EndgameInfo(
        start_ply=e.start, type=e.type, win_start=r1(e.win_start), outcome=e.outcome,
        spoiler_ply=e.spoiler.number if e.spoiler else None, spoiler_san=e.spoiler.move["san"] if e.spoiler else None,
        spoiler_drop=r1(e.spoiler.drop) if e.spoiler else None, spoiler_best_line_san=line_text,
    )


def move_out(p: Ply, evals1: dict[str, dict], record_ids: dict[int, str], plies: int) -> S.Move:
    after = evals1.get(p.move["key_after"])
    best_line = []
    before = evals1.get(p.move["key_before"])
    if before and before.get("lines"):
        best_line = before["lines"][0]["pv"][:plies]
    return S.Move(
        ply=p.number, side=p.move["side"], san=p.move["san"], uci=p.move["uci"],
        clock=r1(p.move["clock"]), think=r1(p.move["think_time"]), win=r1(p.white_after),
        eval=ev(after["lines"][0]) if after and after.get("lines") else None,
        best=p.best, best_line=best_line, label=p.label, accuracy=r1(p.accuracy), phase=p.phase,
        record=record_ids.get(p.number),
    )


def game_out(cfg: Config, m: GameModel, evals1: dict[str, dict], evals2: dict[str, dict], notes: dict[str, str],
             puzzles: int) -> S.Game:
    row = m.row
    record_ids = {r.ply.number: r.id for r in m.records}
    loss = None
    if m.loss:
        loss = S.LossInfo(cause=m.loss.cause, subtype=m.loss.subtype, flags=m.loss.flags,
                          turning_ply=m.loss.turning_point.number if m.loss.turning_point else None,
                          record=m.loss.record.id if m.loss.record else None)
    thrown = None
    if m.thrown:
        p = m.thrown.move
        thrown = S.ThrownInfo(peak=r1(m.thrown.peak), ply=p.number if p else None, san=p.move["san"] if p else None,
                              drop=r1(p.drop) if p else None)
    opening = None
    if m.opening:
        opening = S.OpeningRef(eco=m.opening.eco, name=m.opening.name, family=m.opening.family,
                               variation=m.opening.variation, ply=m.opening_ply)
    return S.Game(
        id=m.id, url=row["url"], start_ts=row["start_ts"], end_ts=row["end_ts"], colour=row["my_color"],
        opponent=row["opp_username"], my_rating=row["my_rating"], opp_rating=row["opp_rating"], result=row["result"],
        my_code=row["my_code"], termination=row["termination"], time_control=row["time_control"],
        rated=bool(row["rated"]), initial_fen=row["initial_fen"], start_win=r1(m.white_win[0]), opening=opening,
        accuracy={c: r1(v) for c, v in m.accuracy.items()},
        chesscom_accuracy={"white": row["cc_acc_white"], "black": row["cc_acc_black"]},
        moves=[move_out(p, evals1, record_ids, cfg.engine.pv_plies) for p in m.plies],
        records=[record_out(r, notes) for r in m.records], puzzles=puzzles,
        loss=loss, thrown=thrown, endgame=endgame_out(m, evals2, evals1),
    )


def game_summary(m: GameModel, puzzles: int) -> S.GameSummary:
    mine = Counter(p.label for p in m.mine())
    return S.GameSummary(
        id=m.id, start_ts=m.row["start_ts"], colour=m.row["my_color"], opponent=m.row["opp_username"],
        opp_rating=m.row["opp_rating"], my_rating=m.row["my_rating"], result=m.row["result"], my_code=m.row["my_code"],
        opening=m.opening.family if m.opening else None, accuracy=r1(m.my_accuracy), plies=len(m.plies),
        inaccuracies=mine["inaccuracy"], mistakes=mine["mistake"], blunders=mine["blunder"],
        loss_cause=m.loss.cause if m.loss else None, thrown=m.thrown is not None, puzzles=puzzles,
    )


def tree_move(uci: str, plies: list[Ply], results: dict[str, str], my_turn: bool) -> S.TreeMove:
    games = sorted({p.move["game_id"] for p in plies})
    return S.TreeMove(uci=uci, san=plies[0].move["san"], games=len(games),
                      score=r1(100 * sum(POINTS[results[g]] for g in games) / len(games)),
                      avg_drop=r1(sum(p.drop for p in plies) / len(plies)) if my_turn else None)


def explorer_out(stats: dict | None, fen: str) -> S.ExplorerStats | None:
    if not stats:
        return None
    total = (stats.get("white") or 0) + (stats.get("draws") or 0) + (stats.get("black") or 0)
    moves = []
    for mv in stats.get("moves") or []:
        n = mv["white"] + mv["draws"] + mv["black"]
        moves.append(S.ExplorerMove(uci=mv["uci"], san=mv["san"], share=r1(100 * n / total) if total else 0.0, games=n))
    return S.ExplorerStats(games=total, moves=moves)


def opening_out(cfg: Config, models: list[GameModel], colour: str, evals1: dict[str, dict],
                explorer: dict[str, dict], stamp: int) -> S.OpeningReport:
    mine = [m for m in models if m.row["my_color"] == colour and m.plies]  # a game with no moves has no opening
    results = {m.id: m.row["result"] for m in models}
    nodes = tree(cfg, models, colour, evals1)
    colour_score = score(mine)

    def node_out(n) -> S.TreeNode:
        best_san = move_san(n.fen, n.best)
        stats = explorer.get(n.key) if len(n.games) >= cfg.analysis.openings.tree_min_games else None
        return S.TreeNode(
            key=n.key, fen=n.fen, my_turn=n.my_turn, games=len(n.games), game_ids=n.games,
            score=r1(100 * sum(POINTS[r] for r in n.results) / len(n.results)),
            moves=sorted((tree_move(u, ps, results, n.my_turn) for u, ps in n.moves.items()), key=lambda t: -t.games),
            stockfish_best=n.best, stockfish_best_san=best_san, stockfish_eval=ev(n.best_top),
            explorer=explorer_out(stats, n.fen),
        )

    cards = []
    for n, avg_drop, gap in leak_positions(cfg, nodes, colour_score):
        level = explorer_out(explorer.get(n.key), n.fen)
        top_level = level.moves[0] if level and level.moves else None
        cards.append(S.LeakCard(
            key=n.key, fen=n.fen, games=len(n.games), avg_drop=r1(avg_drop), score_gap=r1(gap),
            you_play=sorted((tree_move(u, ps, results, True) for u, ps in n.moves.items()), key=lambda t: -t.games),
            stockfish_best=n.best, stockfish_best_san=move_san(n.fen, n.best), stockfish_eval=ev(n.best_top),
            level_best=top_level.uci if top_level else None, level_best_san=top_level.san if top_level else None,
            level_share=top_level.share if top_level else None,
        ))
    surprise_cards = []
    for s in surprises(cfg, mine, explorer):
        record = next((r.id for r in s["game"].records if r.ply is s["mine"]), None)
        surprise_cards.append(S.Surprise(
            game=s["game"].id, ply=s["theirs"].number, fen=s["theirs"].move["fen_before"],
            their_san=s["theirs"].move["san"], their_share=r1(s["share"]), explorer_games=s["explorer_games"],
            my_san=s["mine"].move["san"], my_drop=r1(s["mine"].drop), record=record,
        ))
    families = [S.Family(**{**f, "variations": [S.Variation(**v) for v in f["variations"]]})
                for f in opening_families(cfg, models, colour)]
    return S.OpeningReport(
        as_of=stamp, colour=colour, games=len(mine), score=r1(colour_score), families=families,
        tree=[node_out(n) for n in sorted(nodes.values(), key=lambda n: -len(n.games))
              if len(n.games) >= cfg.analysis.openings.tree_min_games],
        leaks=cards, surprises=surprise_cards,
    )


def repertoire_out(cfg: Config, models: list[GameModel], evals1: dict[str, dict], stamp: int) -> S.Repertoire:
    path = cfg.root / cfg.repertoire.pgn
    lines, seen = [], set()
    for colour, name, moves in read_pgn(path):
        lines.append((colour, name, "repertoire", moves, 0))
    for colour, name, moves, start in leak_lines(cfg, models, evals1):
        lines.append((colour, name, "leak", moves, start))
    out = []
    for colour, name, source, moves, start in lines:
        lid = line_id(colour, moves)
        if lid in seen:
            continue
        seen.add(lid)
        out.append(S.RepertoireLine(id=lid, colour=colour, name=name, source=source, moves=moves,
                                    san=sans(chess.STARTING_FEN, moves), start=start))
    return S.Repertoire(as_of=stamp, pgn=cfg.repertoire.pgn if path.exists() else None, lines=out)


@dataclass
class Built:
    files: dict[str, BaseModel]
    games: dict[str, S.Game]


def build(cfg: Config, models: list[GameModel], n_games: int, evals1: dict[str, dict], evals2: dict[str, dict],
          explorer: dict[str, dict], notes: dict[str, str] | None = None) -> Built:
    stamp = as_of(models)
    ordered = by_time(models)
    all_leaks = leaks(cfg, models)
    records = [r for m in ordered for r in m.records]
    lost = [m for m in ordered if m.loss]
    thrown = [m for m in ordered if m.thrown]
    month_ago = stamp - 30 * 86400
    rated = [m for m in ordered if m.row["rated"] and m.row["my_rating"]]
    engine = S.EngineInfo(version=cfg.engine.version, pass1=cfg.engine.pass1.key, pass2=cfg.engine.pass2.key)

    mine = S.PuzzleSet(as_of=stamp, source="mine", puzzles=[S.Puzzle(**p) for p in my_puzzles(cfg, ordered, evals2)])
    per_game = Counter(p.game for p in mine.puzzles)
    games = {m.id: game_out(cfg, m, evals1, evals2, notes or {}, per_game[m.id]) for m in ordered}
    record_index = [r for g in games.values() for r in g.records]
    lichess = S.PuzzleSet(as_of=stamp, source="lichess", puzzles=lichess_puzzles(cfg))
    files: dict[str, BaseModel] = {
        "summary.json": S.Summary(
            as_of=stamp, username=cfg.player.username, rating=rated[-1].row["my_rating"] if rated else None,
            rating_goal=cfg.player.rating_goal, goal_date=cfg.player.goal_date.isoformat(), games=n_games,
            analysed=len(models), records=len(records), losses=len(lost),
            why_i_lost=dict(loss_summary(models)), why_i_lost_30_days=dict(loss_summary(models, month_ago)),
            top_leaks=[S.TopLeak(tag=l.tag, kind=l.kind, count=l.count, per_game=round(l.per_game, 3),
                                 recent=None if l.recent is None else round(l.recent, 3),
                                 previous=None if l.previous is None else round(l.previous, 3), win_lost=r1(l.win_lost))
                       for l in top_leaks(cfg, all_leaks)],
            thrown=len(thrown), engine=engine,
        ),
        "games/index.json": S.GamesIndex(as_of=stamp, games=[game_summary(m, per_game[m.id]) for m in reversed(ordered)]),
        "mistakes/index.json": S.MistakesIndex(as_of=stamp, records=record_index),
        "losses.json": S.Losses(
            as_of=stamp, total=len(lost), causes=dict(loss_summary(models)), causes_30_days=dict(loss_summary(models, month_ago)),
            losses=[S.LossEntry(game=g.id, ts=g.start_ts, **games[g.id].loss.model_dump()) for g in (games[m.id] for m in lost)],
            thrown=[S.ThrownEntry(game=m.id, ts=m.row["start_ts"], result=m.row["result"], colour=m.row["my_color"],
                                  opponent=m.row["opp_username"], fen=m.thrown.move.move["fen_before"] if m.thrown.move else None,
                                  win_before=r1(m.thrown.move.win_before) if m.thrown.move else None,
                                  **games[m.id].thrown.model_dump())
                    for m in thrown],
        ),
        "leaks.json": S.Leaks(as_of=stamp, games=len(models), recent_games=cfg.analysis.insights.recent_games, leaks=[
            S.Leak(tag=l.tag, kind=l.kind, count=l.count, per_game=round(l.per_game, 3),
                   recent=None if l.recent is None else round(l.recent, 3),
                   previous=None if l.previous is None else round(l.previous, 3),
                   win_lost=r1(l.win_lost), records=l.records)
            for l in all_leaks]),
        "openings/white.json": opening_out(cfg, models, "white", evals1, explorer, stamp),
        "openings/black.json": opening_out(cfg, models, "black", evals1, explorer, stamp),
        "endgames.json": S.Endgames(
            as_of=stamp, games=sum(1 for m in models if m.endgame),
            table={k: dict(v) for k, v in endgame_table(models).items()},
            endgames=[S.EndgameGame(game=m.id, ts=m.row["start_ts"], result=m.row["result"], info=games[m.id].endgame)
                      for m in ordered if m.endgame],
        ),
        "insights.json": S.Insights(as_of=stamp, **_rounded(insights(cfg, models))),
        "puzzles/mine.json": mine,
        "puzzles/lichess.json": lichess,
        "puzzles/index.json": S.PuzzleIndex(as_of=stamp, mine=tag_counts(mine), lichess=tag_counts(lichess)),
        "repertoire.json": repertoire_out(cfg, models, evals1, stamp),
    }
    return Built(files, games)


def lichess_puzzles(cfg: Config) -> list[S.Puzzle]:
    """From the cached subset; without one (a fresh checkout), keep what was exported last time."""
    subset = load_subset(cfg)
    if subset is not None:
        return [S.Puzzle(**lichess_puzzle(row)) for row in subset]
    last = cfg.export_dir / "puzzles" / "lichess.json"
    return S.PuzzleSet.model_validate_json(last.read_text()).puzzles if last.exists() else []


def tag_counts(puzzles: S.PuzzleSet) -> dict[str, int]:
    return dict(Counter(t for p in puzzles.puzzles for t in p.tags).most_common())


def _rounded(value):
    if isinstance(value, float):
        return round(value, 3)
    if isinstance(value, dict):
        return {k: _rounded(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_rounded(v) for v in value]
    return value


def _dump(model: BaseModel) -> str:
    return json.dumps(model.model_dump(mode="json"), separators=(",", ":"), ensure_ascii=False)


def write(cfg: Config, built: Built) -> tuple[int, int]:
    """(files written, files unchanged). Game files for games no longer exported are removed."""
    out = cfg.export_dir
    written = unchanged = 0
    targets = {**built.files, **{f"games/{gid}.json": g for gid, g in built.games.items()}}
    for rel, model in targets.items():
        path = out / rel
        text = _dump(model)
        if path.exists() and path.read_text() == text:
            unchanged += 1
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        written += 1
    keep = {f"{gid}.json" for gid in built.games} | {"index.json"}
    for stale in (out / "games").glob("*.json"):
        if stale.name not in keep:
            stale.unlink()
    write_schema(cfg)
    return written, unchanged


def write_schema(cfg: Config) -> Path:
    """JSON Schema for every export model, for generating the web app's TypeScript types."""
    models = sorted({*S.FILES.values(), S.Game}, key=lambda m: m.__name__)
    _, schema = models_json_schema([(m, "serialization") for m in models], title="Chess coach export")
    path = cfg.root / "web" / "schema" / "export.schema.json"
    text = json.dumps(schema, indent=1) + "\n"
    if not path.exists() or path.read_text() != text:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return path
