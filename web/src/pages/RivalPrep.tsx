// The prep session before playing a rival (lib/prep.ts): their likely line against each of my colours, the costly
// moves of theirs in my openings to punish, then my key moments against them. The step is kept in the URL
// (?step=n), so a reload carries on. A key moment's answer schedules its next review, as it does everywhere; a
// punish step counts for this session only.
import { Suspense, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Boundary, Loading } from "../components/AppShell";
import { Board } from "../components/Board";
import { LineChips, Nag } from "../components/bits";
import { KeyMomentBoard } from "../components/KeyMoment";
import { PrepBoard } from "../components/PrepBoard";
import { numberedLine, replay, type Side } from "../lib/chess";
import { useGame, useOpenings, useRival, useRivals } from "../lib/data";
import { recordKey, type Outcome } from "../lib/drill";
import { day, moveName, n1, plural } from "../lib/format";
import { START } from "../lib/lines";
import { LABEL, RESULT_WORD } from "../lib/names";
import { PART, prepLineId, prepPlan, prepSections, type LineMove, type PrepItem } from "../lib/prep";
import { activeLines, addLine, useProgress } from "../lib/progress";
import { markOf, type Mark } from "../lib/today";
import type { HeadToHead, Rival } from "../types/export";

const NAME = { white: "White", black: "Black" } as const;

export default function RivalPrep() {
  const { name = "" } = useParams();
  const h = useRivals().rivals.find((r) => r.username.toLowerCase() === name.toLowerCase());
  if (!h) return <div className="problem"><b>No rival called “{name}”.</b><Link to="/rivals">All rivals</Link></div>;
  return (
    <Boundary reset={h.username} fallback={
      <div className="problem"><b>{h.username}'s own games haven't been fetched yet.</b><Link to={`/rivals/${h.username}`}>Back to {h.username}</Link></div>
    }>
      <Session key={h.username} h={h} />
    </Boundary>
  );
}

function Session({ h }: { h: HeadToHead }) {
  const r = useRival(h.username);
  const white = useOpenings("white"), black = useOpenings("black");
  const items = useMemo(() => prepPlan(h, r, { white, black }), [h, r, white, black]);
  const [params, setParams] = useSearchParams();
  const at = Math.min(Math.max(Math.floor(Number(params.get("step"))) || 0, 0), items.length);
  const go = (n: number) => {
    const next = new URLSearchParams(params);
    if (n) next.set("step", String(n)); else next.delete("step");
    setParams(next, { replace: true });
  };
  const [marks, setMarks] = useState<(Mark | null)[]>(() => items.map(() => null));
  const item = items[at];
  const nextLabel = at + 1 < items.length ? "Next" : "Finish";
  const onDone = (o: Outcome) => setMarks((ms) => ms.map((m, i) => (i === at ? markOf(o) : m)));
  const again = () => { setMarks(items.map(() => null)); go(0); };

  return (
    <>
      <div className="page-head">
        <h1>Prepare for {h.username}</h1>
        <p className="muted">
          What they're likely to play against you, the costly moves of theirs in your openings to punish, then your key
          moments against them.
        </p>
      </div>
      {items.length > 0 && (
        <ol className="today-steps" aria-label="Prep session">
          {prepSections(items, at).map((s) => (
            <li key={s.part} className={s.done === s.count ? "done" : at >= s.from ? "now" : ""}>
              <b>{PART[s.part]}</b> <span className="num">{s.done} of {s.count}</span>
            </li>
          ))}
        </ol>
      )}
      <section className="card puzzle-card" aria-label="Prep step">
        {item ? (
          <>
            <div className="card-head">
              <h2>{title(item, h, r)}</h2>
              <span className="muted small num">Step {at + 1} of {items.length}</span>
            </div>
            <Suspense fallback={<Loading what="Loading the game" />}>
              <Step key={at} item={item} r={r} rival={h.username} nextLabel={nextLabel} onDone={onDone} onNext={() => go(at + 1)} />
            </Suspense>
            {item.kind !== "line" && (
              <div className="today-skip"><button type="button" className="linkish small" onClick={() => go(at + 1)}>Skip this step</button></div>
            )}
          </>
        ) : <Done h={h} marks={marks} empty={!items.length} onAgain={again} />}
      </section>
    </>
  );
}

function title(x: PrepItem, h: HeadToHead, r: Rival) {
  if (x.kind === "line") return `Their likely line when you're ${NAME[x.you]}`;
  if (x.kind === "punish") return `Punish: ${r.prep[x.index].opening ?? "your opening"}`;
  const g = h.games.find((y) => y.id === x.game);
  return `Your key moment · ${g ? `${day(g.ts)}, ${RESULT_WORD[g.result].toLowerCase()} as ${NAME[g.colour]}` : "a game against them"}`;
}

function Step({ item, r, rival, nextLabel, onDone, onNext }: {
  item: PrepItem; r: Rival; rival: string; nextLabel: string; onDone: (o: Outcome) => void; onNext: () => void;
}) {
  if (item.kind === "line") return <LikelyLine you={item.you} moves={item.moves} rival={rival} nextLabel={nextLabel} onNext={onNext} />;
  if (item.kind === "punish") return <PrepBoard step={r.prep[item.index]} rival={rival} onDone={onDone} onNext={onNext} nextLabel={nextLabel} />;
  return <KeyStep game={item.game} ply={item.ply} nextLabel={nextLabel} onDone={onDone} onNext={onNext} />;
}

function KeyStep({ game, ply, nextLabel, onDone, onNext }: {
  game: string; ply: number; nextLabel: string; onDone: (o: Outcome) => void; onNext: () => void;
}) {
  const g = useGame(game);
  if (g.key?.ply !== ply) {
    return <div className="empty">This key moment isn't in the data any more. <button type="button" className="btn ghost" onClick={onNext}>Go on</button></div>;
  }
  return <KeyMomentBoard g={g} onDone={(o) => { recordKey(g, o); onDone(o); }} onNext={onNext} nextLabel={nextLabel} />;
}

// Steps through the likely line on a board; each move says how often it was played from there, and their moves
// what Stockfish says of them. "Drill it" adds the line to the repertoire trainer.
function LikelyLine({ you, moves, rival, nextLabel, onNext }: {
  you: Side; moves: LineMove[]; rival: string; nextLabel: string; onNext: () => void;
}) {
  const ucis = useMemo(() => moves.map((m) => m.uci), [moves]);
  const fens = useMemo(() => replay(START, ucis), [ucis]);
  const tokens = useMemo(() => numberedLine(START, moves.map((m) => m.san)), [moves]);
  const [k, setK] = useState(0);
  const cur = k ? moves[k - 1] : null;
  const id = prepLineId(rival, you, ucis);
  const added = activeLines(useProgress()).some((l) => l.id === id);
  return (
    <div className="puzzle">
      <div className="puzzle-board">
        <Board id={`prep-line-${you}`} fen={k ? fens[k - 1] : START} orientation={you}
          highlight={cur ? { uci: cur.uci, kind: cur.theirs ? "them" : "you" } : null}
          label={cur ? `After ${tokens.slice(0, k).join(" ")}` : "Start position"} />
      </div>
      <div className="puzzle-side">
        <p className="puzzle-task"><span className={`turn ${you}`} aria-hidden="true" />What {rival} is likely to play when you're {NAME[you]}.</p>
        <p className="small">
          At each of their turns, the move they played most; at each of yours, the one you played most. It stops where a move of
          theirs was played only once.
        </p>
        <LineChips tokens={tokens} playable active={k ? k - 1 : null} onPick={(i) => setK(i + 1)} label="The likely line" />
        <p className="small" style={{ minHeight: "2.6em" }}>
          {!cur ? "Step through it with the moves above or the arrows below."
            : cur.theirs ? (
              <>They played <b className="san">{moveName(k, cur.san)}</b> in {cur.games} of {plural(cur.of, "game")} from here
                {cur.label && <>; Stockfish: {LABEL[cur.label] ?? cur.label}{cur.drop != null && cur.drop >= 0.05 ? ` (−${n1(cur.drop)} Win%)` : ""} <Nag severity={cur.label} /></>}.</>
            ) : <>You played <b className="san">{moveName(k, cur.san)}</b> in {cur.games} of {plural(cur.of, "game")} from here.</>}
        </p>
        <div className="navbtns">
          <button type="button" aria-label="Start" disabled={!k} onClick={() => setK(0)}>⏮</button>
          <button type="button" aria-label="Back a move" disabled={!k} onClick={() => setK(k - 1)}>◀</button>
          <button type="button" aria-label="Forward a move" disabled={k >= moves.length} onClick={() => setK(k + 1)}>▶</button>
        </div>
        <div className="puzzle-actions">
          {added ? <Link to="/trainer" className="btn ghost">In the trainer</Link> : (
            <button type="button" className="btn ghost"
              onClick={() => addLine({ id, colour: you, name: `vs ${rival}: ${tokens.join(" ")}`, moves: ucis })}>Drill it in the trainer</button>
          )}
          <button type="button" className="btn" onClick={onNext}>{nextLabel} →</button>
        </div>
      </div>
    </div>
  );
}

function Done({ h, marks, empty, onAgain }: { h: HeadToHead; marks: (Mark | null)[]; empty: boolean; onAgain: () => void }) {
  const answered = marks.filter((m) => m && m !== "skipped").length;
  const clean = marks.filter((m) => m === "clean").length;
  return (
    <div className="session-done">
      <h2>{empty ? "Nothing to prepare yet" : `Ready for ${h.username}`}</h2>
      <p>
        {empty ? "Their likely lines, costly moves and your key moments against them will show here once there's data."
          : answered ? <><b className="num">{clean}</b> of {plural(answered, "answer")} without help.</> : "No answers this time."}
      </p>
      <div className="puzzle-actions">
        {!empty && <button type="button" className="btn" onClick={onAgain}>Go again</button>}
        <Link className="btn ghost" to={`/rivals/${h.username}`}>Back to {h.username}</Link>
      </div>
    </div>
  );
}
