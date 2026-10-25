// One puzzle: find the solver's moves in the stored solution, with the replies played for you. A move
// counts when it is the solution's move, or when it mates (the rules end the game there, so nothing beats
// it). Hint marks the piece to move; Show the solution plays the rest. Nothing here judges a move beyond
// that: the solution is Stockfish's line (mine) or Lichess's (engine-verified). Once it's over, `why` says
// what the solution does on the board, measured by the pipeline (src/coach/why.py); its moves and squares
// show on the board when hovered, and a puzzle from my game can step through my move's line too.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { gameOver, numberedLine, replay, sideToMove, tryMove, uciParts } from "../lib/chess";
import type { Outcome } from "../lib/drill";
import { moveName, n1 } from "../lib/format";
import { useMoveInput } from "../lib/moveInput";
import { tagName } from "../lib/names";
import { bestKinds, myKinds, type RefLine } from "../lib/refs";
import type { Puzzle } from "../types/export";
import { Board, type ArrowKind } from "./Board";
import { RefText, usePeek } from "./RefText";

type Status = "play" | "solved" | "revealed";
/** Stepping through a line once it's over: the solution, or (a puzzle from my game) my move and its answer. */
type View = { line: "solution" | "played"; k: number };
const REPLY_MS = 380;

export function PuzzleBoard({ puzzle, onDone, onNext, nextLabel = "Next puzzle" }: {
  puzzle: Puzzle; onDone: (o: Outcome) => void; onNext?: () => void; nextLabel?: string;
}) {
  const sol = puzzle.solution;
  const fens = useMemo(() => [puzzle.fen, ...replay(puzzle.fen, sol)], [puzzle.fen, sol]);
  const playedFens = useMemo(() => [puzzle.fen, ...replay(puzzle.fen, puzzle.played_line)], [puzzle.fen, puzzle.played_line]);
  const solver = sideToMove(puzzle.fen);
  const [step, setStep] = useState(0);           // solution plies on the board
  const [status, setStatus] = useState<Status>("play");
  const [wrong, setWrong] = useState(0);
  const [miss, setMiss] = useState<{ uci: string; san: string; at: number } | null>(null);
  const [hintAt, setHintAt] = useState<number | null>(null);
  const [usedHint, setUsedHint] = useState(false);
  const [view, setView] = useState<View | null>(null);
  const [mate, setMate] = useState<{ fen: string; uci: string } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const reported = useRef(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const finish = (s: Status, o: Outcome) => {
    setStatus(s);
    if (!reported.current) { reported.current = true; onDone(o); }
  };

  const fen = mate?.fen ?? (view?.line === "played" ? playedFens[view.k] : fens[view?.k ?? step]) ?? puzzle.fen;
  const playing = status === "play" && step % 2 === 0;

  const onMove = (from: string, to: string) => {
    if (!playing) return false;
    const expected = sol[step];
    const e = uciParts(expected);
    const mv = tryMove(fens[step], from, to, e.from === from && e.to === to ? e.promotion : undefined);
    if (!mv) return false;
    if (mv.uci !== expected) {
      if (gameOver(mv.fen) === "Checkmate") {
        setMate({ fen: mv.fen, uci: mv.uci });
        finish("solved", { solved: true, wrong, hint: usedHint, revealed: false });
        return true;
      }
      setWrong((w) => w + 1);
      setMiss({ uci: mv.uci, san: mv.san, at: step });
      return false;
    }
    setMiss(null);
    setHintAt(null);
    const next = step + 1;
    setStep(next);
    if (next >= sol.length) {
      finish("solved", { solved: true, wrong, hint: usedHint, revealed: false });
    } else {
      timer.current = window.setTimeout(() => {
        setStep(next + 1);
        if (next + 1 >= sol.length) finish("solved", { solved: true, wrong, hint: usedHint, revealed: false });
      }, REPLY_MS);
    }
    return true;
  };
  const input = useMoveInput(fen, playing && view === null, onMove);

  const hint = () => { setHintAt(step); setUsedHint(true); };
  const reveal = () => {
    window.clearTimeout(timer.current);
    finish("revealed", { solved: false, wrong, hint: usedHint, revealed: true });
    setMiss(null);
    setHintAt(null);
    const playFrom = (k: number) => {
      setStep(k);
      if (k < sol.length) timer.current = window.setTimeout(() => playFrom(k + 1), 650);
    };
    playFrom(step + 1);
  };
  const retry = () => {
    window.clearTimeout(timer.current);
    setStep(0); setStatus("play"); setMiss(null); setHintAt(null); setView(null); setMate(null);
  };

  const done = status !== "play";
  const onPlayed = view?.line === "played";
  const shownStep = view?.k ?? step;
  const line = onPlayed ? puzzle.played_line : sol;
  const lastUci = mate?.uci ?? (shownStep > 0 ? line[shownStep - 1] : puzzle.last_move);
  const lastKind = mate ? "you" : shownStep === 0 ? "them" : ((onPlayed ? myKinds : bestKinds)(shownStep - 1) as ArrowKind);
  const arrows = miss && !done ? [{ uci: miss.uci, kind: "them" as const }] : [];
  const selected = hintAt === step && !done ? sol[step].slice(0, 2) : input.selected;
  const tokens = numberedLine(puzzle.fen, puzzle.solution_san);
  const playedTokens = numberedLine(puzzle.fen, puzzle.played_line_san);
  const unique = puzzle.unique[Math.floor(step / 2)] ?? true;
  const lines = useMemo<RefLine[]>(() => [
    { fen: puzzle.fen, ucis: sol, kind: bestKinds }, { fen: puzzle.fen, ucis: puzzle.played_line, kind: myKinds },
  ], [puzzle.fen, sol, puzzle.played_line]);
  const peek = usePeek(`${status}:${view?.line}:${view?.k}`);

  return (
    <div className="puzzle">
      <div className="puzzle-board">
        <Board id={`pz-${puzzle.id}`} fen={fen} orientation={solver} label={`Puzzle: ${solver === "white" ? "White" : "Black"} to move`}
          arrows={arrows} highlight={lastUci ? { uci: lastUci, kind: lastKind === "live" ? "them" : lastKind } : null}
          selected={selected} dots={input.dots} onDrop={input.onDrop} onSquare={input.onSquare}
          peek={done ? peek.shown : null} marks={done} />
      </div>
      <div className="puzzle-side" aria-live="polite">
        {!done && (
          <>
            <p className="puzzle-task">
              <span className={`turn ${solver}`} aria-hidden="true" />
              {step === 0 ? `${solver === "white" ? "White" : "Black"} to move. Find the best move.` : "Good. Keep going."}
            </p>
            {miss && (
              <p className="puzzle-miss">
                <b className="san">{miss.san}</b> isn't it.{" "}
                {unique ? "Try again." : "Stockfish's line plays a different move here; other moves may work too, but this drill wants its move."}
              </p>
            )}
            {step % 2 === 1 && <p className="muted small">Their reply…</p>}
            <div className="puzzle-actions">
              <button type="button" className="btn ghost" onClick={hint} disabled={hintAt === step || !playing}>Hint</button>
              <button type="button" className="btn ghost" onClick={reveal}>Show the solution</button>
            </div>
          </>
        )}
        {done && (
          <>
            <p className={`puzzle-result ${status}`}>
              {status === "solved" ? (wrong || usedHint ? "Solved, with help." : "Solved.") : "Here's the solution."}
              {mate && " Checkmate — that ends it too."}
            </p>
            {puzzle.why && <p className="puzzle-why"><RefText id="why" text={puzzle.why} lines={lines} me={solver} peek={peek} /></p>}
            <div className="chips played" role="group" aria-label="Solution">
              <span className="label">{puzzle.source === "mine" ? "Stockfish's line" : "Solution"}</span>
              <button type="button" aria-pressed={!onPlayed && shownStep === 0} onClick={() => setView({ line: "solution", k: 0 })}>Start</button>
              {tokens.map((t, i) => (
                <button key={i} type="button" className="san" aria-pressed={!onPlayed && shownStep === i + 1}
                  onClick={() => setView({ line: "solution", k: i + 1 })}>{t}</button>
              ))}
            </div>
            {playedTokens.length > 0 && playedFens.length === playedTokens.length + 1 && (
              <div className="chips played yours" role="group" aria-label="Your move in the game, then Stockfish's line">
                <span className="label">Your move, then Stockfish</span>
                {playedTokens.map((t, i) => (
                  <button key={i} type="button" className="san" aria-pressed={onPlayed && shownStep === i + 1}
                    onClick={() => setView({ line: "played", k: i + 1 })}>{t}</button>
                ))}
              </div>
            )}
            <PuzzleSource puzzle={puzzle} />
            <div className="puzzle-actions">
              <button type="button" className="btn ghost" onClick={retry}>Try it again</button>
              {onNext && <button type="button" className="btn" onClick={onNext}>{nextLabel} →</button>}
            </div>
          </>
        )}
        {/* The tags name the motif, so they wait until the puzzle is over. */}
        {done && puzzle.tags.length > 0 && (
          <div className="puzzle-tags">
            {puzzle.tags.map((t) => <span key={t} className="pill">{tagName(t)}</span>)}
            {puzzle.rating != null && <span className="muted small num">rated {puzzle.rating}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function PuzzleSource({ puzzle }: { puzzle: Puzzle }) {
  if (puzzle.source === "mine" && puzzle.game && puzzle.ply) {
    return (
      <p className="small">
        From your game: you played <b className="san">{moveName(puzzle.ply, puzzle.played_san ?? "?")}</b>
        {puzzle.drop != null && <span className="num"> (−{n1(puzzle.drop)} Win%)</span>}.{" "}
        <Link to={`/games/${puzzle.game}?ply=${puzzle.ply}&compare=1`}>Open it in the game →</Link>
      </p>
    );
  }
  return (
    <p className="small">
      Lichess puzzle{puzzle.opening ? ` · ${puzzle.opening}` : ""}.{" "}
      {puzzle.url && <a href={puzzle.url} target="_blank" rel="noreferrer">See it on Lichess ↗</a>}
    </p>
  );
}
