import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router";
import { Board, type ArrowKind, type HighlightKind } from "../components/Board";
import { EvalBar, type BarValue } from "../components/EvalBar";
import { EvalChart, ThinkChart, type ThinkBar } from "../components/charts";
import { LineChips, Nag } from "../components/bits";
import { useGame } from "../lib/data";
import { clock, dateTime, evalFor, grouped, moveName, n1, plural, sanTokens, signed, timeControl } from "../lib/format";
import { gameOver, lineSan, numberedLine, outcome, posKey, replay, sideToMove, targets, tryMove, uciParts, type Side } from "../lib/chess";
import { useLiveEngine, type LiveState } from "../lib/engine";
import { winOf, winOfOutcome } from "../lib/winpct";
import { FLAG, LABEL, RESULT_WORD, SEV, SEVERITIES, SHORT, TYPE, tagName } from "../lib/names";
import type { Game, Move, Record as MistakeRecord } from "../types/export";

export default function GameViewerRoute() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const ply = params.get("ply");
  const compare = params.get("compare") === "1";
  const pos = params.get("pos");   // a position key: open at the first move that reaches it
  return (
    <GameViewer key={`${id}:${ply ?? ""}:${compare}:${pos ?? ""}`} id={id} startCompare={compare} startPos={pos}
      startPly={ply != null && /^\d+$/.test(ply) ? Number(ply) : null} />
  );
}

type ExploreMove = { uci: string; san: string; fen: string };
/** Moves played in Explore from `base`. The first `at` are on the board; the rest can be stepped forward again. */
type Explore = { base: string; from: string; moves: ExploreMove[]; at: number };
/** One side of a comparison: moves from the position before my move, their positions, and Stockfish's
    stored score for the line. */
type CmpLine = { ucis: string[]; tokens: string[]; fens: string[]; bar: BarValue };
type Cmp = { base: string; you: CmpLine; best: CmpLine; steps: number };

/** The stored score for the position after `ply` plies. The start position has only its Win%. */
function storedBar(g: Game, fens: string[], ply: number): BarValue {
  if (ply === 0) return { win: g.start_win };
  const mv = g.moves[ply - 1];
  return { win: mv.win, ev: mv.eval, outcome: mv.eval ? null : outcome(fens[ply]) };
}

/** My move at `ply` next to Stockfish's best from the same position, or null when there's nothing to compare
    (not my move, or it was the best move). My side continues with Stockfish's line after my move: the
    record's deeper line if there is one, else the stored line for the next position. */
function compareAt(g: Game, fens: string[], me: Side, ply: number, r: MistakeRecord | undefined): Cmp | null {
  const m = g.moves[ply - 1];
  if (!m || m.side !== me || ply >= fens.length) return null;
  const base = fens[ply - 1], after = fens[ply];
  const deep = !!r?.best_line.length;
  const bestUcis = deep ? r!.best_line : m.best_line;
  if (!bestUcis.length || bestUcis[0] === m.uci || (!r && (m.label === "best" || m.label === "book"))) return null;
  const reply = r ? r.reply_line : g.moves[ply]?.best_line ?? [];
  const you: CmpLine = {
    ucis: [m.uci, ...reply],
    tokens: [moveName(ply, m.san), ...(r ? sanTokens(r.reply_line_san) : numberedLine(after, lineSan(after, reply)))],
    fens: replay(base, [m.uci, ...reply]),
    bar: r?.after_eval ? { win: winOf(r.after_eval), ev: r.after_eval }
      : r?.after_terminal ? { win: winOfOutcome(r.after_terminal), outcome: r.after_terminal } : storedBar(g, fens, ply),
  };
  const best: CmpLine = {
    ucis: bestUcis,
    tokens: deep ? sanTokens(r!.best_line_san) : numberedLine(base, lineSan(base, bestUcis)),
    fens: replay(base, bestUcis),
    bar: r?.best_eval ? { win: winOf(r.best_eval), ev: r.best_eval } : storedBar(g, fens, ply - 1),
  };
  return { base, you, best, steps: Math.max(you.fens.length, best.fens.length) };
}

const RESULT_SCORE = { white: "1–0", black: "0–1", draw: "½–½" } as const;
const scoreText = (b: BarValue, me: Side) => (b.outcome ? RESULT_SCORE[b.outcome] : b.ev ? evalFor(b.ev, me) : "");

const NAV = {
  game: ["First move (Home)", "Previous move (←)", "Next move (→)", "Last move (End)"],
  compare: ["Before the move (Home)", "Back a move in both lines (←)", "Forward a move in both lines (→)", "End of the lines (End)"],
  explore: ["Take back every move (Home)", "Take back a move (←)", "Play the next move again (→)", "Play every move again (End)"],
};

function GameViewer({ id, startPly, startCompare, startPos }: {
  id: string; startPly: number | null; startCompare: boolean; startPos: string | null;
}) {
  const g = useGame(id);
  const me = g.colour, opp: Side = me === "white" ? "black" : "white";
  const fens = useMemo(() => [g.initial_fen, ...replay(g.initial_fen, g.moves.map((m) => m.uci))], [g]);
  const n = fens.length - 1;   // = g.moves.length unless the export's moves stop replaying
  const recAt = useMemo(() => new Map(g.records.map((r) => [r.ply, r])), [g]);
  const myWin = useMemo(() => [g.start_win, ...g.moves.slice(0, n).map((m) => m.win)].map((w) => (me === "black" ? 100 - w : w)), [g, me, n]);
  const labels = useMemo(() => ["start", ...g.moves.map((m) => moveName(m.ply, m.san))], [g]);
  const turning = g.loss?.turning_ply ?? null;
  // My mistakes that have a line to compare, in game order, for "previous / next mistake".
  const mistakes = useMemo(() => g.records.map((x) => x.ply).filter((p) => compareAt(g, fens, me, p, recAt.get(p))).sort((a, b) => a - b),
    [g, fens, me, recAt]);

  const clamp = useCallback((k: number) => Math.max(0, Math.min(n, k)), [n]);
  const [cur, setCur] = useState(() => {
    const at = startPos ? fens.findIndex((f) => posKey(f) === startPos) : -1;
    return clamp(at >= 0 ? at : startPly ?? turning ?? 0);
  });
  const [flip, setFlip] = useState(false);
  const [compare, setCompare] = useState<number | null>(startCompare ? 0 : null);   // step through both lines
  const [show, setShow] = useState<"you" | "best">("you");                         // the board shown on a phone
  const [explore, setExplore] = useState<Explore | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const go = useCallback((k: number) => {
    setCur(clamp(k));
    setCompare(null);
    setExplore(null);
    setSelected(null);
  }, [clamp]);
  const openCompare = useCallback((ply: number, step = 0) => {
    setCur(ply);
    setCompare(step);
    setExplore(null);
    setSelected(null);
  }, []);

  const m: Move | undefined = cur ? g.moves[cur - 1] : undefined;
  const r = recAt.get(cur);
  const mine = m?.side === me;
  const cmp = useMemo(() => compareAt(g, fens, me, cur, recAt.get(cur)), [g, fens, me, cur, recAt]);
  const comparing = compare != null && cmp != null;
  const gameFen = fens[cur];
  const exploreFen = explore ? (explore.at ? explore.moves[explore.at - 1].fen : explore.base) : null;
  const shownFen = exploreFen ?? gameFen;
  const over = exploreFen ? gameOver(exploreFen) : null;
  const live = useLiveEngine(exploreFen && !over ? exploreFen : null);
  const liveLines = live.fen === exploreFen ? live.lines : [];

  // ◀ ▶ ⏮ ⏭ and the arrow keys move through whatever the board shows: the game, the two lines being compared,
  // or the moves played in Explore.
  const mode = explore ? "explore" : comparing ? "compare" : "game";
  const at = explore ? explore.at : comparing ? compare : cur;
  const end = explore ? explore.moves.length : comparing ? cmp.steps : n;
  const navTo = (f: (at: number, end: number) => number) => {
    if (explore) setExplore((x) => x && { ...x, at: Math.max(0, Math.min(x.moves.length, f(x.at, x.moves.length))) });
    else if (comparing) setCompare((s) => (s == null ? s : Math.max(0, Math.min(cmp.steps, f(s, cmp.steps)))));
    else { setCur((c) => clamp(f(c, n))); setSelected(null); }
  };
  const leave = () => { setExplore(null); setCompare(null); setSelected(null); };

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.("input, select, textarea")) return;
    if (e.key === "ArrowLeft") navTo((a) => a - 1);
    else if (e.key === "ArrowRight") navTo((a) => a + 1);
    else if (e.key === "Home") navTo(() => 0);
    else if (e.key === "End") navTo((_, e) => e);
    else if (e.key === "f" || e.key === "F") setFlip((f) => !f);
    else if (e.key === "Escape" && mode !== "game") leave();
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Playing a move on the board starts Explore; playing the move that was taken back steps forward again.
  const play = useCallback((from: string, to: string, promotion?: string) => {
    const mv = tryMove(shownFen, from, to, promotion);
    if (!mv) return false;
    setExplore((x) => {
      if (!x) return { base: gameFen, from: labels[cur], moves: [mv], at: 1 };
      if (x.moves[x.at]?.uci === mv.uci) return { ...x, at: x.at + 1 };
      return { ...x, moves: [...x.moves.slice(0, x.at), mv], at: x.at + 1 };
    });
    setSelected(null);
    return true;
  }, [shownFen, gameFen, labels, cur]);

  const dots = useMemo(() => (selected ? targets(shownFen, selected) : []), [selected, shownFen]);
  const onSquare = (square: string) => {
    if (selected && dots.includes(square)) { play(selected, square); return; }
    setSelected(targets(shownFen, square).length ? square : null);
  };

  // What the board shows.
  let arrows: { uci: string; kind: ArrowKind }[] = [];
  let highlight: { uci: string; kind: HighlightKind } | null = null;
  if (explore) {
    if (explore.at) highlight = { uci: explore.moves[explore.at - 1].uci, kind: "them" };
    if (liveLines[0]) arrows = [{ uci: liveLines[0].pv[0], kind: "live" }];
  } else if (m) {
    highlight = { uci: m.uci, kind: mine ? "you" : "them" };
    if (mine) arrows = cmp ? [{ uci: cmp.best.ucis[0], kind: "best" }, { uci: m.uci, kind: "you" }] : [{ uci: m.uci, kind: "you" }];
  }
  const orientation: Side = flip ? opp : me;
  const toMove = sideToMove(shownFen);

  // The eval bar: the stored score for game positions, the live engine's in Explore (until it answers, the
  // stored one for the position Explore started from).
  const exploreOutcome = exploreFen && over ? outcome(exploreFen) : null;
  const bar: BarValue = !explore ? storedBar(g, fens, cur)
    : exploreOutcome ? { win: winOfOutcome(exploreOutcome), outcome: exploreOutcome }
    : liveLines[0] ? { win: winOf(liveLines[0].eval), ev: liveLines[0].eval }
    : explore.at === 0 ? storedBar(g, fens, cur) : { win: null };
  const barLive = !!explore && !exploreOutcome && !!liveLines[0];

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
    <span><span className="live-badge">LIVE</span> <b>Explore</b> · {explore.at ? `${explore.at} from ${explore.from}` : `from ${explore.from}`}</span>
  ) : m ? (
    <span>After <b className="san">{moveName(cur, m.san)}</b> · {cur} of {n}</span>
  ) : <span>Start position</span>;

  const [first, prev, next, last] = NAV[mode];
  const navbtns = (
    <div className="navbtns">
      <button type="button" title={first} aria-label={first} disabled={at === 0} onClick={() => navTo(() => 0)}>⏮</button>
      <button type="button" title={prev} aria-label={prev} disabled={at === 0} onClick={() => navTo((a) => a - 1)}>◀</button>
      <button type="button" title={next} aria-label={next} disabled={at === end} onClick={() => navTo((a) => a + 1)}>▶</button>
      <button type="button" title={last} aria-label={last} disabled={at === end} onClick={() => navTo((_, e) => e)}>⏭</button>
      <button type="button" title="Flip the board (F)" aria-label="Flip the board" onClick={() => setFlip((f) => !f)}>⇅</button>
      {mode === "compare" ? (
        <button type="button" className="leave" title="Back to the game (Esc)" onClick={leave}>Back to the game</button>
      ) : (
        <button type="button" className="live" aria-pressed={!!explore}
          title={explore ? "Back to the game (Esc)" : "Play any move here; the in-browser Stockfish evaluates it live, never saved"}
          onClick={() => (explore ? leave() : setExplore({ base: gameFen, from: labels[cur], moves: [], at: 0 }))}>
          {explore ? "Leave explore" : "Explore · live"}
        </button>
      )}
    </div>
  );

  return (
    <>
      <GameHead g={g} me={me} opp={opp} onTurning={turning != null ? () => go(turning) : undefined} broken={n < g.moves.length ? n : null} />
      <div className={`viewer${comparing ? " comparing" : ""}`}>
        <div className="colA">
          {comparing ? (
            <Compare id={`game-${g.id}`} cur={cur} m={m!} r={r} cmp={cmp} step={compare} setStep={setCompare} me={me}
              orientation={orientation} show={show} setShow={setShow} mistakes={mistakes} onMistake={(p) => openCompare(p)}>
              {navbtns}
            </Compare>
          ) : (
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
              <div className="board-row">
                <EvalBar value={bar} orientation={orientation} me={me} live={barLive}
                  note={barLive ? `live, depth ${live.depth}` : undefined} />
                <Board id={`game-${g.id}`} fen={shownFen} orientation={orientation} arrows={arrows} highlight={highlight}
                  selected={selected} dots={dots} onDrop={(from, to) => play(from, to)} onSquare={onSquare}
                  label={explore ? "Explore board: play any move" : m ? `Position after ${moveName(cur, m.san)}` : "Start position"} />
              </div>
              {strip(orientation)}
              {navbtns}
            </div>
          )}
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
            <LivePanel live={live} lines={liveLines} explore={explore} me={me} over={over}
              onPlay={(uci) => { const p = uciParts(uci); play(p.from, p.to, p.promotion); }}
              onAt={(k) => navTo(() => k)} onClose={leave} />
          ) : (
            <Explain g={g} me={me} cur={cur} m={m} r={r} myWin={myWin} turning={turning} cmp={cmp} comparing={comparing}
              onCompare={(step) => openCompare(cur, step)} />
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

/** My move and Stockfish's best on two boards, stepped together. Side by side when there's room, otherwise
    one board at a time with a switch. */
function Compare({ id, cur, m, r, cmp, step, setStep, me, orientation, show, setShow, mistakes, onMistake, children }: {
  id: string; cur: number; m: Move; r?: MistakeRecord; cmp: Cmp; step: number; setStep: (k: number) => void; me: Side;
  orientation: Side; show: "you" | "best"; setShow: (s: "you" | "best") => void; mistakes: number[];
  onMistake: (ply: number) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: "nearest" }); }, [cur]);
  const i = mistakes.indexOf(cur);
  const prev = mistakes.filter((p) => p < cur).at(-1), next = mistakes.find((p) => p > cur);
  const side = (key: "you" | "best") => {
    const l = cmp[key];
    const k = Math.min(step, l.fens.length);
    const fen = k ? l.fens[k - 1] : cmp.base;
    const name = key === "you" ? "Your move" : "Stockfish's best";
    return (
      <div className={`cmp-side cmp-${key}`}>
        <div className="cmp-cap">
          <span className="label">{name}</span>
          <b className="san">{l.tokens[0]}</b>
          {key === "you" && r && <Nag severity={r.severity} />}
          <span className="num">{scoreText(l.bar, me)}</span>
        </div>
        <div className="board-row">
          <EvalBar value={l.bar} orientation={orientation} me={me}
            note={key === "you" ? "Stockfish's score after your move" : "Stockfish's score with its best move"} />
          <Board id={`${id}-${key}`} fen={fen} orientation={orientation}
            arrows={k === 0 ? [{ uci: l.ucis[0], kind: key }] : []} highlight={k ? { uci: l.ucis[k - 1], kind: key } : null}
            label={k ? `${name} line after ${l.tokens[k - 1]}` : `Before ${moveName(cur, m.san)}: ${name.toLowerCase()} ${l.tokens[0]}`} />
        </div>
        <LineChips tokens={l.tokens} playable={l.fens.length === l.tokens.length} active={k ? k - 1 : null}
          onPick={(j) => setStep(j + 1)} label={key === "you" ? "Your move, then Stockfish's line" : "Stockfish's best line"} />
        {step > l.fens.length && <span className="muted small">This line ends here.</span>}
      </div>
    );
  };
  return (
    <section ref={ref} className="v-board cmp" data-show={show} aria-label={`${moveName(cur, m.san)} compared with Stockfish's best`}>
      <div className="cmp-head">
        <span>
          <b className="san">{moveName(cur, m.san)}</b> against Stockfish's best ·{" "}
          <span className="num">{step === 0 ? "before the move" : `move ${step} of ${cmp.steps}`}</span>
        </span>
        {mistakes.length > 0 && (
          <span className="cmp-mistakes">
            <button type="button" className="btn ghost" disabled={prev == null} onClick={() => prev != null && onMistake(prev)}
              title="Your previous mistake in this game">‹ Previous</button>
            <span className="muted small num">{i >= 0 ? `mistake ${i + 1} of ${mistakes.length}` : plural(mistakes.length, "mistake")}</span>
            <button type="button" className="btn ghost" disabled={next == null} onClick={() => next != null && onMistake(next)}
              title="Your next mistake in this game">Next ›</button>
          </span>
        )}
      </div>
      <div className="seg cmp-pick" role="group" aria-label="Board shown">
        {(["you", "best"] as const).map((key) => (
          <button key={key} type="button" aria-pressed={show === key} onClick={() => setShow(key)}>
            {key === "you" ? "You" : "Stockfish"} <span className="san">{cmp[key].tokens[0]}</span>{" "}
            <span className="num">{scoreText(cmp[key].bar, me)}</span>
          </button>
        ))}
      </div>
      <div className="cmp-boards">{side("you")}{side("best")}</div>
      {children}
    </section>
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

function Explain({ g, me, cur, m, r, myWin, turning, cmp, comparing, onCompare }: {
  g: Game; me: Side; cur: number; m?: Move; r?: MistakeRecord; myWin: number[]; turning: number | null; cmp: Cmp | null;
  comparing: boolean; onCompare: (step: number) => void;
}) {
  if (!m) {
    return <section className="card v-explain explain"><p>Start position. Your Win% <b className="num">{n1(myWin[0])}</b>.</p></section>;
  }
  const mineMove = m.side === me;
  const before = myWin[cur - 1], after = myWin[cur];
  const bestSan = cmp ? r?.best_san ?? lineSan(cmp.base, cmp.best.ucis, 1)[0] : null;
  const bestScore = cmp ? scoreText(cmp.best.bar, me) : "", afterScore = cmp ? scoreText(cmp.you.bar, me) : "";
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
      {cmp && !comparing && (
        <>
          <div className="label">Stockfish's best{bestSan ? `: ${bestSan}` : ""}{bestScore ? ` (${bestScore})` : ""}</div>
          <LineChips tokens={cmp.best.tokens} playable={cmp.best.fens.length === cmp.best.tokens.length} active={null}
            onPick={(i) => onCompare(i + 1)} label="Stockfish's best line" />
          {cmp.you.tokens.length > 1 && (
            <>
              <div className="label">After your move{afterScore ? ` (${afterScore})` : ""}</div>
              <LineChips tokens={cmp.you.tokens.slice(1)} playable={cmp.you.fens.length === cmp.you.tokens.length} active={null}
                onPick={(i) => onCompare(i + 2)} label="Stockfish's line after your move" />
            </>
          )}
          <div className="actions">
            <button type="button" className="btn" onClick={() => onCompare(0)}>Compare side by side</button>
          </div>
        </>
      )}
      {r && r.flags.length > 0 && (
        <div className="chips">{r.flags.map((f) => <span key={f} className="pill">{FLAG[f] ?? f}</span>)}</div>
      )}
    </section>
  );
}

function LivePanel({ live, lines, explore, me, over, onPlay, onAt, onClose }: {
  live: LiveState; lines: LiveState["lines"]; explore: Explore; me: Side; over: string | null;
  onPlay: (uci: string) => void; onAt: (at: number) => void; onClose: () => void;
}) {
  const fen = explore.at ? explore.moves[explore.at - 1].fen : explore.base;
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
      <div className="chips played" role="group" aria-label="Moves played in Explore">
        <span className="muted small">From {explore.from}:</span>
        {played.length ? played.map((t, i) => (
          <button key={i} type="button" className={`san${i >= explore.at ? " redo" : ""}`} aria-pressed={i === explore.at - 1}
            onClick={() => onAt(i + 1)}>{t}</button>
        )) : <span className="muted small">no moves yet</span>}
      </div>
      <div className="actions">
        <button type="button" className="btn ghost" onClick={() => onAt(explore.at - 1)} disabled={!explore.at}>Take back</button>
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
          {lines.map((l) => {
            const sans = numberedLine(fen, lineSan(fen, l.pv, 10));
            return (
              <button key={l.multipv} type="button" className="live-line" onClick={() => onPlay(l.pv[0])}
                title={`Play ${sans[0] ?? ""}`}>
                <b>{evalFor(l.eval, me)}</b><span>{sans.join(" ")}</span>
              </button>
            );
          })}
          {!lines.length && <p className="muted">Thinking…</p>}
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
