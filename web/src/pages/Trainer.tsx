// Repertoire trainer: play my side of each line while the board plays the other side. A new line is shown
// first (learn: the arrow gives each move and why); after that it's played from memory. Lines come from the
// repertoire PGN, from the replies my opponents play (coverage), from leak positions in my games (moves to the
// position, then Stockfish's best) and from lines I add in the opening tree. A line I left with my own move in
// a game comes first among the lines to review. Each line is an FSRS card, kept on this device. Every score is stored
// Stockfish output (or the live engine, labelled, for a move nothing stored covers) and every reason is
// measured on the board by the pipeline (src/coach/why.py).
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Board } from "../components/Board";
import { RefText, usePeek, type PeekControl } from "../components/RefText";
import { numberedLine, replay, sideToMove, tryMove, uciParts, type Side } from "../lib/chess";
import { useRepertoire } from "../lib/data";
import { useLiveEngine } from "../lib/engine";
import { day, evalFor, moveName, pct, plural, signed } from "../lib/format";
import { cardId, dueLines, newLines, slipped, START, useLines, type Line } from "../lib/lines";
import { useMoveInput } from "../lib/moveInput";
import { grade, Rating, removeLine, useProgress, type Progress } from "../lib/progress";
import { myKinds, type RefLine } from "../lib/refs";
import { winOf } from "../lib/winpct";
import type { Alternative, Eval, LineStep } from "../types/export";

const REPLY_MS = 420;
const SESSION = 8;
const SOURCE: { [s in Line["source"]]: [string, (minGames: number) => string] } = {
  repertoire: ["Your repertoire", () => "From the repertoire PGN: a starter set built from named lines, Stockfish's moves for you and the most common replies at your level."],
  coverage: ["Covering your opponents", (n) => `What your opponents play against you, each reply in at least ${n} of your games: your repertoire's moves where it has them, Stockfish's best where it doesn't. The moves your repertoire already has are played for you.`],
  leak: ["Leak positions", () => "Positions where your usual move costs you: the moves to get there, then Stockfish's best."],
  tree: ["Added from the opening tree", () => "Lines you picked in Openings."],
};

export default function Trainer() {
  const lines = useLines();
  const p = useProgress();
  const minGames = useRepertoire().cover_min_games;
  const [params, setParams] = useSearchParams();
  // ?line=<id> (from a game's "Drill the line") opens that line straight away.
  const [session, setSession] = useState<Line[] | null>(() => {
    const asked = lines.find((l) => l.id === params.get("line"));
    return asked ? [asked] : null;
  });
  const due = dueLines(lines, p), fresh = newLines(lines, p);
  const left = due.filter((l) => slipped(l, p));
  const close = () => {
    setSession(null);
    if (params.has("line")) { const next = new URLSearchParams(params); next.delete("line"); setParams(next, { replace: true }); }
  };

  if (session) return <Session lines={session} onClose={close} />;
  return (
    <>
      <div className="page-head">
        <h1>Repertoire trainer</h1>
        <p className="muted">A new line is shown first, with an arrow and a reason for every move. After that you play your side from memory and the board plays the other side. Lines you miss come back sooner.</p>
      </div>
      <section className="card">
        <div className="trainer-start">
          <button type="button" className="btn" disabled={!due.length} onClick={() => setSession(due.slice(0, SESSION))}>
            Review due lines ({due.length})
          </button>
          <button type="button" className="btn ghost" disabled={!fresh.length} onClick={() => setSession(fresh.slice(0, SESSION))}>
            Learn new lines ({fresh.length})
          </button>
        </div>
      </section>
      {left.length > 0 && (
        <section className="card">
          <div className="card-head"><h2>You left these in your games</h2><span className="muted small">{plural(left.length, "line")}</span></div>
          <p className="muted small" style={{ margin: 0 }}>Lines where you played another move in a game since you last drilled them. They come first in your review.</p>
          <div className="rows">
            {left.map((l) => <LineRow key={l.id} line={l} p={p} onDrill={() => setSession([l])} />)}
          </div>
        </section>
      )}
      {(["repertoire", "coverage", "leak", "tree"] as const).map((src) => {
        const group = lines.filter((l) => l.source === src);
        if (!group.length && src !== "tree") return null;
        return (
          <section key={src} className="card">
            <div className="card-head"><h2>{SOURCE[src][0]}</h2><span className="muted small">{plural(group.length, "line")}</span></div>
            <p className="muted small" style={{ margin: 0 }}>{SOURCE[src][1](minGames)}</p>
            {group.length ? (
              <div className="rows">
                {group.map((l) => <LineRow key={l.id} line={l} p={p} onDrill={() => setSession([l])} />)}
              </div>
            ) : (
              <div className="empty">None yet. In <Link to="/openings">Openings</Link>, step to a position and pick “Drill this line”.</div>
            )}
          </section>
        );
      })}
    </>
  );
}

function when(p: Progress, l: Line) {
  const item = p.items[cardId(l)];
  if (slipped(l, p)) return "due";
  if (!item) return "new";
  const days = Math.ceil((item.card.due - Date.now()) / 86400000);
  return days <= 0 ? "due" : days === 1 ? "tomorrow" : `in ${days} days`;
}

function LineRow({ line, p, onDrill }: { line: Line; p: Progress; onDrill: () => void }) {
  const status = when(p, line);
  // A leak line's last move is the answer, so the row stops before it.
  const shown = numberedLine(START, line.san).slice(0, line.source === "leak" ? line.start : 12);
  const more = line.source === "leak" || shown.length < line.san.length;
  const slip = line.slips[0];
  return (
    <div className="row line-row">
      <button type="button" className="t linkish" onClick={onDrill}>
        {line.name} <span className="muted small">· as {line.colour === "white" ? "White" : "Black"}</span>
      </button>
      <span className="s san">{shown.join(" ")}{more ? " …" : ""}</span>
      {slip && (
        <span className="s small">
          You played <Link to={`/games/${slip.game}?ply=${slip.ply}`} className="san">{moveName(slip.ply, slip.san)}</Link> instead on {day(slip.ts)}
          {line.slip_games > 1 && <span className="muted"> · left it in {plural(line.slip_games, "game")}</span>}
        </span>
      )}
      <span className="r">
        <span className={`pill ${status === "due" ? "due" : ""}`}>{status}</span>
        {line.source === "tree" && (
          <button type="button" className="linkish small" onClick={() => removeLine(line.id)} aria-label={`Remove ${line.name}`}>Remove</button>
        )}
      </span>
    </div>
  );
}

type Result = { mistakes: number; learn: boolean };

function Session({ lines, onClose }: { lines: Line[]; onClose: () => void }) {
  const p = useProgress();
  // Lines I've never drilled are shown first; decided once, so grading one doesn't flip the mode mid-session.
  const [fresh] = useState(() => new Set(lines.filter((l) => !p.items[cardId(l)]).map((l) => l.id)));
  const [i, setI] = useState(0);
  const [again, setAgain] = useState(0);   // "Go through it again": replay the line shown, without grading
  const [results, setResults] = useState<Result[]>([]);
  if (i >= lines.length) {
    const learned = results.filter((r) => r.learn).length, recalled = results.filter((r) => !r.learn);
    const clean = recalled.filter((r) => r.mistakes === 0).length;
    return (
      <>
        <div className="page-head"><h1>Repertoire trainer</h1></div>
        <section className="card session-done">
          <h2>Done</h2>
          {learned > 0 && <p>Learned <b className="num">{plural(learned, "new line")}</b>; {learned === 1 ? "it comes" : "they come"} back for a review from tomorrow.</p>}
          {recalled.length > 0 && <p><b className="num">{clean}</b> of {plural(recalled.length, "line")} played from memory without a slip.</p>}
          <button type="button" className="btn" onClick={onClose}>Back to the lines</button>
        </section>
      </>
    );
  }
  const line = lines[i];
  const learn = fresh.has(line.id) || again > 0;
  return (
    <>
      <div className="page-head">
        <h1>{line.name}</h1>
        <p className="muted">
          Line {i + 1} of {lines.length} · you play {line.colour === "white" ? "White" : "Black"} ·{" "}
          {learn ? "learn it: the arrow shows each move" : "from memory"}
        </p>
      </div>
      <section className="card">
        <LineDrill key={`${line.id}:${again}`} line={line} learn={learn} onDone={(mistakes) => {
          if (again) return;
          // A line just learned comes back tomorrow (Hard); from memory, slips bring it back sooner.
          const g = learn ? (mistakes ? Rating.Again : Rating.Hard) : mistakes === 0 ? Rating.Good : mistakes === 1 ? Rating.Hard : Rating.Again;
          grade(cardId(line), "line", g, [line.source]);
          setResults((r) => [...r, { mistakes, learn }]);
        }} onNext={() => { setAgain(0); setI(i + 1); }} onAgain={() => setAgain((a) => a + 1)} onClose={onClose}
          last={i + 1 === lines.length} />
      </section>
    </>
  );
}

/** "+0.4", or how the move ends the game. */
function scoreText(ev: Eval | null, terminal: string | null, me: Side) {
  if (terminal === "draw") return "a draw";
  if (terminal) return terminal === me ? "checkmate" : "you get mated";
  return evalFor(ev, me);
}

/** Stockfish's score, its preference, how often players at my level choose it, the opening it reaches,
    and what the move does on the board. */
function StepWhy({ step, me, mine, alts, title, peek }: {
  step: LineStep; me: Side; mine: boolean; alts: Alternative[]; title: string; peek: PeekControl;
}) {
  const best = alts[0];
  const facts = [
    step.eval || step.terminal ? `Stockfish ${scoreText(step.eval, step.terminal, me)}` : null,
    step.top === true ? "its top move here" : step.top === false && best ? `its top move is ${best.san} (${scoreText(best.eval, best.terminal, me)})` : null,
    step.share != null ? `${pct(step.share)} of players at your level play it${step.most_common ? `, the most common ${mine ? "move" : "reply"}` : ""}` : null,
    step.masters_share != null ? `${pct(step.masters_share)} of masters` : null,
  ].filter(Boolean);
  return (
    <div className="step-why">
      <div className="label">{title}</div>
      {step.reason && <p><RefText id={title} text={step.reason} lines={NO_LINES} me={me} peek={peek} /></p>}
      {facts.length > 0 && <p className="muted small">{facts.join(" · ")}.</p>}
      {step.opening && <p className="small">Opening: <b>{step.opening}</b></p>}
    </div>
  );
}

type Miss = { uci: string; san: string; fen: string; step: number };
const NO_LINES: RefLine[] = [];

export function LineDrill({ line, learn, onDone, onNext, onAgain, onClose, last }: {
  line: Line; learn: boolean; onDone: (mistakes: number) => void; onNext: () => void; onAgain: () => void;
  onClose: () => void; last: boolean;
}) {
  const me: Side = line.colour;
  const positions = useRepertoire().positions;
  const fens = useMemo(() => [START, ...replay(START, line.moves)], [line.moves]);
  // A leak line starts at the leak position; a repertoire line at the start (the board plays the first
  // move when it is the opponent's).
  const [step, setStep] = useState(line.start);
  const [mistakes, setMistakes] = useState(0);
  const [miss, setMiss] = useState<Miss | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const reported = useRef(false);
  const done = step >= line.moves.length;
  const myTurn = !done && sideToMove(fens[step]) === me;
  const info = (k: number) => line.steps[k] as LineStep | undefined;
  const altsAt = (k: number) => (info(k)?.key ? positions[info(k)!.key!] ?? [] : []);

  const advance = (next: number, slips = mistakes) => {
    setStep(next);
    if (next >= line.moves.length && !reported.current) { reported.current = true; onDone(slips); }
  };
  // The board plays the opponent's moves (and finishes a line that ends on one).
  const reply = useEffectEvent(() => advance(step + 1));
  useEffect(() => {
    if (done || myTurn) return;
    timer.current = window.setTimeout(reply, REPLY_MS);
    return () => window.clearTimeout(timer.current);
  }, [done, myTurn, step]);

  const onMove = (from: string, to: string) => {
    if (!myTurn) return false;
    const expected = line.moves[step], e = uciParts(expected);
    const mv = tryMove(fens[step], from, to, e.from === from && e.to === to ? e.promotion : undefined);
    if (!mv) return false;
    if (mv.uci !== expected) {
      setMistakes((m) => m + 1);
      setMiss({ ...mv, step });
      return false;
    }
    setMiss(null);
    advance(step + 1);
    return true;
  };
  const input = useMoveInput(fens[step], myTurn, onMove);
  const peek = usePeek(`${step}:${miss?.uci ?? ""}`);
  const tokens = numberedLine(START, line.san);
  const lastUci = step > 0 ? line.moves[step - 1] : null;
  const lastMine = step > 0 && sideToMove(fens[step - 1]) === me;
  const lastInfo = step > 0 ? info(step - 1) : undefined;
  const nextInfo = myTurn && learn ? info(step) : undefined;
  const showArrow = myTurn && (learn || miss != null);

  return (
    <div className="puzzle">
      <div className="puzzle-board">
        <Board id={`line-${line.id}`} fen={fens[step]} orientation={me} label={`Repertoire line, ${me} to play`}
          arrows={showArrow ? [{ uci: line.moves[step], kind: "best" }] : []}
          highlight={lastUci ? { uci: lastUci, kind: lastMine ? "you" : "them" } : null}
          selected={input.selected} dots={input.dots} onDrop={input.onDrop} onSquare={input.onSquare}
          peek={peek.shown} marks={!myTurn || learn} />
      </div>
      <div className="puzzle-side" aria-live="polite">
        {!done ? (
          <>
            <p className="puzzle-task">
              <span className={`turn ${me}`} aria-hidden="true" />
              {!myTurn ? "Their move…"
                : learn ? <>Play <b className="san">{line.san[step]}</b>: the arrow shows it.</>
                : line.source === "leak" ? "You've gone wrong here before. Stockfish's move?" : "Your move in this line."}
            </p>
            {miss && <Slip miss={miss} expected={info(miss.step)} san={line.san[miss.step]} alts={altsAt(miss.step)} me={me}
              before={fens[miss.step]} peek={peek} />}
            {nextInfo && !miss && <StepWhy step={nextInfo} me={me} mine alts={altsAt(step)} title={`Why ${line.san[step]}`} peek={peek} />}
            {lastInfo && !miss && (
              <StepWhy step={lastInfo} me={me} mine={lastMine} alts={altsAt(step - 1)} peek={peek}
                title={`${moveName(step, line.san[step - 1])} · ${lastMine ? "your move" : "their move"}`} />
            )}
          </>
        ) : (
          <p className={`puzzle-result ${mistakes ? "revealed" : "solved"}`}>
            {learn ? (mistakes ? `Shown, with ${plural(mistakes, "slip")}.` : "Line learned.")
              : mistakes === 0 ? "Line played without a slip." : `Done, with ${plural(mistakes, "slip")}. It comes back sooner.`}
          </p>
        )}
        {!done && (
          <div className="chips played" role="group" aria-label="The line so far">
            {tokens.slice(0, step).map((t, k) => <span key={k} className="san chip">{t}</span>)}
            <span className="chip muted">…</span>
          </div>
        )}
        {done && line.steps.length > 0 && <WholeLine line={line} me={me} positions={positions} />}
        {done && !line.steps.length && (
          <div className="chips played" role="group" aria-label="The line">
            {tokens.map((t, k) => <span key={k} className="san chip">{t}</span>)}
          </div>
        )}
        <div className="puzzle-actions">
          {done ? (
            <>
              <button type="button" className="btn ghost" onClick={onAgain}>Go through it again</button>
              <button type="button" className="btn" onClick={onNext}>{last ? "Finish" : "Next line"} →</button>
            </>
          ) : (
            <button type="button" className="btn ghost" onClick={onClose}>Stop</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** A move that isn't the line's: Stockfish's stored score for it next to the line's move, and what happens
    along Stockfish's line after it. Without a stored score, the live engine scores it (labelled). */
function Slip({ miss, expected, san, alts, me, before, peek }: {
  miss: Miss; expected?: LineStep; san: string; alts: Alternative[]; me: Side; before: string; peek: PeekControl;
}) {
  // The slip's text names the slip, then Stockfish's answer to it (found from the position after the slip).
  const lines = useMemo<RefLine[]>(() => [{ fen: before, ucis: [miss.uci], kind: myKinds }], [before, miss.uci]);
  const alt = alts.find((a) => a.uci === miss.uci);
  const stored = alt && (alt.eval || alt.terminal) && alt.win != null;
  const live = useLiveEngine(stored ? null : miss.fen);
  const liveTop = live.lines[0];
  const myWin = (ev: Eval) => { const w = winOf(ev); return w == null ? null : me === "white" ? w : 100 - w; };
  const slipWin = stored ? alt!.win : liveTop ? myWin(liveTop.eval) : null;
  const diff = slipWin != null && expected?.win != null ? slipWin - expected.win : null;
  return (
    <div className="puzzle-miss">
      <p><b className="san">{miss.san}</b> isn't the line's move.</p>
      {stored ? (
        <p className="small">
          Stockfish: <b className="san">{san}</b> {scoreText(expected?.eval ?? null, expected?.terminal ?? null, me)},
          your <b className="san">{miss.san}</b> {scoreText(alt!.eval, alt!.terminal, me)}
          {diff != null && <span className="num"> ({diff >= 0 ? "it scores at least as high" : `${signed(diff)} Win%`})</span>}.
        </p>
      ) : (
        <p className="small">
          <span className="live-badge">LIVE</span>{" "}
          {liveTop ? <>Stockfish in this browser, depth {liveTop.depth}: your <b className="san">{miss.san}</b> {evalFor(liveTop.eval, me)}
            {expected?.eval && <>, the line's <b className="san">{san}</b> {scoreText(expected.eval, expected.terminal, me)} (stored)</>}.</>
            : "Stockfish in this browser is scoring it…"}
        </p>
      )}
      {stored && alt!.why && <p className="small"><RefText id="slip" text={alt!.why} lines={lines} me={me} peek={peek} /></p>}
      <p className="small">The line plays <b className="san">{san}</b> (the arrow); play it to go on.</p>
    </div>
  );
}

/** The finished line, every move with its score, share and what it does. */
function WholeLine({ line, me, positions }: { line: Line; me: Side; positions: { [key: string]: Alternative[] } }) {
  const tokens = numberedLine(START, line.san);
  let fen = START;
  return (
    <ol className="line-why" aria-label="The whole line, move by move">
      {line.steps.map((s, k) => {
        const mine = sideToMove(fen) === me;
        fen = replay(fen, [line.moves[k]])[0];
        const alts = s.key ? positions[s.key] ?? [] : [];
        const best = alts[0];
        const extra = [
          s.eval || s.terminal ? `Stockfish ${scoreText(s.eval, s.terminal, me)}` : null,
          s.top === false && best ? `top: ${best.san}` : null,
          s.share != null ? `${pct(s.share)} at your level` : null,
          s.masters_share != null ? `${pct(s.masters_share)} masters` : null,
        ].filter(Boolean).join(" · ");
        return (
          <li key={k} className={mine ? "mine" : "theirs"}>
            <b className="san">{tokens[k]}</b>
            {extra && <span className="muted small num"> {extra}</span>}
            {s.opening && <span className="small"> · {s.opening}</span>}
            {s.reason && <div className="small">{s.reason}</div>}
          </li>
        );
      })}
    </ol>
  );
}
