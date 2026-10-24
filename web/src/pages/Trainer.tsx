// Repertoire trainer: play my side of each line from memory while the board plays the other side. Lines
// come from the repertoire PGN, from leak positions in my games (moves to the position, then Stockfish's
// best) and from lines I add in the opening tree. Each line is an FSRS card, kept on this device.
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Board } from "../components/Board";
import { numberedLine, replay, sideToMove, tryMove, uciParts, type Side } from "../lib/chess";
import { plural } from "../lib/format";
import { cardId, dueLines, newLines, START, useLines, type Line } from "../lib/lines";
import { useMoveInput } from "../lib/moveInput";
import { grade, Rating, removeLine, useProgress, type Progress } from "../lib/progress";

const REPLY_MS = 420;
const SESSION = 8;
const SOURCE: { [s in Line["source"]]: [string, string] } = {
  repertoire: ["Your repertoire", "From the repertoire PGN: a starter set built from named lines, Stockfish's moves for you and the most common replies at your level."],
  leak: ["Leak positions", "Positions where your usual move costs you: the moves to get there, then Stockfish's best."],
  tree: ["Added from the opening tree", "Lines you picked in Openings."],
};

export default function Trainer() {
  const lines = useLines();
  const p = useProgress();
  const [session, setSession] = useState<Line[] | null>(null);
  const due = dueLines(lines, p), fresh = newLines(lines, p);

  if (session) return <Session lines={session} onClose={() => setSession(null)} />;
  return (
    <>
      <div className="page-head">
        <h1>Repertoire trainer</h1>
        <p className="muted">Play your side of each line from memory; the board plays the other side. Lines you miss come back sooner.</p>
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
      {(["repertoire", "leak", "tree"] as const).map((src) => {
        const group = lines.filter((l) => l.source === src);
        if (!group.length && src !== "tree") return null;
        return (
          <section key={src} className="card">
            <div className="card-head"><h2>{SOURCE[src][0]}</h2><span className="muted small">{plural(group.length, "line")}</span></div>
            <p className="muted small" style={{ margin: 0 }}>{SOURCE[src][1]}</p>
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
  if (!item) return "new";
  const days = Math.ceil((item.card.due - Date.now()) / 86400000);
  return days <= 0 ? "due" : days === 1 ? "tomorrow" : `in ${days} days`;
}

function LineRow({ line, p, onDrill }: { line: Line; p: Progress; onDrill: () => void }) {
  const status = when(p, line);
  // A leak line's last move is the answer, so the row stops before it.
  const shown = numberedLine(START, line.san).slice(0, line.source === "leak" ? line.start : 12);
  const more = line.source === "leak" || shown.length < line.san.length;
  return (
    <div className="row line-row">
      <button type="button" className="t linkish" onClick={onDrill}>
        {line.name} <span className="muted small">· as {line.colour === "white" ? "White" : "Black"}</span>
      </button>
      <span className="s san">{shown.join(" ")}{more ? " …" : ""}</span>
      <span className="r">
        <span className={`pill ${status === "due" ? "due" : ""}`}>{status}</span>
        {line.source === "tree" && (
          <button type="button" className="linkish small" onClick={() => removeLine(line.id)} aria-label={`Remove ${line.name}`}>Remove</button>
        )}
      </span>
    </div>
  );
}

function Session({ lines, onClose }: { lines: Line[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [results, setResults] = useState<number[]>([]);
  if (i >= lines.length) {
    const clean = results.filter((m) => m === 0).length;
    return (
      <>
        <div className="page-head"><h1>Repertoire trainer</h1></div>
        <section className="card session-done">
          <h2>Done</h2>
          <p><b className="num">{clean}</b> of {plural(lines.length, "line")} played without a slip.</p>
          <button type="button" className="btn" onClick={onClose}>Back to the lines</button>
        </section>
      </>
    );
  }
  const line = lines[i];
  return (
    <>
      <div className="page-head">
        <h1>{line.name}</h1>
        <p className="muted">Line {i + 1} of {lines.length} · you play {line.colour === "white" ? "White" : "Black"}</p>
      </div>
      <section className="card">
        <LineDrill key={line.id} line={line} onDone={(mistakes) => {
          grade(cardId(line), "line", mistakes === 0 ? Rating.Good : mistakes === 1 ? Rating.Hard : Rating.Again, [line.source]);
          setResults((r) => [...r, mistakes]);
        }} onNext={() => setI(i + 1)} onClose={onClose} last={i + 1 === lines.length} />
      </section>
    </>
  );
}

export function LineDrill({ line, onDone, onNext, onClose, last }: {
  line: Line; onDone: (mistakes: number) => void; onNext: () => void; onClose: () => void; last: boolean;
}) {
  const me: Side = line.colour;
  const fens = useMemo(() => [START, ...replay(START, line.moves)], [line.moves]);
  // A leak line starts at the leak position; a repertoire line at the start (the board plays the first
  // move when it is the opponent's).
  const [step, setStep] = useState(line.start);
  const [mistakes, setMistakes] = useState(0);
  const [miss, setMiss] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const reported = useRef(false);
  const done = step >= line.moves.length;
  const myTurn = !done && sideToMove(fens[step]) === me;

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
      setMiss(line.san[step]);
      return false;
    }
    setMiss(null);
    advance(step + 1);
    return true;
  };
  const input = useMoveInput(fens[step], myTurn, onMove);
  const tokens = numberedLine(START, line.san);
  const lastUci = step > 0 ? line.moves[step - 1] : null;
  const lastMine = step > 0 && sideToMove(fens[step - 1]) === me;

  return (
    <div className="puzzle">
      <div className="puzzle-board">
        <Board id={`line-${line.id}`} fen={fens[step]} orientation={me} label={`Repertoire line, ${me} to play`}
          arrows={miss && myTurn ? [{ uci: line.moves[step], kind: "best" }] : []}
          highlight={lastUci ? { uci: lastUci, kind: lastMine ? "you" : "them" } : null}
          selected={input.selected} dots={input.dots} onDrop={input.onDrop} onSquare={input.onSquare} />
      </div>
      <div className="puzzle-side" aria-live="polite">
        {!done ? (
          <>
            <p className="puzzle-task">
              <span className={`turn ${me}`} aria-hidden="true" />
              {myTurn ? (line.source === "leak" ? "You've gone wrong here before. Stockfish's move?" : "Your move in this line.") : "Their move…"}
            </p>
            {miss && <p className="puzzle-miss">Not that one. The line plays <b className="san">{miss}</b> (the arrow); play it to go on.</p>}
          </>
        ) : (
          <p className={`puzzle-result ${mistakes ? "revealed" : "solved"}`}>
            {mistakes === 0 ? "Line played without a slip." : `Done, with ${plural(mistakes, "slip")}. It comes back sooner.`}
          </p>
        )}
        <div className="chips played" role="group" aria-label="The line so far">
          {tokens.slice(0, step).map((t, k) => <span key={k} className="san chip">{t}</span>)}
          {!done && <span className="chip muted">…</span>}
        </div>
        <div className="puzzle-actions">
          {done ? (
            <button type="button" className="btn" onClick={onNext}>{last ? "Finish" : "Next line"} →</button>
          ) : (
            <button type="button" className="btn ghost" onClick={onClose}>Stop</button>
          )}
        </div>
      </div>
    </div>
  );
}
