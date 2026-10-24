import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { Board, type ArrowKind, type HighlightKind } from "../components/Board";
import { EvalChart, ThinkChart, type ThinkBar } from "../components/charts";
import { LineChips, Nag } from "../components/bits";
import { useGame } from "../lib/data";
import { clock, dateTime, evalFor, grouped, moveName, n1, sanTokens, signed, timeControl } from "../lib/format";
import { gameOver, lineSan, numberedLine, replay, sideToMove, targets, tryMove, uciParts, type Side } from "../lib/chess";
import { useLiveEngine, type LiveState } from "../lib/engine";
import { FLAG, LABEL, RESULT_WORD, SEV, SEVERITIES, SHORT, TYPE, tagName } from "../lib/names";
import type { Game, Move, Record as MistakeRecord } from "../types/export";

export default function GameViewerRoute() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const ply = params.get("ply");
  return <GameViewer key={`${id}:${ply ?? ""}`} id={id} startPly={ply != null && /^\d+$/.test(ply) ? Number(ply) : null} />;
}

type Line = { key: string; fens: string[]; ucis: string[]; tokens: string[]; i: number };
type ExploreMove = { uci: string; san: string; fen: string };
type Explore = { base: string; from: string; moves: ExploreMove[] };

function GameViewer({ id, startPly }: { id: string; startPly: number | null }) {
  const g = useGame(id);
  const me = g.colour, opp: Side = me === "white" ? "black" : "white";
  const fens = useMemo(() => [g.initial_fen, ...replay(g.initial_fen, g.moves.map((m) => m.uci))], [g]);
  const n = fens.length - 1;   // = g.moves.length unless the export's moves stop replaying
  const recAt = useMemo(() => new Map(g.records.map((r) => [r.ply, r])), [g]);
  const myWin = useMemo(() => [g.start_win, ...g.moves.slice(0, n).map((m) => m.win)].map((w) => (me === "black" ? 100 - w : w)), [g, me, n]);
  const labels = useMemo(() => ["start", ...g.moves.map((m) => moveName(m.ply, m.san))], [g]);
  const turning = g.loss?.turning_ply ?? null;

  const clamp = useCallback((k: number) => Math.max(0, Math.min(n, k)), [n]);
  const [cur, setCur] = useState(() => clamp(startPly ?? turning ?? 0));
  const [flip, setFlip] = useState(false);
  const [line, setLine] = useState<Line | null>(null);
  const [explore, setExplore] = useState<Explore | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const go = useCallback((k: number) => {
    setCur(clamp(k));
    setLine(null);
    setExplore(null);
    setSelected(null);
  }, [clamp]);

  const m: Move | undefined = cur ? g.moves[cur - 1] : undefined;
  const r = recAt.get(cur);
  const mine = (mv?: Move) => mv?.side === me;
  const gameFen = line ? line.fens[line.i] : fens[cur];
  const exploreFen = explore ? (explore.moves.at(-1)?.fen ?? explore.base) : null;
  const shownFen = exploreFen ?? gameFen;
  const over = exploreFen ? gameOver(exploreFen) : null;
  const live = useLiveEngine(exploreFen && !over ? exploreFen : null);

  // Keyboard: ← → Home End step through the game, F flips; in Explore ← takes a move back and Esc leaves.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.("input, select, textarea")) return;
      if (explore) {
        if (e.key === "Escape") setExplore(null);
        else if (e.key === "ArrowLeft") setExplore((x) => (x && x.moves.length ? { ...x, moves: x.moves.slice(0, -1) } : null));
        else if (e.key === "f" || e.key === "F") setFlip((f) => !f);
        else return;
      } else if (e.key === "ArrowLeft") go(cur - 1);
      else if (e.key === "ArrowRight") go(cur + 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(n);
      else if (e.key === "f" || e.key === "F") setFlip((f) => !f);
      else if (e.key === "Escape" && line) setLine(null);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cur, n, go, explore, line]);

  const play = useCallback((from: string, to: string, promotion?: string) => {
    const fen = exploreFen ?? gameFen;
    const mv = tryMove(fen, from, to, promotion);
    if (!mv) return false;
    setExplore((x) => (x ? { ...x, moves: [...x.moves, mv] } : { base: gameFen, from: line ? line.tokens[line.i] : labels[cur], moves: [mv] }));
    setSelected(null);
    return true;
  }, [exploreFen, gameFen, line, labels, cur]);

  const dots = useMemo(() => (selected ? targets(shownFen, selected) : []), [selected, shownFen]);
  const onSquare = (square: string) => {
    if (selected && dots.includes(square)) { play(selected, square); return; }
    setSelected(targets(shownFen, square).length ? square : null);
  };

  // What the board shows.
  let arrows: { uci: string; kind: ArrowKind }[] = [];
  let highlight: { uci: string; kind: HighlightKind } | null = null;
  const showBest = !!m && mine(m) && !!m.best && m.best !== m.uci && m.label !== "best" && m.label !== "book";
  if (explore) {
    const last = explore.moves.at(-1);
    if (last) highlight = { uci: last.uci, kind: "them" };
    if (live.lines[0]) arrows = [{ uci: live.lines[0].pv[0], kind: "live" }];
  } else if (line) {
    highlight = { uci: line.ucis[line.i], kind: "best" };
  } else if (m) {
    highlight = { uci: m.uci, kind: mine(m) ? "you" : "them" };
    if (mine(m)) arrows = showBest ? [{ uci: m.best!, kind: "best" }, { uci: m.uci, kind: "you" }] : [{ uci: m.uci, kind: "you" }];
  }
  const orientation: Side = flip ? opp : me;
  const toMove = sideToMove(shownFen);

  const startClock = Number(g.time_control.split("+")[0]);
  const clockOf = (side: Side) => {
    for (let k = cur; k >= 1; k--) if (g.moves[k - 1].side === side) return g.moves[k - 1].clock;
    return Number.isFinite(startClock) ? startClock : null;
  };
  const strip = (side: Side) => {
    const c = clockOf(side);
    return (
      <div className={`strip${side === toMove ? " to-move" : ""}`}>
        <span className="pl">
          <i className={`sw ${side}`} />{side === me ? "You" : g.opponent}
          <span className="muted num">{side === me ? g.my_rating : g.opp_rating}</span>
        </span>
        <span className="clk num" aria-label={`${side} clock`}>{c != null ? clock(c) : "–"}</span>
      </div>
    );
  };

  const records = useMemo(() => g.records.map((x) => ({ ply: x.ply, severity: x.severity })), [g]);
  const bars = useMemo<ThinkBar[]>(() => g.moves.filter((x) => x.side === me && x.think != null)
    .map((x) => ({ k: x.ply, t: x.think!, label: moveName(x.ply, x.san), severity: recAt.get(x.ply)?.severity ?? null })), [g, me, recAt]);

  const caption = explore ? (
    <span><span className="live-badge">LIVE</span> <b>Explore</b> · {explore.moves.length ? `${explore.moves.length} from ${explore.from}` : `from ${explore.from}`}</span>
  ) : line ? (
    <span><b>Stockfish's line</b> · {line.tokens[line.i]} · <button type="button" className="linkish" onClick={() => setLine(null)}>back to the game</button></span>
  ) : m ? (
    <span>After <b className="san">{moveName(cur, m.san)}</b> · {cur} of {n}</span>
  ) : <span>Start position</span>;

  return (
    <>
      <GameHead g={g} me={me} opp={opp} onTurning={turning != null ? () => go(turning) : undefined} broken={n < g.moves.length ? n : null} />
      <div className="viewer">
        <div className="colA">
          <div className="v-board">
            <div className="board-cap">
              {caption}
              {arrows.length > 1 && (
                <span className="board-keys">
                  <span><i style={{ background: "var(--you)" }} />Your move</span>
                  <span><i style={{ background: "var(--best)" }} />Stockfish's best</span>
                </span>
              )}
            </div>
            {strip(orientation === "white" ? "black" : "white")}
            <Board id={`game-${g.id}`} fen={shownFen} orientation={orientation} arrows={arrows} highlight={highlight}
              selected={selected} dots={dots} onDrop={(from, to) => play(from, to)} onSquare={onSquare}
              label={explore ? "Explore board: play any move" : m ? `Position after ${moveName(cur, m.san)}` : "Start position"} />
            {strip(orientation)}
            <div className="navbtns">
              <button type="button" title="First move (Home)" aria-label="First move" onClick={() => go(0)}>⏮</button>
              <button type="button" title="Previous (←)" aria-label="Previous move" onClick={() => go(cur - 1)}>◀</button>
              <button type="button" title="Next (→)" aria-label="Next move" onClick={() => go(cur + 1)}>▶</button>
              <button type="button" title="Last move (End)" aria-label="Last move" onClick={() => go(n)}>⏭</button>
              <button type="button" title="Flip board (F)" aria-label="Flip board" onClick={() => setFlip((f) => !f)}>⇅</button>
              <button type="button" className="live" aria-pressed={!!explore}
                title="Play any move here; the in-browser Stockfish evaluates it live, never saved"
                onClick={() => setExplore((x) => (x ? null : { base: gameFen, from: line ? line.tokens[line.i] : labels[cur], moves: [] }))}>
                {explore ? "Leave explore" : "Explore · live"}
              </button>
            </div>
          </div>
          <section className="card v-graph">
            <div className="card-head">
              <h2>Win% and think time</h2>
              <span className="legend-inline">
                {SEVERITIES.map((s) => <span key={s}><Nag severity={s} /> {SEV[s]}</span>)}
              </span>
            </div>
            <EvalChart cur={cur} myWin={myWin} labels={labels} records={records} turning={turning}
              endgameStart={g.endgame?.start_ply ?? null} onPick={go} />
            <div className="label">Your think time per move</div>
            <ThinkChart cur={cur} n={n} bars={bars} onPick={go} />
          </section>
        </div>
        <div className="colB">
          {explore ? (
            <LivePanel live={live} explore={explore} me={me} over={over}
              onPlay={(uci) => { const p = uciParts(uci); play(p.from, p.to, p.promotion); }}
              onUndo={() => setExplore((x) => (x ? { ...x, moves: x.moves.slice(0, -1) } : x))}
              onClose={() => setExplore(null)} />
          ) : (
            <Explain g={g} me={me} cur={cur} m={m} r={r} myWin={myWin} turning={turning} fens={fens} line={line} setLine={setLine} />
          )}
          <section className="card v-moves">
            <div className="card-head"><h2>Moves</h2><span className="muted small">← → to step · F to flip</span></div>
            <MoveList moves={g.moves.slice(0, n)} recAt={recAt} me={me} turning={turning} cur={explore ? -1 : cur} onPick={go} />
          </section>
        </div>
      </div>
    </>
  );
}

function GameHead({ g, me, opp, onTurning, broken }: { g: Game; me: Side; opp: Side; onTurning?: () => void; broken: number | null }) {
  const turning = g.loss?.turning_ply ?? null;
  return (
    <section className="card game-head">
      <div className="card-head">
        <div>
          <div className="label">{RESULT_WORD[g.result]}{g.termination ? ` · ${g.termination}` : ""}</div>
          <h1 className="vs">vs {g.opponent} {g.opp_rating != null && <span className="muted num">({g.opp_rating})</span>}</h1>
        </div>
        <div className="acc">
          <div><span className="label">Your accuracy</span><span className="v">{g.accuracy[me] != null ? n1(g.accuracy[me]!) : "–"}</span></div>
          <div><span className="label">{g.opponent}</span><span className="v muted">{g.accuracy[opp] != null ? n1(g.accuracy[opp]!) : "–"}</span></div>
        </div>
      </div>
      <div className="facts">
        <span>You: {me === "white" ? "White" : "Black"}{g.my_rating != null ? ` · ${g.my_rating}` : ""}</span>
        <span>{timeControl(g.time_control)} · {g.rated ? "rated" : "unrated"}</span>
        <span>{dateTime(g.start_ts)}</span>
        {g.opening && <span>{g.opening.name} ({g.opening.eco})</span>}
        <a href={g.url} target="_blank" rel="noopener noreferrer">Open on chess.com ↗</a>
      </div>
      {g.loss && (
        <div className="chips">
          {onTurning && turning != null ? (
            <button type="button" className="cause-chip" onClick={onTurning}>
              Why you lost: <b>{TYPE[g.loss.cause] ?? g.loss.cause}</b>
              {g.loss.subtype ? ` (${tagName(g.loss.subtype)})` : ""} at {moveName(turning, g.moves[turning - 1]?.san ?? "")}
            </button>
          ) : (
            <span className="cause-chip">Why you lost: <b>{TYPE[g.loss.cause] ?? g.loss.cause}</b></span>
          )}
          {g.loss.flags.map((f) => <span key={f} className="pill">{FLAG[f] ?? f}</span>)}
        </div>
      )}
      {broken != null && <div className="callout">The exported moves stop replaying after ply {broken}; the viewer shows the game up to there.</div>}
    </section>
  );
}

function Explain({ g, me, cur, m, r, myWin, turning, fens, line, setLine }: {
  g: Game; me: Side; cur: number; m?: Move; r?: MistakeRecord; myWin: number[]; turning: number | null; fens: string[];
  line: Line | null; setLine: (l: Line | null) => void;
}) {
  const mineMove = m?.side === me;
  // Stockfish's best line for my move: the record's (checked deeper) if there is one, else the move's own.
  const best = useMemo(() => {
    if (!m || !mineMove || !m.best || m.best === m.uci || m.label === "best" || m.label === "book") return null;
    const base = fens[cur - 1];
    if (r) return { base, ucis: r.best_line, tokens: sanTokens(r.best_line_san), fens: replay(base, r.best_line) };
    return { base, ucis: m.best_line, tokens: numberedLine(base, lineSan(base, m.best_line)), fens: replay(base, m.best_line) };
  }, [m, mineMove, r, fens, cur]);
  const reply = useMemo(() => (r ? { base: fens[cur], ucis: r.reply_line, tokens: sanTokens(r.reply_line_san),
                                      fens: replay(fens[cur], r.reply_line) } : null), [r, fens, cur]);

  if (!m) {
    return <section className="card v-explain explain"><p>Start position. Your Win% <b className="num">{n1(myWin[0])}</b>.</p></section>;
  }
  const chips = (key: string, l: { base: string; ucis: string[]; tokens: string[]; fens: string[] }, label: string) => {
    const lineFens = l.fens;
    const playable = l.tokens.length === l.ucis.length && lineFens.length === l.ucis.length;
    return (
      <LineChips tokens={l.tokens} playable={playable} label={label} active={line?.key === `${key}:${cur}` ? line.i : null}
        onPick={(i) => setLine({ key: `${key}:${cur}`, fens: lineFens, ucis: l.ucis, tokens: l.tokens, i })} />
    );
  };
  const before = myWin[cur - 1], after = myWin[cur];
  const bestSan = r?.best_san ?? (best ? lineSan(best.base, best.ucis, 1)[0] : null);
  return (
    <section className="card v-explain explain">
      <div className="lead">
        <b className="san">{moveName(cur, m.san)}</b>
        {r && <Nag severity={r.severity} />}
        <span className="muted">
          {r ? `${SEV[r.severity]} · ${TYPE[r.primary] ?? r.primary}${r.subtype ? ` (${tagName(r.subtype)})` : ""}`
            : mineMove ? LABEL[m.label] ?? m.label : `${g.opponent}'s move · ${LABEL[m.label] ?? m.label}`}
        </span>
      </div>
      <div>
        Your Win% <b className="num">{n1(before)}</b> → <b className="num">{n1(after)}</b>
        <span className="muted num"> ({signed(after - before)})</span>
        {m.think != null && <span className="muted"> · thought {n1(m.think)}s</span>}
      </div>
      {cur === turning && (
        <div className="callout"><b>Turning point. </b>The first move in this loss that took you from 40% or more to 25% or less.</div>
      )}
      {g.thrown && cur === g.thrown.ply && (
        <div className="callout"><b>Threw away a win. </b>Your Win% had reached {n1(g.thrown.peak)}% in this game.</div>
      )}
      {r && <p>{r.explanation}</p>}
      {best && (
        <>
          <div className="label">
            Stockfish's best{bestSan ? `: ${bestSan}` : ""}{r?.best_eval ? ` (${evalFor(r.best_eval, me)})` : ""}
          </div>
          {chips("best", best, "Stockfish's best line")}
        </>
      )}
      {reply && reply.ucis.length > 0 && (
        <>
          <div className="label">After your move{r?.after_eval ? ` (${evalFor(r.after_eval, me)})` : ""}</div>
          {chips("reply", reply, "Stockfish's line after your move")}
        </>
      )}
      {r && r.flags.length > 0 && (
        <div className="chips">{r.flags.map((f) => <span key={f} className="pill">{FLAG[f] ?? f}</span>)}</div>
      )}
    </section>
  );
}

function LivePanel({ live, explore, me, over, onPlay, onUndo, onClose }: {
  live: LiveState; explore: Explore; me: Side; over: string | null;
  onPlay: (uci: string) => void; onUndo: () => void; onClose: () => void;
}) {
  const fen = explore.moves.at(-1)?.fen ?? explore.base;
  const played = numberedLine(explore.base, explore.moves.map((x) => x.san));
  return (
    <section className="card v-explain live-panel" aria-live="polite">
      <div className="card-head">
        <h2><span className="live-badge">LIVE</span> Explore</h2>
        <span className="muted small">{live.engine}{live.depth ? ` · depth ${live.depth}` : ""}</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Play any move on the board, for either side. The in-browser Stockfish shows its top lines, scored from your side. Live
        results are never saved.
      </p>
      <div className="chips">
        <span className="muted small">From {explore.from}:</span>
        {played.length ? played.map((t, i) => <span key={i} className="pill san">{t}</span>) : <span className="muted small">no moves yet</span>}
      </div>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={onUndo} disabled={!explore.moves.length}>Take back</button>
        <button type="button" className="btn ghost" onClick={onClose}>Back to the game</button>
      </div>
      {over ? (
        <p><b>{over}.</b></p>
      ) : live.status === "error" ? (
        <p>{live.error}</p>
      ) : live.status === "loading" ? (
        <p className="muted">Starting the engine…</p>
      ) : (
        <div className="live-lines">
          {live.lines.map((l) => {
            const sans = numberedLine(fen, lineSan(fen, l.pv, 10));
            return (
              <button key={l.multipv} type="button" className="live-line" onClick={() => onPlay(l.pv[0])}
                title={`Play ${sans[0] ?? ""}`}>
                <b>{evalFor(l.eval, me)}</b><span>{sans.join(" ")}</span>
              </button>
            );
          })}
          {!live.lines.length && <p className="muted">Thinking…</p>}
        </div>
      )}
      {live.nps != null && live.status !== "loading" && (
        <div className="muted small num">{grouped(live.nps / 1000)}k positions a second</div>
      )}
    </section>
  );
}

const MoveCell = memo(function MoveCell({ m, r, mine, turning, current, onPick }: {
  m: Move; r?: MistakeRecord; mine: boolean; turning: boolean; current: boolean; onPick: (ply: number) => void;
}) {
  return (
    <button type="button" data-ply={m.ply} onClick={() => onPick(m.ply)} aria-current={current ? "step" : undefined}
      className={`mv${mine ? " mine" : ""}${turning ? " turn" : ""}${current ? " cur" : ""}`}
      title={r ? `${SEV[r.severity]} · ${TYPE[r.primary] ?? r.primary}` : LABEL[m.label]}>
      <span>{m.san}</span>
      {r && <Nag severity={r.severity} />}
      {r && SHORT[r.primary] && <span className="tag">{SHORT[r.primary]}</span>}
    </button>
  );
});

function MoveList({ moves, recAt, me, turning, cur, onPick }: {
  moves: Move[]; recAt: Map<number, MistakeRecord>; me: Side; turning: number | null; cur: number; onPick: (ply: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = ref.current, el = list?.querySelector<HTMLElement>(".mv.cur");
    if (list && el) list.scrollTop = Math.max(0, el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2);
  }, [cur]);
  const rows: ReactNode[] = [];
  const firstBlack = moves[0]?.side === "black";
  for (let i = firstBlack ? -1 : 0; i < moves.length; i += 2) {
    const w = moves[i], b = moves[i + 1];
    const no = Math.ceil(((w ?? b).ply) / 2);
    rows.push(<span key={`n${i}`} className="no">{no}.</span>);
    for (const x of [w, b]) {
      rows.push(x ? (
        <MoveCell key={x.ply} m={x} r={recAt.get(x.ply)} mine={x.side === me} turning={x.ply === turning} current={x.ply === cur} onPick={onPick} />
      ) : <span key={`e${i}${x === w ? "w" : "b"}`} />);
    }
  }
  return <div className="moves" ref={ref}>{rows}</div>;
}
