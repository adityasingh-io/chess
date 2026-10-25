// Openings, per colour: the tree of positions from my games, showing what I play there next to Stockfish's
// best and what players at my level and masters choose (Lichess explorer), how far my games stay in the
// trainer's lines, then the opening report: families, leak positions and surprises. Every number comes from
// openings/<colour>.json.
import { useEffect, useEffectEvent, useMemo, useRef, useState, type Ref } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Board, type ArrowKind } from "../components/Board";
import { EvalBar } from "../components/EvalBar";
import { useGameSummaries, useOpenings } from "../lib/data";
import { day, evalFor, grouped, moveName, n1, plural, signed } from "../lib/format";
import { lineSan, numberedLine, posKey, replay, sideToMove, type Side } from "../lib/chess";
import { START } from "../lib/lines";
import { activeLines, addLine, removeLine, useProgress } from "../lib/progress";
import { winOf } from "../lib/winpct";
import type { ExplorerMove, Family, LeakCard, OpeningReport, TreeMove, TreeNode, Variation } from "../types/export";

const COLOURS = ["white", "black"] as const;
const NAME = { white: "White", black: "Black" } as const;
const RES = { win: ["1", "Won"], loss: ["0", "Lost"], draw: ["½", "Drew"] } as const;
const GAMES_SHOWN = 8, SURPRISES_SHOWN = 10;
const LEVEL_MIN_SHARE = 1;   // explorer moves under this share of games at my level aren't listed
const MASTERS_MIN_SHARE = 5; // nor masters' moves under this share of their games

export default function Openings() {
  const { colour = "white" } = useParams();
  if (colour !== "white" && colour !== "black") {
    return <div className="problem"><b>No openings page for “{colour}”.</b><Link to="/openings/white">Openings as White</Link></div>;
  }
  return <OpeningsFor key={colour} colour={colour} />;
}

/** The ply number of the next move in a full FEN ("… b KQkq - 0 4" → 8). */
const nextPly = (fen: string) => {
  const f = fen.split(" ");
  return (Number(f[5]) - 1) * 2 + (f[1] === "w" ? 1 : 2);
};
const pctText = (x: number | null | undefined) => (x == null ? "–" : `${n1(x)}%`);

/** Moves from the root to `key` through the tree (shortest, so transpositions take the most direct route). */
function pathTo(root: TreeNode, byKey: Map<string, TreeNode>, key: string): string[] | null {
  const seen = new Map<string, string[]>([[root.key, []]]);
  const queue = [root];
  while (queue.length) {
    const n = queue.shift()!;
    const path = seen.get(n.key)!;
    if (n.key === key) return path;
    for (const m of n.moves) {
      const after = replay(n.fen, [m.uci])[0];
      const child = after ? byKey.get(posKey(after)) : undefined;
      if (child && !seen.has(child.key)) {
        seen.set(child.key, [...path, m.uci]);
        queue.push(child);
      }
    }
  }
  return null;
}

function OpeningsFor({ colour }: { colour: Side }) {
  const report = useOpenings(colour);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const byKey = useMemo(() => new Map(report.tree.map((n) => [n.key, n])), [report]);
  const root = report.tree[0];
  // The tree position is the line of moves from the start, kept in the URL (?line=d2d4,d7d5).
  const lineParam = params.get("line") ?? "";
  const { line, fens } = useMemo(() => {
    const want = lineParam.split(",").filter(Boolean);
    const fens = root ? replay(root.fen, want) : [];
    return { line: want.slice(0, fens.length), fens };
  }, [root, lineParam]);
  const setLine = (ucis: string[]) => {
    const next = new URLSearchParams(params);
    if (ucis.length) next.set("line", ucis.join(",")); else next.delete("line");
    setParams(next, { replace: true });
  };
  const treeRef = useRef<HTMLElement>(null);
  const show = (key: string) => {
    const path = root ? pathTo(root, byKey, key) : null;
    if (path) setLine(path);
    treeRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };

  return (
    <>
      <div className="page-head">
        <h1>Openings</h1>
        <p className="muted">
          {plural(report.games, "game")} as {NAME[colour]}, your score {pctText(report.score)}. The tree holds positions from
          moves 1–12 (and later book moves) that at least 2 of your games reached.
        </p>
      </div>
      <span className="seg" role="group" aria-label="Colour">
        {COLOURS.map((c) => (
          <button key={c} type="button" aria-pressed={c === colour} onClick={() => navigate(`/openings/${c}`)}>As {NAME[c]}</button>
        ))}
      </span>
      {root ? (
        <Tree ref={treeRef} report={report} colour={colour} byKey={byKey} root={root} line={line} fens={fens} setLine={setLine} />
      ) : (
        <div className="empty">No opening positions as {NAME[colour]} yet.</div>
      )}
      <CoverageCard report={report} onLine={(ucis) => { setLine(ucis); treeRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }); }} />
      <Families report={report} colour={colour} />
      <LeakCards report={report} colour={colour} onShow={show} />
      <Surprises report={report} colour={colour} />
    </>
  );
}

type Row = { uci: string; san: string; you?: TreeMove; level?: ExplorerMove; masters?: ExplorerMove; best: boolean; child?: TreeNode };

function Tree({ ref, report, colour, byKey, root, line, fens, setLine }: {
  ref: Ref<HTMLElement>; report: OpeningReport; colour: Side; byKey: Map<string, TreeNode>; root: TreeNode;
  line: string[]; fens: string[]; setLine: (ucis: string[]) => void;
}) {
  const fen = fens.at(-1) ?? root.fen;
  const node = byKey.get(posKey(fen)) ?? null;
  const crumbs = useMemo(() => numberedLine(root.fen, lineSan(root.fen, line)), [root, line]);

  // What I play here, Stockfish's best and the moves players at my level choose, in one table.
  const rows = useMemo(() => {
    if (!node) return [];
    const out = new Map<string, Row>();
    const row = (uci: string, san: string) => {
      let r = out.get(uci);
      if (!r) out.set(uci, r = { uci, san, best: uci === node.stockfish_best });
      return r;
    };
    for (const m of node.moves) row(m.uci, m.san).you = m;
    for (const e of node.explorer?.moves ?? []) if (e.share >= LEVEL_MIN_SHARE || out.has(e.uci)) row(e.uci, e.san).level = e;
    for (const e of node.masters?.moves ?? []) if (e.share >= MASTERS_MIN_SHARE || out.has(e.uci)) row(e.uci, e.san).masters = e;
    if (node.stockfish_best) row(node.stockfish_best, node.stockfish_best_san ?? node.stockfish_best);
    for (const r of out.values()) {
      const after = replay(node.fen, [r.uci])[0];
      r.child = after ? byKey.get(posKey(after)) : undefined;
    }
    return [...out.values()].sort((a, b) => (b.you?.games ?? 0) - (a.you?.games ?? 0) || (b.level?.share ?? 0) - (a.level?.share ?? 0));
  }, [node, byKey]);
  const forward = rows.find((r) => r.child && r.you);

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.("input, select, textarea")) return;
    if (e.key === "ArrowLeft" && line.length) setLine(line.slice(0, -1));
    else if (e.key === "ArrowRight" && forward) setLine([...line, forward.uci]);
    else if (e.key === "Home" && line.length) setLine([]);
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const myTurn = sideToMove(fen) === colour;
  const mostPlayed = node?.moves[0];
  const levelTop = node?.explorer?.moves[0];
  const mastersTop = node?.masters?.moves[0];
  const arrows: { uci: string; kind: ArrowKind }[] = [];
  const addArrow = (uci: string | null | undefined, kind: ArrowKind) => {
    if (uci && !arrows.some((a) => a.uci === uci)) arrows.push({ uci, kind });
  };
  addArrow(node?.stockfish_best, "best");
  addArrow(mostPlayed?.uci, myTurn ? "you" : "them");
  const lastUci = line.at(-1);
  const lastMine = line.length > 0 && sideToMove(fens.at(-2) ?? root.fen) === colour;

  return (
    <section ref={ref} className="card tree-card" aria-label={`Your opening tree as ${NAME[colour]}`}>
      <div className="card-head">
        <h2>Your tree as {NAME[colour]}</h2>
        <span className="muted small">← → to step · Home for the start</span>
      </div>
      <div className="chips crumbs" role="group" aria-label="Moves to this position">
        <button type="button" aria-pressed={!line.length} onClick={() => setLine([])}>Start</button>
        {crumbs.map((t, i) => (
          <button key={i} type="button" aria-pressed={i === line.length - 1} onClick={() => setLine(line.slice(0, i + 1))}>{t}</button>
        ))}
      </div>
      <div className="tree">
        <div className="tree-board">
          <div className="board-row">
            <EvalBar value={node ? { win: winOf(node.stockfish_eval), ev: node.stockfish_eval } : { win: 50 }} orientation={colour}
              me={colour} note="Stockfish's score for this position" />
            <Board id={`tree-${colour}`} fen={fen} orientation={colour} arrows={arrows}
              highlight={lastUci ? { uci: lastUci, kind: lastMine ? "you" : "them" } : null}
              label={crumbs.length ? `Position after ${crumbs.join(" ")}` : "Start position"} />
          </div>
          <span className="board-keys">
            <span><i style={{ background: "var(--best)" }} />Stockfish's best</span>
            <span><i style={{ background: myTurn ? "var(--you)" : "var(--them)" }} />{myTurn ? "Your most played" : "Their most played"}</span>
          </span>
          <div className="navbtns tree-nav">
            <button type="button" title="Start (Home)" aria-label="Start" disabled={!line.length} onClick={() => setLine([])}>⏮</button>
            <button type="button" title="Back a move (←)" aria-label="Back a move" disabled={!line.length}
              onClick={() => setLine(line.slice(0, -1))}>◀</button>
            <button type="button" title={forward ? `Your most played: ${forward.san} (→)` : "No further position in your tree"}
              aria-label="Forward along your most played move" disabled={!forward}
              onClick={() => forward && setLine([...line, forward.uci])}>▶</button>
            <DrillLine colour={colour} root={root} byKey={byKey} line={line} fens={fens} name={crumbs.join(" ")} />
          </div>
          <OffBook colour={colour} root={root} byKey={byKey} line={line} fens={fens} />
        </div>
        <div className="tree-info">
          {node ? (
            <>
              <div className="facts num">
                <span>{myTurn ? "Your move" : "Their move"}</span>
                <span>{plural(node.games, "game")}</span>
                <span>your score {pctText(node.score)}</span>
              </div>
              <div className="tree-facts">
                {node.stockfish_best_san && (
                  <span><span className="key best" />Stockfish: <b className="san">{moveName(nextPly(node.fen), node.stockfish_best_san)}</b>{" "}
                    <span className="num">({evalFor(node.stockfish_eval, colour)})</span></span>
                )}
                {levelTop && node.explorer && (
                  <span><span className="key them" />At your level: <b className="san">{moveName(nextPly(node.fen), levelTop.san)}</b>{" "}
                    <span className="num">{n1(levelTop.share)}% of {grouped(node.explorer.games)} games</span></span>
                )}
                {mastersTop && node.masters && (
                  <span><span className="key" />Masters: <b className="san">{moveName(nextPly(node.fen), mastersTop.san)}</b>{" "}
                    <span className="num">{n1(mastersTop.share)}% of {grouped(node.masters.games)} games</span></span>
                )}
              </div>
              <MovesTable rows={rows} myTurn={myTurn} ply={nextPly(node.fen)} onPick={(uci) => setLine([...line, uci])} />
              <Reached key={node.key} node={node} />
            </>
          ) : (
            <div className="empty">Fewer than 2 of your games as {NAME[colour]} reach this position.</div>
          )}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Out of {plural(report.games, "game")}; scores count a win as 100 and a draw as 50. “At your level” is the Lichess database
        for rapid games between players rated 1000 to 1399; “Masters” is the Lichess masters database of over-the-board games
        between titled players.
      </p>
    </section>
  );
}

/** A short stable id for a line of moves (FNV-1a). */
function lineId(colour: Side, line: string[]) {
  let h = 0x811c9dc5;
  for (const c of `${colour}:${line.join(" ")}`) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return `t-${(h >>> 0).toString(36)}`;
}
type LineProps = { colour: Side; root: TreeNode; byKey: Map<string, TreeNode>; line: string[]; fens: string[] };
/** The plies in the line where I'm the one moving. */
const myPlies = (colour: Side, root: TreeNode, line: string[], fens: string[]) =>
  line.map((_, i) => i).filter((i) => sideToMove(i ? fens[i - 1] : root.fen) === colour);

// Adds the moves to this position to the repertoire trainer as a line to play from memory.
function DrillLine({ colour, root, line, fens, name }: LineProps & { name: string }) {
  const p = useProgress();
  const id = lineId(colour, line);
  const added = activeLines(p).some((l) => l.id === id);
  const mine = myPlies(colour, root, line, fens).length;
  if (added) {
    return (
      <span className="drill-added">
        <Link to="/trainer" className="small">In the trainer</Link>
        <button type="button" className="linkish small" onClick={() => removeLine(id)}>Remove</button>
      </span>
    );
  }
  return (
    <button type="button" className="drill" disabled={!mine}
      title={mine ? "Add the moves to here to the repertoire trainer" : `The line needs at least one of your moves as ${NAME[colour]}`}
      onClick={() => addLine({ id, colour, name, moves: line })}>Drill this line</button>
  );
}

// Which of my moves along the line aren't Stockfish's best, so I know what I'd be drilling.
function OffBook({ colour, root, byKey, line, fens }: LineProps) {
  const off = myPlies(colour, root, line, fens).flatMap((i) => {
    const before = i ? fens[i - 1] : root.fen;
    const node = byKey.get(posKey(before));
    if (!node?.stockfish_best || node.stockfish_best === line[i]) return [];
    return [{ i, mine: lineSan(before, [line[i]])[0], best: node.stockfish_best_san ?? node.stockfish_best, ply: nextPly(before) }];
  });
  if (!off.length) return null;
  return (
    <p className="small off-book">
      In this line, Stockfish prefers another move to {off.length === 1 ? "your" : `${off.length} of your`} moves:{" "}
      {off.map((o, k) => (
        <span key={o.i}>{k ? "; " : ""}<span className="san">{moveName(o.ply, o.mine)}</span> (Stockfish: <span className="san">{moveName(o.ply, o.best)}</span>)</span>
      ))}.
    </p>
  );
}

function MovesTable({ rows, myTurn, ply, onPick }: { rows: Row[]; myTurn: boolean; ply: number; onPick: (uci: string) => void }) {
  if (!rows.length) return <div className="empty">No moves recorded from here.</div>;
  return (
    <table className="tm">
      <thead>
        <tr>
          <th scope="col">Move</th>
          <th scope="col" className="n">Games</th>
          <th scope="col" className="n">Your score</th>
          {myTurn && <th scope="col" className="n" title="Average Win% change from your move">Win% ±</th>}
          <th scope="col" className="n">At your level</th>
          <th scope="col" className="n">Masters</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.uci} className={r.child ? "go" : "end"} onClick={r.child ? () => onPick(r.uci) : undefined}>
            <th scope="row">
              {r.child ? (
                <button type="button" className="san" onClick={(e) => { e.stopPropagation(); onPick(r.uci); }}>{moveName(ply, r.san)}</button>
              ) : (
                <span className="san" title="Fewer than 2 of your games reach the position after this move">{moveName(ply, r.san)}</span>
              )}
              {r.best && <span className="star" title="Stockfish's best" aria-label="Stockfish's best">★</span>}
            </th>
            <td className="n">{r.you ? grouped(r.you.games) : "–"}</td>
            <td className="n">{r.you ? pctText(r.you.score) : "–"}</td>
            {myTurn && <td className="n">{r.you?.avg_drop != null ? signed(-r.you.avg_drop) : "–"}</td>}
            <td className="n">{r.level ? pctText(r.level.share) : "–"}</td>
            <td className="n">{r.masters ? pctText(r.masters.share) : "–"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// How far my games in this colour stay in the trainer's lines, and the replies that take them out most often
// without a line yet (each opens in the tree, where "Drill this line" adds it).
function CoverageCard({ report, onLine }: { report: OpeningReport; onLine: (ucis: string[]) => void }) {
  const c = report.coverage;
  if (!c.games) return null;
  const tally: [number, string][] = [[c.mine, "you left them"], [c.theirs, "your opponent did"], [c.ended, "reached a line's end"]];
  return (
    <section className="card" aria-label="Your lines in your games">
      <div className="card-head">
        <h2>Your lines in your games</h2>
        <Link to="/trainer" className="small">Trainer →</Link>
      </div>
      <p style={{ margin: 0 }}>
        Your games stay in your trainer lines for <b className="num">{c.stayed != null ? n1(c.stayed) : "–"}</b> moves on average.
      </p>
      <div className="facts num">
        {tally.map(([n, what]) => <span key={what}>{what}: {n} of {c.games}</span>)}
      </div>
      {c.gaps.length > 0 && (
        <>
          <div className="label">Replies with no line yet</div>
          <div className="rows">
            {c.gaps.map((g) => (
              <button key={g.moves.join(",")} type="button" className="row" onClick={() => onLine(g.moves)}>
                <span className="t san">{numberedLine(START, lineSan(START, g.moves)).join(" ")}</span>
                <span className="r muted small num">{plural(g.games, "game")}</span>
              </button>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            A reply in {c.min_games} or more of your games gets a line in the trainer by itself. Open one of these in the tree and
            pick “Drill this line” to add it now.
          </p>
        </>
      )}
    </section>
  );
}

function Reached({ node }: { node: TreeNode }) {
  const games = useGameSummaries();
  const [all, setAll] = useState(false);
  const list = useMemo(() => node.game_ids.map((id) => games.get(id)).filter((g) => !!g).sort((a, b) => b.start_ts - a.start_ts),
    [node, games]);
  return (
    <div className="reached">
      <div className="label">Games that reached this position</div>
      <div className="rows">
        {(all ? list : list.slice(0, GAMES_SHOWN)).map((g) => {
          const [mark, word] = RES[g.result];
          return (
            <Link key={g.id} className="row" to={`/games/${g.id}?pos=${encodeURIComponent(node.key)}`}>
              <span className="t">vs {g.opponent} {g.opp_rating != null && <span className="muted num">({g.opp_rating})</span>}</span>
              <span className="s">{day(g.start_ts)}{g.opening ? ` · ${g.opening}` : ""}</span>
              <span className="r"><span className={`res ${g.result}`} title={word}>{mark}</span></span>
            </Link>
          );
        })}
      </div>
      {list.length > GAMES_SHOWN && (
        <button type="button" className="btn ghost" onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${list.length}`}
        </button>
      )}
    </div>
  );
}

function Stats({ s, colour }: { s: Family | Variation; colour: Side }) {
  return (
    <span className="fam-stats">
      <span>score <b className="num">{pctText(s.score)}</b></span>
      {s.score_vs_rest != null && (
        <span className={`vs ${s.score_vs_rest >= 0 ? "up" : "down"}`}
          title={`Your score here against your other ${NAME[colour]} openings`}>
          <b className="num">{signed(s.score_vs_rest)}</b> vs the rest
        </span>
      )}
      <span title="Your average Win% after move 12">after move 12 <b className="num">{pctText(s.win_after_opening)}</b></span>
      <span>accuracy <b className="num">{s.accuracy != null ? n1(s.accuracy) : "–"}</b></span>
    </span>
  );
}

function Families({ report, colour }: { report: OpeningReport; colour: Side }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Families as {NAME[colour]}</h2>
        <span className="muted small">compared only with your other {NAME[colour]} openings</span>
      </div>
      <div className="fams">
        {report.families.map((f) => (
          <details key={f.family} className="fam">
            <summary>
              <span className="fam-name">{f.family}</span>
              <span className="fam-n muted num">{plural(f.games, "game")}</span>
              <Stats s={f} colour={colour} />
            </summary>
            <div className="fam-body">
              <div className="muted small">
                {f.wins} won · {f.draws} drawn · {f.losses} lost
                {f.family !== "Unknown" && (
                  <> · <Link to={`/games?opening=${encodeURIComponent(f.family)}&colour=${colour}`}>These games →</Link></>
                )}
              </div>
              {f.variations.map((v) => (
                <div key={v.variation} className="var">
                  <span className="fam-name">{v.variation}</span>
                  <span className="fam-n muted num">{plural(v.games, "game")}</span>
                  <Stats s={v} colour={colour} />
                </div>
              ))}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

function LeakCards({ report, colour, onShow }: { report: OpeningReport; colour: Side; onShow: (key: string) => void }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Leak positions</h2>
        <span className="board-keys">
          <span><i style={{ background: "var(--you)" }} />Your most played</span>
          <span><i style={{ background: "var(--best)" }} />Stockfish's best</span>
          <span><i style={{ background: "var(--them)" }} />At your level</span>
        </span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Positions from at least 5 games where your move loses 10 or more Win% on average, or your score is 15 or more below your
        {" "}{NAME[colour]} average. Transpositions count as one position.
      </p>
      {report.leaks.length ? (
        <div className="positions">
          {report.leaks.map((c, i) => <OpeningLeak key={c.key} c={c} i={i} colour={colour} onShow={() => onShow(c.key)} />)}
        </div>
      ) : <div className="empty">No leak positions as {NAME[colour]}.</div>}
    </section>
  );
}

function OpeningLeak({ c, i, colour, onShow }: { c: LeakCard; i: number; colour: Side; onShow: () => void }) {
  const ply = nextPly(c.fen);
  const arrows: { uci: string; kind: ArrowKind }[] = [];
  for (const [uci, kind] of [[c.stockfish_best, "best"], [c.you_play[0]?.uci, "you"], [c.level_best, "them"]] as const) {
    if (uci && !arrows.some((a) => a.uci === uci)) arrows.push({ uci, kind });
  }
  return (
    <article className="pos">
      <Board id={`oleak-${colour}-${i}`} fen={c.fen} orientation={colour} arrows={arrows}
        label={`Leak position: you play ${c.you_play[0]?.san ?? "?"}, Stockfish's best is ${c.stockfish_best_san ?? "not recorded"}`} />
      <div className="line1">
        <span className="num">{plural(c.games, "game")}</span>
        <span className="num" title="Average Win% change from your moves here">{signed(-c.avg_drop)} Win%</span>
      </div>
      <dl className="pos-facts">
        <div>
          <dt>You play</dt>
          <dd className="moves-list">{c.you_play.map((m) => (
            <span key={m.uci}><b className="san">{moveName(ply, m.san)}</b> ({plural(m.games, "game")}, score {pctText(m.score)})</span>
          ))}</dd>
        </div>
        {c.stockfish_best_san && (
          <div><dt>Stockfish</dt><dd><b className="san">{moveName(ply, c.stockfish_best_san)}</b> ({evalFor(c.stockfish_eval, colour)})</dd></div>
        )}
        {c.level_best_san && (
          <div><dt>At your level</dt><dd><b className="san">{moveName(ply, c.level_best_san)}</b> ({pctText(c.level_share)})</dd></div>
        )}
      </dl>
      {c.score_gap != null && (
        <div className="line2">Your score here: {signed(c.score_gap)} against your {NAME[colour]} average</div>
      )}
      <button type="button" className="linkish" onClick={onShow}>Show in the tree →</button>
    </article>
  );
}

function Surprises({ report, colour }: { report: OpeningReport; colour: Side }) {
  const games = useGameSummaries();
  const [shown, setShown] = useState(SURPRISES_SHOWN);
  const list = useMemo(() => [...report.surprises].sort((a, b) => (games.get(b.game)?.start_ts ?? 0) - (games.get(a.game)?.start_ts ?? 0)),
    [report, games]);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Surprises</h2>
        <span className="muted small">{plural(list.length, "time")}, newest first</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Your opponent played a move that under 10% of players at your level choose (over at least 20 games), and your reply was a
        mistake or a blunder.
      </p>
      {list.length ? (
        <div className="rows">
          {list.slice(0, shown).map((s) => {
            const g = games.get(s.game);
            return (
              <Link key={`${s.game}-${s.ply}`} className="row" to={`/games/${s.game}?ply=${s.ply + 1}&compare=1`}>
                <span className="t">
                  <span className="san">{moveName(s.ply, s.their_san)}</span>, then you played <span className="san">{moveName(s.ply + 1, s.my_san)}</span>
                </span>
                <span className="s">
                  {s.their_share > 0 ? `${n1(s.their_share)}% of` : "None of"} {grouped(s.explorer_games)} games at your level went {s.their_san} here
                  {g ? ` · vs ${g.opponent} · ${day(g.start_ts)}` : ""}
                </span>
                <span className="r num">{signed(-s.my_drop)} Win%</span>
              </Link>
            );
          })}
        </div>
      ) : <div className="empty">No surprises as {NAME[colour]}.</div>}
      {shown < list.length && (
        <button type="button" className="btn ghost" onClick={() => setShown((k) => k + SURPRISES_SHOWN)}>
          Show {Math.min(SURPRISES_SHOWN, list.length - shown)} more of {list.length - shown}
        </button>
      )}
    </section>
  );
}
