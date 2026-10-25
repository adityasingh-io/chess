// A game's key moment (PLAN.md, reading 25): the position before the move where the game turned (else the move
// that let a win go, else my costliest move), to find a better move than the one I played. Every legal move there
// has a stored score from the settings each move of the game was scored with, so a move tried gets the label it
// would have got in the game: Best, Excellent or Good finds one; anything else snaps back with the Win% it loses
// and what Stockfish's line does after it. Hint marks the piece Stockfish's move moves; Show Stockfish's move
// ends it. Nothing here judges a move: the labels and the lines are stored.
import { useMemo, useRef, useState } from "react";
import { numberedLine, replay, sideToMove, tryMove } from "../lib/chess";
import type { Outcome } from "../lib/drill";
import { moveName, n1, sanTokens, signed } from "../lib/format";
import { useMoveInput } from "../lib/moveInput";
import { LABEL, SEV } from "../lib/names";
import { bestKinds, myKinds, type RefLine } from "../lib/refs";
import type { Game, KeyMove } from "../types/export";
import { LineChips, Nag } from "./bits";
import { Board, type ArrowKind, type HighlightKind } from "./Board";
import { RefText, usePeek } from "./RefText";

/** The labels that find a better move: less than 5 Win% lost (config.toml, analysis.labels). */
const FOUND = new Set(["best", "excellent", "good"]);
export const KEY_KIND = {
  turning: "The move this loss turned on",
  thrown: "The move that let a winning game go",
  costliest: "Your costliest move in this game",
} as const;

type Status = "play" | "found" | "shown";
/** Stepping through a line once it's over: Stockfish's, or my move in the game and its answer. */
type View = { line: "best" | "played"; k: number };
type Line = { ucis: string[]; tokens: string[]; fens: string[] };
const asHighlight = (k: ArrowKind): HighlightKind => (k === "live" ? "them" : k);

export function KeyMomentBoard({ g, onDone, onNext, nextLabel = "Next", onWhole }: {
  g: Game; onDone: (o: Outcome) => void; onNext?: () => void; nextLabel?: string; onWhole?: () => void;
}) {
  const km = g.key!;
  const r = g.records.find((x) => x.id === km.record)!;
  const me = sideToMove(km.fen);
  const byUci = useMemo(() => new Map(km.moves.map((x) => [x.uci, x])), [km]);
  // Stockfish's move: the record's best, whose line is the deeper one the viewer shows, when its stored label
  // finds a better move; otherwise the move pass 1 ranks best.
  const recBest = r.best ? byUci.get(r.best) : undefined;
  const answer = (recBest?.label && FOUND.has(recBest.label) ? recBest : undefined)
    ?? km.moves.find((x) => x.label === "best") ?? km.moves[0];
  const best = useMemo<Line>(() => {
    const deep = answer.uci === r.best && r.best_line.length > 0;
    const ucis = deep ? r.best_line : [answer.uci];
    return { ucis, tokens: deep ? sanTokens(r.best_line_san) : numberedLine(km.fen, [answer.san]), fens: replay(km.fen, ucis) };
  }, [answer, r, km.fen]);
  const played = useMemo<Line>(() => {
    const ucis = [r.uci, ...r.reply_line];
    return { ucis, tokens: [moveName(km.ply, r.san), ...sanTokens(r.reply_line_san)], fens: replay(km.fen, ucis) };
  }, [r, km]);
  const prev = km.ply >= 2 ? g.moves[km.ply - 2] : undefined;   // the opponent's move before mine
  const others = km.moves.filter((x) => x.label && FOUND.has(x.label) && x.uci !== answer.uci);

  const [status, setStatus] = useState<Status>("play");
  const [wrong, setWrong] = useState(0);
  const [miss, setMiss] = useState<KeyMove | null>(null);
  const [hint, setHint] = useState(false);
  const [found, setFound] = useState<{ move: KeyMove; fen: string } | null>(null);
  const [view, setView] = useState<View | null>(null);
  const reported = useRef(false);

  const finish = (s: Status, o: Outcome) => {
    setStatus(s);
    setMiss(null);
    if (!reported.current) { reported.current = true; onDone(o); }
  };
  const onMove = (from: string, to: string) => {
    if (status !== "play") return false;
    const mv = tryMove(km.fen, from, to, answer.uci.startsWith(from + to) ? answer.uci[4] : undefined);
    const x = mv ? byUci.get(mv.uci) : undefined;
    if (!mv || !x) return false;
    if (x.label && FOUND.has(x.label)) {
      setFound({ move: x, fen: mv.fen });
      finish("found", { solved: true, wrong, hint, revealed: false });
      return true;
    }
    setWrong((w) => w + 1);
    setMiss(x);
    return false;
  };
  const playing = status === "play";
  const input = useMoveInput(km.fen, playing, onMove);
  const reveal = () => finish("shown", { solved: false, wrong, hint, revealed: true });
  const retry = () => { setStatus("play"); setFound(null); setView(null); setMiss(null); setHint(false); };

  const line = view ? (view.line === "best" ? best : played) : null;
  const fen = line && view!.k ? line.fens[view!.k - 1] ?? km.fen : view ? km.fen
    : found ? found.fen : status === "shown" ? best.fens[0] ?? km.fen : km.fen;
  const highlight = line && view!.k ? { uci: line.ucis[view!.k - 1], kind: asHighlight((view!.line === "best" ? bestKinds : myKinds)(view!.k - 1)) }
    : view ? (prev ? { uci: prev.uci, kind: "them" as const } : null)
    : found ? { uci: found.move.uci, kind: "you" as const }
    : status === "shown" ? { uci: answer.uci, kind: "best" as const }
    : prev ? { uci: prev.uci, kind: "them" as const } : null;
  const arrows = miss && playing ? [{ uci: miss.uci, kind: "them" as const }] : [];
  const selected = hint && playing ? answer.uci.slice(0, 2) : input.selected;

  // The lines a text names moves from: a move tried (its why names it, then Stockfish's answer), or once it's over
  // Stockfish's line and mine.
  const lines = useMemo<RefLine[]>(() => (miss ? [{ fen: km.fen, ucis: [miss.uci], kind: myKinds }] : [
    { fen: km.fen, ucis: best.ucis, kind: bestKinds }, { fen: km.fen, ucis: played.ucis, kind: myKinds },
    ...(found && found.move.uci !== answer.uci ? [{ fen: km.fen, ucis: [found.move.uci], kind: myKinds }] : []),
  ]), [miss, km.fen, best, played, found, answer]);
  const peek = usePeek(`${status}:${miss?.uci}:${view?.line}:${view?.k}`);

  const lost = (x: KeyMove) => (x.drop != null ? `${signed(-x.drop)} Win%` : "");
  const labelOf = (x: KeyMove) => (x.label ? LABEL[x.label] ?? x.label : "Not scored");
  const game = (
    <><b className="san">{moveName(km.ply, r.san)}</b> <Nag severity={r.severity} /></>
  );
  const chips = (key: View["line"], l: Line, label: string) => (
    <LineChips tokens={l.tokens} playable={l.fens.length === l.tokens.length} active={view?.line === key && view.k ? view.k - 1 : null}
      onPick={(i) => setView({ line: key, k: i + 1 })} label={label} />
  );

  return (
    <div className="puzzle key-moment">
      <div className="puzzle-board">
        <Board id={`key-${g.id}`} fen={fen} orientation={me}
          label={`${KEY_KIND[km.kind]}: ${me === "white" ? "White" : "Black"} to move`}
          arrows={arrows} highlight={highlight} selected={selected} dots={input.dots} onDrop={input.onDrop} onSquare={input.onSquare}
          peek={peek.shown} marks={!playing} />
      </div>
      <div className="puzzle-side" aria-live="polite">
        <p className="puzzle-task">
          <span className={`turn ${me}`} aria-hidden="true" />
          {KEY_KIND[km.kind]}.
        </p>
        <p className="small">
          {prev ? <>After <b className="san">{moveName(km.ply - 1, prev.san)}</b> you</> : "You"} played {game}: {SEV[r.severity]},
          your Win% <span className="num">{n1(r.win_before)} → {n1(r.win_after)}</span>.
          {playing && " Find a better move."}
        </p>
        {playing && (
          <>
            {miss && (
              <div className="puzzle-miss">
                <p>
                  {miss.uci === r.uci ? <>That's {game}, the move you played.</>
                    : <><b className="san">{miss.san}</b> is {miss.label === "inaccuracy" ? "an" : "a"} {labelOf(miss)} here ({lost(miss)}). Try another.</>}
                </p>
                {miss.uci !== r.uci && miss.why && <p className="small"><RefText id="key-miss" text={miss.why} lines={lines} me={me} peek={peek} /></p>}
              </div>
            )}
            <div className="puzzle-actions">
              <button type="button" className="btn ghost" onClick={() => setHint(true)} disabled={hint}>Hint</button>
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
            <p className="puzzle-why"><RefText id="key-why" text={r.note ?? r.explanation} lines={lines} me={me} peek={peek} /></p>
            <div className="label">Stockfish's line</div>
            {chips("best", best, "Stockfish's line")}
            <div className="label">Your move in the game, then Stockfish</div>
            {chips("played", played, "Your move in the game, then Stockfish's line")}
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
              {onWhole && <button type="button" className="btn ghost" onClick={onWhole}>Review the whole game</button>}
              {onNext && <button type="button" className="btn" onClick={onNext}>{nextLabel} →</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
