// Convert the win: positions from my games where Stockfish had me winning and the game got away, and three
// textbook mates, played out against the in-browser Stockfish. The start positions and their Win% are
// stored pass-1 facts; the other side's moves are Stockfish's, played live and never stored or shown as
// analysis; the result is the rules' (checkmate, stalemate, repetition, fifty moves, insufficient material).
import { Chess } from "chess.js";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Board } from "../components/Board";
import { numberedLine, sideToMove, tryMove, uciParts, type Side } from "../lib/chess";
import { readJson, readTally, thrownStarts, WINNING, writeJson, writeTally, type Start, type Tally } from "../lib/convert";
import { useLosses } from "../lib/data";
import { moveName, n1, plural } from "../lib/format";
import { useMoveInput } from "../lib/moveInput";
import { useOpponent } from "../lib/opponent";

const PAGE = 15;
const REPLY_MS = 250;
const SKILLS: [number, string][] = [[20, "Full strength"], [10, "Skill 10 of 20"], [3, "Skill 3 of 20"]];
const SKILL_KEY = "coach-convert-skill";

type End = { won: boolean; text: string };

const MATES: Start[] = [
  { id: "mate-queen", fen: "8/8/8/3k4/8/8/8/Q3K3 w - - 0 1", colour: "white", title: "King and queen against king" },
  { id: "mate-rook", fen: "8/8/8/3k4/8/8/8/R3K3 w - - 0 1", colour: "white", title: "King and rook against king" },
  { id: "mate-rooks", fen: "8/8/8/3k4/8/8/8/R3K2R w - - 0 1", colour: "white", title: "Two rooks against king" },
];

/** The rules' verdict on a finished game, from `me`'s side; null while it goes on. */
export function verdict(g: Chess, me: Side): End | null {
  if (g.isCheckmate()) {
    const won = g.turn() !== me[0];
    return { won, text: won ? "Checkmate. You won it again." : "Stockfish checkmated you." };
  }
  if (g.isStalemate()) return { won: false, text: "Stalemate: the side to move has no legal move and isn't in check, so it's a draw." };
  if (g.isThreefoldRepetition()) return { won: false, text: "Draw by threefold repetition." };
  if (g.isInsufficientMaterial()) return { won: false, text: "Draw: neither side has enough material left to checkmate." };
  if (g.isDrawByFiftyMoves()) return { won: false, text: "Draw by the fifty-move rule: fifty moves each without a capture or a pawn move." };
  return null;
}

export default function Convert() {
  const losses = useLosses();
  const [params, setParams] = useSearchParams();
  const [skill, setSkillState] = useState(() => readJson<number>(SKILL_KEY, 10));
  const [tally, setTally] = useState(readTally);
  const [shown, setShown] = useState(PAGE);
  const starts = thrownStarts(losses.thrown);
  // ?play=<id> opens one position (the game viewer and the dashboard link here).
  const playing = [...starts, ...MATES].find((s) => s.id === params.get("play")) ?? null;
  const setPlaying = (s: Start | null) => setParams(s ? { play: s.id } : {});
  const setSkill = (s: number) => { setSkillState(s); writeJson(SKILL_KEY, s); };
  const record = (id: string, won: boolean) => {
    const t = tally[id] ?? { tries: 0, wins: 0, last: 0 };
    const next = { ...tally, [id]: { tries: t.tries + 1, wins: t.wins + (won ? 1 : 0), last: Date.now() } };
    setTally(next);
    writeTally(next);
  };

  if (playing) {
    return <Play key={`${playing.id}-${skill}`} start={playing} skill={skill} onEnd={(won) => record(playing.id, won)} onBack={() => setPlaying(null)} />;
  }
  const won = starts.filter((s) => tally[s.id]?.wins).length;
  return (
    <>
      <div className="page-head">
        <h1>Convert the win</h1>
        <p className="muted">
          Positions from your games where Stockfish had you at {WINNING}% or more and the game got away. Play each one out
          against the in-browser Stockfish until you checkmate it.
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
      <section className="card">
        <div className="card-head">
          <h2>From your games</h2>
          <span className="muted small">{won} of {plural(starts.length, "position")} won again</span>
        </div>
        {starts.length ? (
          <div className="rows">
            {starts.slice(0, shown).map((s) => <StartRow key={s.id} start={s} tally={tally[s.id]} onPlay={() => setPlaying(s)} />)}
          </div>
        ) : (
          <div className="empty">No thrown wins yet.</div>
        )}
        {shown < starts.length && (
          <button type="button" className="btn ghost" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, starts.length - shown)} more</button>
        )}
      </section>
      <section className="card">
        <div className="card-head"><h2>Mating practice</h2></div>
        <p className="muted small" style={{ margin: 0 }}>The lone king against Stockfish. Checkmate it before the fifty-move rule, without stalemating it.</p>
        <div className="rows">
          {MATES.map((s) => <StartRow key={s.id} start={s} tally={tally[s.id]} onPlay={() => setPlaying(s)} />)}
        </div>
      </section>
    </>
  );
}

function StartRow({ start, tally, onPlay }: { start: Start; tally?: Tally; onPlay: () => void }) {
  const t = start.thrown;
  return (
    <button type="button" className="row convert-row" onClick={onPlay}>
      <span className="t">{start.title}</span>
      <span className="s">
        {t ? <>Stockfish had you at <span className="num">{n1(t.win_before!)}%</span> as {start.colour}; the game was a {t.result}</> : `You're ${start.colour}`}
      </span>
      <span className="r">
        {tally?.wins ? <span className="pill due">won</span> : tally?.tries ? <span className="pill">tried {tally.tries}×</span> : null}
        <span aria-hidden="true"> ›</span>
      </span>
    </button>
  );
}

function Play({ start, skill, onEnd, onBack }: { start: Start; skill: number; onEnd: (won: boolean) => void; onBack: () => void }) {
  const me = start.colour;
  const game = useRef(new Chess(start.fen));
  const [fen, setFen] = useState(start.fen);
  const [sans, setSans] = useState<string[]>([]);
  const [last, setLast] = useState<{ uci: string; mine: boolean } | null>(null);
  const [thinking, setThinking] = useState(false);
  const [end, setEnd] = useState<End | null>(null);
  const epoch = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  const opponent = useOpponent(skill);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const apply = (uci: string, mine: boolean) => {
    const p = uciParts(uci);
    const m = game.current.move({ from: p.from, to: p.to, promotion: p.promotion });
    setFen(game.current.fen());
    setSans((s) => [...s, m.san]);
    setLast({ uci, mine });
    const v = verdict(game.current, me);
    if (v) { setEnd(v); onEnd(v.won); }
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

  // A start position with the other side to move (none so far) begins with Stockfish's move.
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
    setEnd({ won: false, text: "You stopped this one." });
    onEnd(false);
  };

  const input = useMoveInput(fen, myTurn, onMove);
  const t = start.thrown;
  const side = me === "white" ? "White" : "Black";
  return (
    <>
      <div className="page-head">
        <h1>Convert the win</h1>
        <p className="muted">{start.title}</p>
      </div>
      <div className="puzzle">
        <div className="puzzle-board">
          <Board id={`convert-${start.id}`} fen={fen} orientation={me} label={`Convert the win: you are ${side}`}
            highlight={last ? { uci: last.uci, kind: last.mine ? "you" : "them" } : null}
            selected={input.selected} dots={input.dots} onDrop={input.onDrop} onSquare={input.onSquare} />
        </div>
        <div className="puzzle-side" aria-live="polite">
          {t && (
            <p className="small" style={{ margin: 0 }}>
              Stockfish had you at <b className="num">{n1(t.win_before!)}%</b> here (stored analysis).
            </p>
          )}
          {!end && (
            <p className="puzzle-task">
              <span className={`turn ${me}`} aria-hidden="true" />
              {thinking ? "Stockfish is thinking…" : `You're ${side}, to move. Checkmate Stockfish to win it.`}
            </p>
          )}
          {opponent.failed && <p className="small bad-text" role="alert">The in-browser engine failed to load.</p>}
          {end && <p className={`puzzle-result ${end.won ? "solved" : "revealed"}`}>{end.text}</p>}
          {end && t && t.ply && (
            <p className="small">
              In the game you played <b className="san">{moveName(t.ply, t.san ?? "?")}</b> here
              {t.drop != null && <span className="num"> (−{n1(t.drop)} Win%)</span>}, and it ended in a {t.result}.{" "}
              <Link to={`/games/${t.game}?ply=${t.ply}&compare=1`}>Open it in the game →</Link>
            </p>
          )}
          {sans.length > 0 && (
            <p className="small san convert-moves" aria-label="Moves played">{numberedLine(start.fen, sans).join(" ")}</p>
          )}
          <div className="puzzle-actions">
            {end
              ? <button type="button" className="btn" onClick={restart}>Play it again</button>
              : <button type="button" className="btn ghost" onClick={stop} disabled={!sans.length}>Stop</button>}
            {!end && sans.length > 0 && <button type="button" className="btn ghost" onClick={restart}>Start over</button>}
            <button type="button" className="btn ghost" onClick={onBack}>All positions</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            <span className="live-badge">LIVE</span> Stockfish 19 lite in this browser, {SKILLS.find(([s]) => s === skill)?.[1].toLowerCase()}.
          </p>
        </div>
      </div>
    </>
  );
}
