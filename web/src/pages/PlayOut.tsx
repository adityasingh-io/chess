// Play it out: positions from my games played on against the in-browser Stockfish. Wins that got away
// (the position before the move that threw each one), games I resigned or abandoned while still playable
// (the position they ended in), endgames I spoiled (the position before the spoiling move), and three
// textbook mates. Start positions and their Win% are stored pass-1
// facts; the other side's moves are Stockfish's, played live and never stored or shown as analysis; the
// result is the rules' (checkmate, stalemate, repetition, fifty moves, insufficient material).
import { Chess } from "chess.js";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { Board } from "../components/Board";
import { numberedLine, sideToMove, tryMove, uciParts, type Side } from "../lib/chess";
import { useEndgames, useLosses } from "../lib/data";
import { moveName, n1, plural } from "../lib/format";
import { useMoveInput } from "../lib/moveInput";
import { useOpponent } from "../lib/opponent";
import {
  ENDGAME_LOSING, ENDGAME_WINNING, endgameStarts, PLAYABLE, reached, readSkill, readTally, recordTry, resignedStarts, SKILLS,
  thrownStarts, WINNING, writeSkill, type Start, type Tally,
} from "../lib/playout";

const PAGE = 10;
const REPLY_MS = 250;

export type Result = "win" | "draw" | "loss";
type End = { result: Result; text: string };

const MATES: Start[] = [
  { id: "mate-queen", kind: "mate", fen: "8/8/8/3k4/8/8/8/Q3K3 w - - 0 1", colour: "white", title: "King and queen against king", win: null, need: "win" },
  { id: "mate-rook", kind: "mate", fen: "8/8/8/3k4/8/8/8/R3K3 w - - 0 1", colour: "white", title: "King and rook against king", win: null, need: "win" },
  { id: "mate-rooks", kind: "mate", fen: "8/8/8/3k4/8/8/8/R3K2R w - - 0 1", colour: "white", title: "Two rooks against king", win: null, need: "win" },
];
const goal = (s: Start) =>
  s.kind === "mate" ? "Checkmate the lone king." : s.need === "win" ? "Checkmate Stockfish to win it." : "Don't lose: a draw or a win saves it.";
const done = (s: Start) =>
  s.kind === "mate" ? "Done." : s.kind === "thrown" ? "You won it again." : s.kind === "resigned" ? "You saved a game you gave up."
    : s.need === "win" ? "You converted it this time." : "You held it this time.";

/** The rules' verdict on a finished game, from `me`'s side; null while it goes on. */
export function verdict(g: Chess, me: Side): End | null {
  if (g.isCheckmate()) {
    const won = g.turn() !== me[0];
    return { result: won ? "win" : "loss", text: won ? "Checkmate: you won." : "Stockfish checkmated you." };
  }
  if (g.isStalemate()) return { result: "draw", text: "Stalemate: the side to move has no legal move and isn't in check, so it's a draw." };
  if (g.isThreefoldRepetition()) return { result: "draw", text: "Draw by threefold repetition." };
  if (g.isInsufficientMaterial()) return { result: "draw", text: "Draw: neither side has enough material left to checkmate." };
  if (g.isDrawByFiftyMoves()) return { result: "draw", text: "Draw by the fifty-move rule: fifty moves each without a capture or a pawn move." };
  return null;
}

export default function PlayOut() {
  const losses = useLosses();
  const [params, setParams] = useSearchParams();
  const { hash } = useLocation();
  const [skill, setSkillState] = useState(readSkill);
  const [tally, setTally] = useState(readTally);
  const endgames = useEndgames();
  const thrown = thrownStarts(losses.thrown), resigned = resignedStarts(losses.losses);
  const spoiled = endgameStarts(endgames.endgames, losses.thrown);
  // ?play=<id> opens one position (the dashboard, the game viewer and the Endgames page link here).
  const playing = [...thrown, ...resigned, ...spoiled, ...MATES].find((s) => s.id === params.get("play")) ?? null;
  const setPlaying = (s: Start | null) => setParams(s ? { play: s.id } : {});
  // /play#endgames (from the Endgames page) opens at that list.
  useEffect(() => { if (hash && !playing) document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: "start" }); }, [hash, playing]);
  const setSkill = (s: number) => { setSkillState(s); writeSkill(s); };
  const record = (id: string, ok: boolean) => setTally(recordTry(id, ok));

  if (playing) {
    return <Play key={`${playing.id}-${skill}`} start={playing} skill={skill} onEnd={(ok) => record(playing.id, ok)} onBack={() => setPlaying(null)} />;
  }
  return (
    <>
      <div className="page-head">
        <h1>Play it out</h1>
        <p className="muted">
          Positions from your games, played on against the in-browser Stockfish: wins that got away, games you gave
          up while they were still playable, and endgames you spoiled.
        </p>
      </div>
      <section className="card">
        <div className="card-head"><h2>Opponent</h2><span className="live-badge">LIVE</span></div>
        <span className="seg" role="group" aria-label="Stockfish strength">
          {SKILLS.map(([s, label]) => <button key={s} type="button" aria-pressed={skill === s} onClick={() => setSkill(s)}>{label}</button>)}
        </span>
        <p className="muted small" style={{ margin: 0 }}>
          Skill Level is Stockfish's own setting; lower levels sometimes pick weaker moves on purpose. Its moves are played,
          never stored. Results stay on this device.
        </p>
      </section>
      <StartList title="Wins that got away" starts={thrown} tally={tally} onPlay={setPlaying} done="won again"
        what={`The position before the move that threw each win, where Stockfish had you at ${WINNING}% or more. Checkmate Stockfish to win it again.`} />
      <StartList title="Games you gave up" starts={resigned} tally={tally} onPlay={setPlaying} done="saved"
        what={`Losses you resigned or abandoned while Stockfish still had you at ${PLAYABLE}% or more, from where they ended. A draw or a win saves it.`} />
      <StartList id="endgames" title="Endgames you spoiled" starts={spoiled} tally={tally} onPlay={setPlaying} done="redone"
        what={`From just before the move that spoiled each one. Where Stockfish had you at ${ENDGAME_WINNING}% or more, win it; between ${ENDGAME_LOSING}% and ${ENDGAME_WINNING}%, a draw or a win holds it, unless it's also a win that got away. Ones already lost before that move are left out.`} />
      <StartList title="Mating practice" starts={MATES} tally={tally} onPlay={setPlaying} done="done"
        what="The lone king against Stockfish. Checkmate it before the fifty-move rule, without stalemating it." />
    </>
  );
}

function StartList({ id, title, what, starts, tally, onPlay, done }: {
  id?: string; title: string; what: string; starts: Start[]; tally: { [id: string]: Tally }; onPlay: (s: Start) => void; done: string;
}) {
  const [shown, setShown] = useState(PAGE);
  const ok = starts.filter((s) => tally[s.id]?.reached).length;
  return (
    <section className="card" id={id}>
      <div className="card-head">
        <h2>{title}</h2>
        {starts.length > 0 && <span className="muted small">{ok} of {plural(starts.length, "position")} {done}</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>{what}</p>
      {starts.length ? (
        <div className="rows">
          {starts.slice(0, shown).map((s) => <StartRow key={s.id} start={s} tally={tally[s.id]} done={done} onPlay={() => onPlay(s)} />)}
        </div>
      ) : (
        <div className="empty">None so far.</div>
      )}
      {shown < starts.length && (
        <button type="button" className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, starts.length - shown)} more</button>
      )}
    </section>
  );
}

function StartRow({ start, tally, done, onPlay }: { start: Start; tally?: Tally; done: string; onPlay: () => void }) {
  const side = start.colour === "white" ? "White" : "Black";
  return (
    <button type="button" className="row playout-row" onClick={onPlay}>
      <span className="t">{start.title}</span>
      <span className="s">
        {start.win != null ? <>{side} · Stockfish had you at <span className="num">{n1(start.win)}%</span></> : `You're ${side}`}
        {start.thrown && <> · the game was a {start.thrown.result}</>}
        {start.endgame && <> · {start.need === "win" ? "win it" : "hold it"} · the game was a {start.endgame.result}</>}
      </span>
      <span className="r">
        {tally?.reached ? <span className="pill due">{done}</span> : tally?.tries ? <span className="pill">tried {tally.tries}×</span> : null}
        <span aria-hidden="true"> ›</span>
      </span>
    </button>
  );
}

/** One position played on. `embedded` (the Today session) leaves out the page heading, and `back` names the button
    that leaves it. */
export function Play({ start, skill, onEnd, onBack, embedded = false, back = "All positions" }: {
  start: Start; skill: number; onEnd: (ok: boolean) => void; onBack: () => void; embedded?: boolean; back?: string;
}) {
  const me = start.colour;
  const game = useRef(new Chess(start.fen));
  const [fen, setFen] = useState(start.fen);
  const [sans, setSans] = useState<string[]>([]);
  const [last, setLast] = useState<{ uci: string; mine: boolean } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [end, setEnd] = useState<(End & { ok: boolean }) | null>(null);
  const epoch = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const opponent = useOpponent(skill);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const finish = (e: End) => {
    const ok = reached(start.need, e.result);
    setEnd({ ...e, ok });
    onEnd(ok);
  };
  const apply = (uci: string, mine: boolean) => {
    const p = uciParts(uci);
    const m = game.current.move({ from: p.from, to: p.to, promotion: p.promotion });
    setFen(game.current.fen());
    setSans((s) => [...s, m.san]);
    setLast({ uci, mine });
    const v = verdict(game.current, me);
    if (v) finish(v);
    return v;
  };

  const reply = useEffectEvent(() => {
    const mine = epoch.current;
    setThinking(true);
    timer.current = window.setTimeout(() => {
      void opponent.move(game.current.fen()).then((uci) => {
        if (mine !== epoch.current) return;
        setThinking(false);
        if (uci) apply(uci, false);
      });
    }, REPLY_MS);
  });

  // A game that ended on the opponent's turn goes on with Stockfish's move.
  useEffect(() => { if (sideToMove(start.fen) !== me) reply(); }, [start.fen, me]);

  const myTurn = !end && !thinking && sideToMove(fen) === me;
  const onMove = (from: string, to: string) => {
    if (!myTurn) return false;
    const mv = tryMove(fen, from, to);
    if (!mv) return false;
    if (!apply(mv.uci, true)) reply();
    return true;
  };
  const restart = () => {
    epoch.current++;
    window.clearTimeout(timer.current);
    game.current = new Chess(start.fen);
    setFen(start.fen); setSans([]); setLast(null); setThinking(false); setEnd(null);
    if (sideToMove(start.fen) !== me) reply();
  };
  const stop = () => {
    epoch.current++;
    window.clearTimeout(timer.current);
    setThinking(false);
    setEnd({ result: "loss", text: "You stopped this one.", ok: false });
    onEnd(false);
  };

  const input = useMoveInput(fen, myTurn, onMove);
  const t = start.thrown, l = start.loss, eg = start.endgame;
  const side = me === "white" ? "White" : "Black";
  return (
    <>
      {!embedded && (
        <div className="page-head">
          <h1>Play it out</h1>
          <p className="muted">{start.title}</p>
        </div>
      )}
      <div className="puzzle">
        <div className="puzzle-board">
          <Board id={`playout-${start.id}`} fen={fen} orientation={me} label={`Play it out: you are ${side}`}
            highlight={last ? { uci: last.uci, kind: last.mine ? "you" : "them" } : null}
            selected={input.selected} dots={input.dots} onDrop={input.onDrop} onSquare={input.onSquare} />
        </div>
        <div className="puzzle-side" aria-live="polite">
          {start.win != null && (
            <p className="small" style={{ margin: 0 }}>
              Stockfish had you at <b className="num">{n1(start.win)}%</b> here (stored analysis).
              {l && " This is where you gave the game up."}
              {eg && " This is just before the move that spoiled the endgame."}
            </p>
          )}
          {!end && (
            <p className="puzzle-task">
              <span className={`turn ${me}`} aria-hidden="true" />
              {thinking ? "Stockfish is thinking…" : `You're ${side}, to move. ${goal(start)}`}
            </p>
          )}
          {opponent.failed && <p className="small bad-text" role="alert">The in-browser engine failed to load.</p>}
          {end && (
            <p className={`puzzle-result ${end.ok ? "solved" : "revealed"}`}>
              {end.text}{end.ok && ` ${done(start)}`}
            </p>
          )}
          {end && t && t.ply && (
            <p className="small">
              In the game you played <b className="san">{moveName(t.ply, t.san ?? "?")}</b> here
              {t.drop != null && <span className="num"> (−{n1(t.drop)} Win%)</span>}, and it ended in a {t.result}.{" "}
              <Link to={`/games/${t.game}?ply=${t.ply}&compare=1`}>Open it in the game →</Link>
            </p>
          )}
          {end && l && (
            <p className="small"><Link to={`/games/${l.game}`}>Open the game →</Link></p>
          )}
          {end && eg && (
            <p className="small">
              In the game you played <b className="san">{moveName(eg.info.spoiler_ply!, eg.info.spoiler_san ?? "?")}</b> here
              {eg.info.spoiler_drop != null && <span className="num"> (−{n1(eg.info.spoiler_drop)} Win%)</span>}, and it ended in a {eg.result}.{" "}
              <Link to={`/games/${eg.game}?ply=${eg.info.spoiler_ply}&compare=1`}>Open it in the game →</Link>
            </p>
          )}
          {sans.length > 0 && (
            <p className="small san playout-moves" aria-label="Moves played">{numberedLine(start.fen, sans).join(" ")}</p>
          )}
          <div className="puzzle-actions">
            {end
              ? <button type="button" className="btn" onClick={restart}>Play it again</button>
              : <button type="button" className="btn ghost" onClick={stop} disabled={!sans.length}>Stop</button>}
            {!end && sans.length > 0 && <button type="button" className="btn ghost" onClick={restart}>Start over</button>}
            <button type="button" className="btn ghost" onClick={onBack}>{back}</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            <span className="live-badge">LIVE</span> Stockfish 19 lite in this browser, {SKILLS.find(([s]) => s === skill)?.[1].toLowerCase()}.
          </p>
        </div>
      </div>
    </>
  );
}
