import { memo, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Board, type ArrowKind, type HighlightKind, type Peek } from "../components/Board";
import { EvalBar, type BarValue } from "../components/EvalBar";
import { EvalChart, ThinkChart, type ThinkBar } from "../components/charts";
import { LineChips, Nag } from "../components/bits";
import { RefText, usePeek, type PeekControl } from "../components/RefText";
import { resignedId, thrownId, WINNING } from "../lib/playout";
import { useGame, useSummary } from "../lib/data";
import { useBot } from "../lib/bot";
import { clock, dateTime, evalFor, grouped, moveName, n1, plural, sanTokens, signed, timeControl } from "../lib/format";
import { gameOver, lineSan, moveBetween, numberedLine, outcome, passTurn, posKey, replay, sideToMove, targets, tryMove, uciParts, type Side } from "../lib/chess";
import { bestKinds, myKinds, theirKinds, type RefLine } from "../lib/refs";
import { useLiveEngine, type LiveLine, type LiveState } from "../lib/engine";
import { winOf, winOfOutcome } from "../lib/winpct";
import { FLAG, LABEL, RESULT_WORD, SEV, SEVERITIES, SHORT, TYPE, tagName } from "../lib/names";
import type { Game, Move, Record as MistakeRecord, Summary } from "../types/export";

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

/** A move played on a board (Explore, or Play on from a Compare board): mine, or the bot's answer (`by`, with
    Maia-2's share for the move it chose). */
type PlayMove = { uci: string; san: string; fen: string; by?: string; p?: number };
/** Moves played in Explore from `base`. The first `at` are on the board; the rest can be stepped forward again. */
type Explore = { base: string; from: string; moves: PlayMove[]; at: number };
/** One side of a comparison: moves from the position before my move, their positions, and Stockfish's
    stored score for the line. */
type CmpLine = { ucis: string[]; tokens: string[]; fens: string[]; bar: BarValue };
type Cmp = { base: string; you: CmpLine; best: CmpLine; steps: number };
type CmpKey = "you" | "best";
/** Play on: moves played on a Compare board from step `from` of its line. The first `at` are on the board. */
type Branch = { from: number; moves: PlayMove[]; at: number };
type Branches = Partial<Record<CmpKey, Branch>>;
const lineFen = (cmp: Cmp, key: CmpKey, k: number) => (k ? cmp[key].fens[k - 1] : cmp.base);
const branchFen = (cmp: Cmp, key: CmpKey, b: Branch) => (b.at ? b.moves[b.at - 1].fen : lineFen(cmp, key, b.from));

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

/** Why there's nothing to compare at a move (compareAt gave null), for the greyed-out Compare button. */
function noCompare(m: Move | undefined, me: Side, opponent: string) {
  if (!m) return "Compare puts one of your moves next to Stockfish's best: step to one of your moves.";
  if (m.side !== me) return `${opponent}'s move. Compare puts your moves next to Stockfish's best.`;
  if (m.label === "book") return "A book move: nothing to compare.";
  if (!m.best_line.length) return "No Stockfish line is stored for this move.";
  return "You played Stockfish's best move here: nothing to compare.";
}

const RESULT_SCORE = { white: "1–0", black: "0–1", draw: "½–½" } as const;
const scoreText = (b: BarValue, me: Side) => (b.outcome ? RESULT_SCORE[b.outcome] : b.ev ? evalFor(b.ev, me) : "");

const NAV = {
  game: ["First move (Home)", "Previous move (←)", "Next move (→)", "Last move (End)"],
  compare: ["Before the move (Home)", "Back a move in both lines (←)", "Forward a move in both lines (→)", "End of the lines (End)"],
  explore: ["Take back every move (Home)", "Take back a move (←)", "Play the next move again (→)", "Play every move again (End)"],
  play: ["Back to where you started playing (Home)", "Take back a move (←)", "Play the next move again (→)", "Play every move again (End)"],
};

function GameViewer({ id, startPly, startCompare, startPos }: {
  id: string; startPly: number | null; startCompare: boolean; startPos: string | null;
}) {
  const g = useGame(id);
  const summary = useSummary();
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
  const [threat, setThreat] = useState(false);   // the live engine's move for the side not to move
  const [branches, setBranches] = useState<Branches>({});   // Play on, per Compare board
  const [active, setActive] = useState<CmpKey>("you");      // the board played on last
  const [cmpSel, setCmpSel] = useState<{ key: CmpKey; square: string } | null>(null);
  const [botBusy, setBotBusy] = useState(false);
  const [botError, setBotError] = useState<string | null>(null);
  const [why, setWhy] = useState(false);   // the greyed-out Compare button was tapped: say why, until the next step
  const bot = useBot(summary.bots);
  const botReq = useRef(0);   // the latest request: answers to older ones are dropped
  const stopPlaying = useCallback(() => {
    botReq.current++;
    setBotBusy(false);
    setBranches({});
    setCmpSel(null);
  }, []);

  const go = useCallback((k: number) => {
    setCur(clamp(k));
    setCompare(null);
    setExplore(null);
    setSelected(null);
    setWhy(false);
    stopPlaying();
  }, [clamp, stopPlaying]);
  const openCompare = useCallback((ply: number, step = 0) => {
    setCur(ply);
    setCompare(step);
    setExplore(null);
    setSelected(null);
    stopPlaying();
  }, [stopPlaying]);

  const m: Move | undefined = cur ? g.moves[cur - 1] : undefined;
  const r = recAt.get(cur);
  const mine = m?.side === me;
  const cmp = useMemo(() => compareAt(g, fens, me, cur, recAt.get(cur)), [g, fens, me, cur, recAt]);
  const comparing = compare != null && cmp != null;
  const gameFen = fens[cur];
  const exploreFen = explore ? (explore.at ? explore.moves[explore.at - 1].fen : explore.base) : null;
  const shownFen = exploreFen ?? gameFen;
  const over = exploreFen ? gameOver(exploreFen) : null;
  const threatFen = threat && !explore && !comparing ? passTurn(gameFen) : null;
  const branch = comparing ? branches[active] : undefined;
  const playFen = branch ? branchFen(cmp!, active, branch) : null;
  const playOver = playFen ? gameOver(playFen) : null;
  const live = useLiveEngine(exploreFen && !over ? exploreFen : playFen && !playOver ? playFen : threatFen);
  const liveLines = live.fen === exploreFen ? live.lines : [];
  const threatLine = threatFen && live.fen === threatFen ? live.lines[0] ?? null : null;

  // ◀ ▶ ⏮ ⏭ and the arrow keys move through whatever the board shows: the game, the two lines being compared,
  // or the moves played in Explore.
  const mode = explore ? "explore" : branch ? "play" : comparing ? "compare" : "game";
  if (why && mode !== "game") setWhy(false);
  const at = explore ? explore.at : branch ? branch.at : comparing ? compare : cur;
  const end = explore ? explore.moves.length : branch ? branch.moves.length : comparing ? cmp.steps : n;
  const navTo = (f: (at: number, end: number) => number) => {
    if (explore) setExplore((x) => x && { ...x, at: Math.max(0, Math.min(x.moves.length, f(x.at, x.moves.length))) });
    else if (branch) setBranches((bs) => {
      const b = bs[active];
      return b ? { ...bs, [active]: { ...b, at: Math.max(0, Math.min(b.moves.length, f(b.at, b.moves.length))) } } : bs;
    });
    else if (comparing) setCompare((s) => (s == null ? s : Math.max(0, Math.min(cmp.steps, f(s, cmp.steps)))));
    else { setCur((c) => clamp(f(c, n))); setSelected(null); setWhy(false); }
  };
  const leave = () => { setExplore(null); setCompare(null); setSelected(null); stopPlaying(); };
  const tryCompare = () => (cmp ? openCompare(cur) : setWhy(true));

  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest?.("input, select, textarea")) return;
    if (e.key === "ArrowLeft") navTo((a) => a - 1);
    else if (e.key === "ArrowRight") navTo((a) => a + 1);
    else if (e.key === "Home") navTo(() => 0);
    else if (e.key === "End") navTo((_, e) => e);
    else if (e.key === "f" || e.key === "F") setFlip((f) => !f);
    else if ((e.key === "x" || e.key === "X") && mode === "game") setThreat((t) => !t);
    else if ((e.key === "c" || e.key === "C") && mode === "game") tryCompare();
    else if (e.key === "Escape" && mode === "play") stopPlaying();
    else if (e.key === "Escape" && mode !== "game") leave();
    else return;
    e.preventDefault();
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKey(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // The chosen bot answers a move just played (`line`, now ending at `fen`): its move goes on the end of the
  // line, through `set`, if the line still ends there when it arrives. A move played again (stepping forward
  // along moves already played) already has its answer after it, so nobody is asked.
  const answer = <L extends { moves: PlayMove[]; at: number }>(line: L, fen: string, set: (f: (x: L | undefined) => L | undefined) => void) => {
    setBotError(null);
    const id = ++botReq.current;
    if (bot.choice === "off" || gameOver(fen) || line.at < line.moves.length) { setBotBusy(false); return; }
    setBotBusy(true);
    bot.move(fen).then((reply) => {
      if (id !== botReq.current) return;
      setBotBusy(false);
      const p = reply && uciParts(reply.uci);
      const bm = p && tryMove(fen, p.from, p.to, p.promotion);
      if (!reply || !bm) return;
      set((x) => (x && x.at === x.moves.length && x.moves[x.at - 1]?.fen === fen
        ? { ...x, moves: [...x.moves, { ...bm, by: reply.by, p: reply.p }], at: x.at + 1 } : x));
    }, (err: unknown) => {
      if (id !== botReq.current) return;
      setBotBusy(false);
      setBotError(err instanceof Error ? err.message : String(err));
    });
  };

  // Playing a move on the board starts Explore; playing the move that was taken back steps forward again.
  const play = (from: string, to: string, promotion?: string) => {
    const mv = tryMove(shownFen, from, to, promotion);
    if (!mv) return false;
    const x = explore;
    const next: Explore = !x ? { base: gameFen, from: labels[cur], moves: [mv], at: 1 }
      : x.moves[x.at]?.uci === mv.uci ? { ...x, at: x.at + 1 }
      : { ...x, moves: [...x.moves.slice(0, x.at), mv], at: x.at + 1 };
    setExplore(next);
    setSelected(null);
    answer(next, mv.fen, (f) => setExplore((e) => f(e ?? undefined) ?? null));
    return true;
  };

  // Play on: a move on a Compare board starts (or continues) that board's own line, and the chosen bot answers.
  const playOn = (key: CmpKey, from: string, to: string, promotion?: string) => {
    if (!cmp) return false;
    const b = branches[key];
    const k = b ? b.from : Math.min(compare ?? 0, cmp[key].fens.length);
    const mv = tryMove(b ? branchFen(cmp, key, b) : lineFen(cmp, key, k), from, to, promotion);
    if (!mv) return false;
    const next: Branch = !b ? { from: k, moves: [mv], at: 1 }
      : b.moves[b.at]?.uci === mv.uci ? { ...b, at: b.at + 1 }
      : { ...b, moves: [...b.moves.slice(0, b.at), mv], at: b.at + 1 };
    setBranches((bs) => ({ ...bs, [key]: next }));
    setActive(key);
    setCmpSel(null);
    answer(next, mv.fen, (f) => setBranches((bs) => {
      const y = f(bs[key]);
      return y && y !== bs[key] ? { ...bs, [key]: y } : bs;
    }));
    return true;
  };

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
  if (threatLine) arrows = [...arrows, { uci: threatLine.pv[0], kind: "live" }];
  const peek = usePeek(`${cur}:${mode}`);
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

  const explorePlayed = useMemo(() => (explore ? numberedLine(explore.base, explore.moves.map((x) => x.san)) : []), [explore]);
  const lastBot = explore?.at && explore.moves[explore.at - 1].by ? explore.moves[explore.at - 1] : null;

  const caption = explore ? (
    <span><span className="live-badge">LIVE</span> <b>Explore</b> · {explore.at ? `${explore.at} from ${explore.from}` : `from ${explore.from}`}</span>
  ) : m ? (
    <span>After <b className="san">{moveName(cur, m.san)}</b> · {cur} of {n}</span>
  ) : <span>Start position</span>;

  const [first, prev, next, last] = NAV[mode];
  const navbtns = (
    <div className={`navbtns viewer-nav ${mode}`}>
      <button type="button" title={first} aria-label={first} disabled={at === 0} onClick={() => navTo(() => 0)}>⏮</button>
      <button type="button" title={prev} aria-label={prev} disabled={at === 0} onClick={() => navTo((a) => a - 1)}>◀</button>
      <button type="button" title={next} aria-label={next} disabled={at === end} onClick={() => navTo((a) => a + 1)}>▶</button>
      <button type="button" title={last} aria-label={last} disabled={at === end} onClick={() => navTo((_, e) => e)}>⏭</button>
      <button type="button" title="Flip the board (F)" aria-label="Flip the board" onClick={() => setFlip((f) => !f)}>⇅</button>
      {mode === "game" && (
        <button type="button" className="threat" aria-pressed={threat} disabled={!threat && !passTurn(gameFen)}
          title={passTurn(gameFen) ? "What the other side would play if it were their move: the in-browser Stockfish, live, never saved (X)"
            : "No threat to show while the side to move is in check"}
          onClick={() => setThreat((t) => !t)}>Threat</button>
      )}
      {mode === "game" && (
        // Greyed out, not disabled, where there's nothing to compare: tapping it says why.
        <button type="button" className="compare" aria-disabled={!cmp}
          title={cmp ? "Your move next to Stockfish's best, on two boards; play on from either (C)" : noCompare(m, me, g.opponent)}
          onClick={tryCompare}>Compare</button>
      )}
      {mode === "compare" || mode === "play" ? (
        <button type="button" className="leave" title="Back to the game (Esc)" onClick={leave}>Back to the game</button>
      ) : (
        <button type="button" className="live" aria-pressed={!!explore}
          title={explore ? "Back to the game (Esc)"
            : "Play any move here, against a bot or for both sides; the in-browser Stockfish scores it live, never saved"}
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
            <Compare id={`game-${g.id}`} cur={cur} m={m!} r={r} cmp={cmp} step={compare} me={me}
              setStep={(k) => { stopPlaying(); setCompare(k); }}
              orientation={orientation} show={show} setShow={(s) => { setShow(s); setActive(s); }} mistakes={mistakes}
              onMistake={(p) => openCompare(p)} peek={peek.shown}
              branches={branches} active={active} live={live} sel={cmpSel} setSel={setCmpSel} onPlay={playOn}
              onBranchAt={(key, k) => { botReq.current++; setBotBusy(false); setActive(key); setBranches((bs) => (bs[key] ? { ...bs, [key]: { ...bs[key]!, at: k } } : bs)); }}>
              <PlayOn bots={summary.bots} bot={bot} busy={botBusy} error={botError} onStop={branches.you || branches.best ? stopPlaying : undefined}>
                {playOver ? <b>{playOver}.</b>
                  : playFen ? <LiveBest fen={playFen} line={live.fen === playFen ? live.lines[0] ?? null : null} live={live} me={me} />
                  : <span className="muted">Make a move on either board and {bot.name ? `${bot.name} answers` : "play both sides"}.</span>}
              </PlayOn>
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
                  selected={selected} dots={dots} onDrop={(from, to) => play(from, to)} onSquare={onSquare} peek={explore ? null : peek.shown}
                  label={explore ? "Explore board: play any move" : m ? `Position after ${moveName(cur, m.san)}` : "Start position"} />
              </div>
              {strip(orientation)}
              {navbtns}
              {why && !cmp && <p className="muted small nav-note" role="status">{noCompare(m, me, g.opponent)}</p>}
              {threatFen && <Threat fen={threatFen} line={threatLine} depth={live.depth} status={live.status} error={live.error} me={me} />}
              {explore && (
                <PlayOn bots={summary.bots} bot={bot} busy={botBusy} error={botError}>
                  {over ? <b>{over}.</b>
                    : lastBot ? <>{lastBot.by} played <b className="san">{explorePlayed[explore.at - 1]}</b>
                        {lastBot.p != null ? ` (${Math.round(lastBot.p * 100)}% of its choices here)` : ""}. Your move.</>
                    : <span className="muted">{bot.name ? `Make a move on the board and ${bot.name} answers.` : "Nobody answers: play any move, for either side."}</span>}
                </PlayOn>
              )}
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
            <LivePanel live={live} lines={liveLines} explore={explore} played={explorePlayed} me={me} over={over}
              onPlay={(uci) => { const p = uciParts(uci); play(p.from, p.to, p.promotion); }}
              onAt={(k) => navTo(() => k)} onClose={leave} />
          ) : (
            <Explain g={g} me={me} cur={cur} m={m} r={r} myWin={myWin} turning={turning} cmp={cmp} comparing={comparing}
              onCompare={(step) => openCompare(cur, step)} prev={cur >= 2 ? { fen: fens[cur - 2], uci: g.moves[cur - 2].uci } : null}
              peek={peek} />
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
    one board at a time with a switch. A move played on either board plays on from there (Play on): that board
    shows its own moves, scored live by Stockfish while it's the board played on last. */
function Compare({ id, cur, m, r, cmp, step, setStep, me, orientation, show, setShow, mistakes, onMistake, peek,
  branches, active, live, sel, setSel, onPlay, onBranchAt, children }: {
  id: string; cur: number; m: Move; r?: MistakeRecord; cmp: Cmp; step: number; setStep: (k: number) => void; me: Side;
  orientation: Side; show: CmpKey; setShow: (s: CmpKey) => void; mistakes: number[];
  onMistake: (ply: number) => void; peek: Peek | null;
  branches: Branches; active: CmpKey; live: LiveState; sel: { key: CmpKey; square: string } | null;
  setSel: (s: { key: CmpKey; square: string } | null) => void;
  onPlay: (key: CmpKey, from: string, to: string) => boolean; onBranchAt: (key: CmpKey, k: number) => void; children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => { ref.current?.scrollIntoView?.({ block: "nearest" }); }, [cur]);
  const i = mistakes.indexOf(cur);
  const prev = mistakes.filter((p) => p < cur).at(-1), next = mistakes.find((p) => p > cur);
  const side = (key: CmpKey) => {
    const l = cmp[key];
    const b = branches[key];
    const k = b ? b.from : Math.min(step, l.fens.length);
    const base = lineFen(cmp, key, k);
    const fen = b ? branchFen(cmp, key, b) : base;
    const name = key === "you" ? "Your move" : "Stockfish's best";
    // Played on: the live score while this is the board played on last, the result when the game is over.
    const ended = b && gameOver(fen) ? outcome(fen) : null;
    const liveTop: LiveLine | undefined = b && key === active && live.fen === fen ? live.lines[0] : undefined;
    // Before the move both boards show the same position, so both bars show its score: Stockfish's best.
    const bar: BarValue = !b ? (k ? l.bar : cmp.best.bar)
      : ended ? { win: winOfOutcome(ended), outcome: ended }
      : liveTop ? { win: winOf(liveTop.eval), ev: liveTop.eval } : { win: null };
    const last = b?.at ? b.moves[b.at - 1] : null;
    // A move named in the explanation shows on the board whose line it's from; a square on both.
    const peeked = b ? null : !peek || !("fen" in peek) ? peek
      : (peek.fen === cmp.base ? (peek.kind === "you") === (key === "you") : l.fens.includes(peek.fen)) ? peek : null;
    const square = sel?.key === key ? sel.square : null;
    const dots = square ? targets(fen, square) : [];
    const played = b ? numberedLine(base, b.moves.map((x) => x.san)) : [];
    return (
      <div className={`cmp-side cmp-${key}${b && key === active ? " playing" : ""}`}>
        <div className="cmp-cap">
          <span className="label">{name}</span>
          <b className="san">{l.tokens[0]}</b>
          {key === "you" && r && <Nag severity={r.severity} />}
          <span className="num">{scoreText(l.bar, me)}</span>
        </div>
        <div className="board-row">
          <EvalBar value={bar} orientation={orientation} me={me} live={!!liveTop}
            note={b ? (liveTop ? `live, depth ${liveTop.depth}` : ended ? undefined : "Play a move on this board for its live score")
              : !k ? "Stockfish's score before the move" : key === "you" ? "Stockfish's score after your move" : "Stockfish's score with its best move"} />
          <Board id={`${id}-${key}`} fen={fen} orientation={orientation} peek={peeked}
            arrows={b ? (liveTop ? [{ uci: liveTop.pv[0], kind: "live" }] : []) : k === 0 ? [{ uci: l.ucis[0], kind: key }] : []}
            highlight={last ? { uci: last.uci, kind: last.by ? "them" : "you" } : k ? { uci: l.ucis[k - 1], kind: key } : null}
            selected={square} dots={dots} onDrop={(from, to) => onPlay(key, from, to)}
            onSquare={(sq) => {
              if (square && dots.includes(sq)) onPlay(key, square, sq);
              else setSel(targets(fen, sq).length ? { key, square: sq } : null);
            }}
            label={b ? `${name} board, played on${played[b.at - 1] ? ` to ${played[b.at - 1]}` : ""}`
              : k ? `${name} line after ${l.tokens[k - 1]}` : `Before ${moveName(cur, m.san)}: ${name.toLowerCase()} ${l.tokens[0]}`} />
        </div>
        <LineChips tokens={l.tokens} playable={l.fens.length === l.tokens.length} active={k ? k - 1 : null}
          onPick={(j) => setStep(j + 1)} label={key === "you" ? "Your move, then Stockfish's line" : "Stockfish's best line"} />
        {b && (
          <div className="chips played-on" role="group" aria-label="Played on from here">
            <span className="label">Played on {k ? `after ${l.tokens[k - 1]}` : "from before the move"}</span>
            {played.map((t, j) => {
              const x = b.moves[j];
              return (
                <button key={j} type="button" aria-pressed={b.at === j + 1} className={`san${x.by ? " bot" : ""}${j >= b.at ? " redo" : ""}`}
                  title={x.by ? `${x.by}${x.p != null ? `: ${Math.round(x.p * 100)}% of its choices here` : ""}` : "Your move"}
                  onClick={() => onBranchAt(key, j + 1)}>
                  {t}{x.p != null && <small className="num"> {Math.round(x.p * 100)}%</small>}
                </button>
              );
            })}
          </div>
        )}
        {!b && step > l.fens.length && <span className="muted small">This line ends here.</span>}
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

/** Play on: who answers a move played on a board (a Compare board, or the board in Explore), and what's
    happening: the bot at work, or `children` when it isn't. `onStop` goes back to the stored lines. */
function PlayOn({ bots, bot, busy, error, onStop, children }: {
  bots: Summary["bots"]; bot: ReturnType<typeof useBot>; busy: boolean; error: string | null; onStop?: () => void;
  children: ReactNode;
}) {
  const level = bot.level;
  const downloading = busy && level && bot.progress != null && bot.progress < 1;
  return (
    <div className="playon" aria-live="polite">
      <div className="playon-head">
        <span className="label">Play on · who answers</span>
        <span className="seg" role="group" aria-label="Who answers your moves">
          <button type="button" aria-pressed={bot.choice === "stockfish"} onClick={() => bot.setChoice("stockfish")}
            title="Stockfish at full strength, in this browser">Stockfish</button>
          {bots.maia.map((x) => (
            <button key={x.chesscom} type="button" aria-pressed={bot.choice === `maia-${x.chesscom}`}
              onClick={() => bot.setChoice(`maia-${x.chesscom}`)}
              title={`Maia-2 playing like chess.com ${x.chesscom} rapid players (Lichess ${x.lichess})`}>~{x.chesscom}</button>
          ))}
          <button type="button" aria-pressed={bot.choice === "off"} onClick={() => bot.setChoice("off")}
            title="Nobody answers: you play both sides">Nobody</button>
        </span>
        {onStop && <button type="button" className="btn ghost" onClick={onStop} title="Back to the stored lines (Esc)">Back to the lines</button>}
      </div>
      <p className="small">
        {error ? <span className="bad-text">{error}</span>
          : downloading ? <>Downloading Maia-2 (42 MB, once): <span className="num">{Math.round(bot.progress! * 100)}%</span></>
          : busy ? <>{bot.name} is choosing…</>
          : children}
      </p>
      {level && (
        <p className="muted small">
          Maia-2 is trained on Lichess rapid games. It plays the move chess.com ~{level.chesscom} players (Lichess {level.lichess}) most often
          play here, not the best one, and never scores positions.
        </p>
      )}
    </div>
  );
}

/** The live engine's best move on the Compare board played on last. */
function LiveBest({ fen, line, live, me }: { fen: string; line: LiveLine | null; live: LiveState; me: Side }) {
  const mv = line ? moveBetween(fen, replay(fen, [line.pv[0]])[0] ?? "") : null;
  return (
    <><span className="live-badge">LIVE</span>{" "}
      {mv ? <>Stockfish's best here: <b className="san">{mv.san}</b> ({evalFor(line!.eval, me)}, depth {line!.depth}). Never saved.</>
        : live.status === "loading" ? "Starting the engine…" : live.status === "error" ? live.error : "Stockfish is looking…"}</>
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
        {g.puzzles > 0 && <Link to={`/puzzles?game=${g.id}`}>Retry its mistakes ({g.puzzles}) →</Link>}
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
          {g.loss.cause === "gave_up" && <Link className="small" to={`/play?play=${resignedId(g.id)}`}>Play on from where it ended →</Link>}
        </div>
      )}
      {broken != null && <div className="callout">The exported moves stop replaying after ply {broken}; the viewer shows the game up to there.</div>}
    </section>
  );
}

function Explain({ g, me, cur, m, r, myWin, turning, cmp, comparing, onCompare, prev, peek }: {
  g: Game; me: Side; cur: number; m?: Move; r?: MistakeRecord; myWin: number[]; turning: number | null; cmp: Cmp | null;
  comparing: boolean; onCompare: (step: number) => void; prev: { fen: string; uci: string } | null; peek: PeekControl;
}) {
  // The lines the explanation names moves from: the move before mine, Stockfish's best, mine and its answer.
  const lines = useMemo<RefLine[]>(() => [
    ...(prev ? [{ fen: prev.fen, ucis: [prev.uci], kind: theirKinds }] : []),
    ...(cmp ? [{ fen: cmp.base, ucis: cmp.best.ucis, kind: bestKinds }, { fen: cmp.base, ucis: cmp.you.ucis, kind: myKinds }] : []),
  ], [prev?.fen, prev?.uci, cmp]);
  const at = (l: CmpLine, kind: (ply: number) => ArrowKind, offset = 0) => (i: number): Peek | null => {
    const j = i + offset, fen = j === 0 ? cmp!.base : l.fens[j - 1];
    return fen && l.ucis[j] ? { fen, uci: l.ucis[j], kind: kind(j) } : null;
  };
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
        <div className="callout">
          <b>Threw away a win. </b>Your Win% had reached {n1(g.thrown.peak)}% in this game.{" "}
          {before >= WINNING && (
            <Link to={`/play?play=${thrownId(g.id, cur)}`}>Play it out from here →</Link>
          )}
        </div>
      )}
      {r && <p><RefText id="why" text={r.note ?? r.explanation} lines={lines} me={me} peek={peek} /></p>}
      {r?.note && (
        <details className="worded">
          <summary>Worded by Claude from Stockfish's facts</summary>
          <p><RefText id="facts" text={r.explanation} lines={lines} me={me} peek={peek} /></p>
        </details>
      )}
      {cmp && !comparing && (
        <>
          <div className="label">Stockfish's best{bestSan ? `: ${bestSan}` : ""}{bestScore ? ` (${bestScore})` : ""}</div>
          <LineChips tokens={cmp.best.tokens} playable={cmp.best.fens.length === cmp.best.tokens.length} active={null}
            onPick={(i) => onCompare(i + 1)} label="Stockfish's best line" peek={peek} peekAt={at(cmp.best, bestKinds)} />
          {cmp.you.tokens.length > 1 && (
            <>
              <div className="label">After your move{afterScore ? ` (${afterScore})` : ""}</div>
              <LineChips tokens={cmp.you.tokens.slice(1)} playable={cmp.you.fens.length === cmp.you.tokens.length} active={null}
                onPick={(i) => onCompare(i + 2)} label="Stockfish's line after your move" peek={peek} peekAt={at(cmp.you, myKinds, 1)} />
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

/** The live engine's best move for the side not to move, as if it were their move: what they threaten. */
function Threat({ fen, line, depth, status, error, me }: {
  fen: string; line: LiveState["lines"][number] | null; depth: number; status: LiveState["status"]; error?: string; me: Side;
}) {
  const mv = line ? moveBetween(fen, replay(fen, [line.pv[0]])[0] ?? "") : null;
  return (
    <p className="threat-line small" aria-live="polite">
      <span className="live-badge">LIVE</span>{" "}
      {status === "error" ? error
        : status === "loading" ? "Starting the engine…"
        : mv ? <>If it were {sideToMove(fen) === me ? "your" : "their"} move, Stockfish would play <b className="san">{mv.san}</b>
            {mv.mate ? ", checkmate" : ""} ({evalFor(line!.eval, me)}, depth {depth}). Never saved.</>
        : "Looking for the threat…"}
    </p>
  );
}

function LivePanel({ live, lines, explore, played, me, over, onPlay, onAt, onClose }: {
  live: LiveState; lines: LiveState["lines"]; explore: Explore; played: string[]; me: Side; over: string | null;
  onPlay: (uci: string) => void; onAt: (at: number) => void; onClose: () => void;
}) {
  const fen = explore.at ? explore.moves[explore.at - 1].fen : explore.base;
  return (
    <section className="card v-explain live-panel" aria-live="polite">
      <div className="card-head">
        <h2><span className="live-badge">LIVE</span> Explore</h2>
        <span className="muted small">{live.engine}{live.depth ? ` · depth ${live.depth}` : ""}</span>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Play any move on the board; the bot chosen under the board answers it, or nobody and you play both sides. The
        in-browser Stockfish shows its top lines, scored from your side. Live results are never saved.
      </p>
      <div className="chips played" role="group" aria-label="Moves played in Explore">
        <span className="muted small">From {explore.from}:</span>
        {played.length ? played.map((t, i) => {
          const x = explore.moves[i];
          return (
            <button key={i} type="button" className={`san${x.by ? " bot" : ""}${i >= explore.at ? " redo" : ""}`}
              aria-pressed={i === explore.at - 1}
              title={x.by ? `${x.by}${x.p != null ? `: ${Math.round(x.p * 100)}% of its choices here` : ""}` : undefined}
              onClick={() => onAt(i + 1)}>
              {t}{x.p != null && <small className="num"> {Math.round(x.p * 100)}%</small>}
            </button>
          );
        }) : <span className="muted small">no moves yet</span>}
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
