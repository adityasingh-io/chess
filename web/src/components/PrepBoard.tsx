// A rival's costly move to punish (PLAN.md, reading 26): the position after their move, where every legal move of
// mine has a stored score labelled against my Win% there, as a key moment's are. Best, Excellent or Good finds a
// punishment; anything else snaps back with the Win% it loses and what Stockfish's line does after it. Nothing here
// judges a move: the labels and the lines are stored (rivals.prep_out).
import { useMemo, useState } from "react";
import { replay, sideToMove } from "../lib/chess";
import type { Outcome } from "../lib/drill";
import { FOUND, useFindMove } from "../lib/findMove";
import { moveName, n1, plural, sanTokens, signed } from "../lib/format";
import { LABEL } from "../lib/names";
import { bestKinds, myKinds, type RefLine } from "../lib/refs";
import type { KeyMove, PrepStep } from "../types/export";
import { LineChips, Nag } from "./bits";
import { Board } from "./Board";
import { RefText, usePeek } from "./RefText";

/** The ply number of the next move in a full FEN ("… b KQkq - 0 4" → 8). */
const nextPly = (fen: string) => {
  const f = fen.split(" ");
  return (Number(f[5]) - 1) * 2 + (f[1] === "w" ? 1 : 2);
};

export function PrepBoard({ step, rival, onDone, onNext, nextLabel = "Next" }: {
  step: PrepStep; rival: string; onDone: (o: Outcome) => void; onNext?: () => void; nextLabel?: string;
}) {
  const me = sideToMove(step.fen);
  const byUci = useMemo(() => new Map(step.moves.map((x) => [x.uci, x])), [step]);
  const answer = step.moves.find((x) => x.label === "best") ?? step.moves[0];
  const line = useMemo(() => ({ tokens: sanTokens(step.best_line_san), fens: replay(step.fen, step.best_line) }), [step]);
  const { status, wrong, miss, hint, found, playing, input, selected, showHint, reveal, ...f } = useFindMove(step.fen, byUci, answer, onDone);
  const [k, setK] = useState(0);   // stepping through Stockfish's line once it's over
  const retry = () => { f.retry(); setK(0); };
  const theirPly = nextPly(step.fen) - 1;
  const m = step.move;

  const fen = k ? line.fens[k - 1] ?? step.fen : found ? found.fen : status === "shown" ? line.fens[0] ?? step.fen : step.fen;
  const highlight = k ? { uci: step.best_line[k - 1], kind: bestKinds(k - 1) === "best" ? "best" as const : "them" as const }
    : found ? { uci: found.move.uci, kind: "you" as const }
    : status === "shown" ? { uci: answer.uci, kind: "best" as const }
    : { uci: m.uci, kind: "them" as const };
  const arrows = miss && playing ? [{ uci: miss.uci, kind: "them" as const }] : [];
  const lines = useMemo<RefLine[]>(() => (miss ? [{ fen: step.fen, ucis: [miss.uci], kind: myKinds }]
    : [{ fen: step.fen, ucis: step.best_line, kind: bestKinds }]), [miss, step]);
  const peek = usePeek(`${status}:${miss?.uci}:${k}`);

  const lost = (x: KeyMove) => (x.drop != null ? `${signed(-x.drop)} Win%` : "");
  const labelOf = (x: KeyMove) => (x.label ? LABEL[x.label] ?? x.label : "Not scored");
  const others = step.moves.filter((x) => x.label && FOUND.has(x.label) && x.uci !== answer.uci && x.uci !== found?.move.uci);

  return (
    <div className="puzzle key-moment">
      <div className="puzzle-board">
        <Board id={`prep-${theirPly}-${m.uci}`} fen={fen} orientation={me}
          label={`${rival} played ${m.san}: ${me === "white" ? "White" : "Black"} to move`}
          arrows={arrows} highlight={highlight} selected={selected} dots={input.dots} onDrop={input.onDrop} onSquare={input.onSquare}
          peek={peek.shown} marks={!playing} />
      </div>
      <div className="puzzle-side" aria-live="polite">
        <p className="puzzle-task">
          <span className={`turn ${me}`} aria-hidden="true" />
          Punish their <b className="san">{moveName(theirPly, m.san)}</b>
        </p>
        <p className="small">
          {step.opening ?? "In your opening"}: {rival} played it in {m.games} of {plural(step.reached, "game")} that reached this
          position, and Stockfish says it costs them <span className="num">{n1(m.drop ?? 0)}</span> Win%
          {m.label && m.label !== "book" ? <> ({LABEL[m.label] ?? m.label} <Nag severity={m.label} />)</> : null}.
          Your Win% here is <span className="num">{n1(step.win)}</span>.{playing && " Find the move that makes them pay."}
        </p>
        {playing && (
          <>
            {miss && (
              <div className="puzzle-miss">
                <p><b className="san">{miss.san}</b> is {miss.label === "inaccuracy" ? "an" : "a"} {labelOf(miss)} here ({lost(miss)}). Try another.</p>
                {miss.why && <p className="small"><RefText id="prep-miss" text={miss.why} lines={lines} me={me} peek={peek} /></p>}
              </div>
            )}
            <div className="puzzle-actions">
              <button type="button" className="btn ghost" onClick={showHint} disabled={hint}>Hint</button>
              <button type="button" className="btn ghost" onClick={reveal}>Show Stockfish's move</button>
            </div>
          </>
        )}
        {!playing && (
          <>
            <p className={`puzzle-result ${status === "found" ? "solved" : "revealed"}`}>
              {found ? <>{wrong || hint ? "Found, with help: " : "Found it: "}<b className="san">{found.move.san}</b> is {labelOf(found.move)}
                {found.move.win != null && <span className="num"> (your Win% {n1(found.move.win)})</span>}.</>
                : <>Stockfish's move here: <b className="san">{answer.san}</b>{answer.win != null && <span className="num"> (your Win% {n1(answer.win)})</span>}.</>}
            </p>
            {answer.why && <p className="puzzle-why"><RefText id="prep-why" text={answer.why} lines={lines} me={me} peek={peek} /></p>}
            <div className="label">Stockfish's line</div>
            <LineChips tokens={line.tokens} playable={line.fens.length === line.tokens.length} active={k ? k - 1 : null}
              onPick={(i) => setK(i + 1)} label="Stockfish's line" />
            {others.length > 0 && (
              <p className="small">
                Also good here:{" "}
                {others.map((x, i) => (
                  <span key={x.uci}>{i ? ", " : ""}<b className="san">{x.san}</b> <span className="muted">({labelOf(x)})</span></span>
                ))}.
              </p>
            )}
            <div className="puzzle-actions">
              <button type="button" className="btn ghost" onClick={retry}>Try it again</button>
              {onNext && <button type="button" className="btn" onClick={onNext}>{nextLabel} →</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
