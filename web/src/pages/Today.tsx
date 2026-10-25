// Today: one session, started from Home (lib/today.ts): the key moments of my newest games, puzzles on what
// decided my recent losses, the reviews due today, and one winning position from a game that got away. Each answer
// counts as it does on its own page: puzzles and key moments schedule their next review, and a position played on
// adds to its Play it out record. Skip moves on without an answer.
import { Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { Loading } from "../components/AppShell";
import { KeyMomentBoard } from "../components/KeyMoment";
import { PuzzleBoard } from "../components/PuzzleBoard";
import { useGame, useGamesIndex, useLosses, usePuzzleIndex, usePuzzles } from "../lib/data";
import { recordKey, recordPuzzle } from "../lib/drill";
import { plural } from "../lib/format";
import { tagName } from "../lib/names";
import { readSkill, readTally, recordTry, thrownStarts, type Start } from "../lib/playout";
import { getProgress, streak, useProgress } from "../lib/progress";
import { losingTags, makePlan, markOf, PART, readPlan, savePlan, sections, type Item, type Mark, type Plan } from "../lib/today";
import type { GameSummary, Puzzle } from "../types/export";
import { Play } from "./PlayOut";

export default function Today() {
  const games = useGamesIndex().games;
  const losses = useLosses();
  const index = usePuzzleIndex();
  const mine = usePuzzles("mine").puzzles;
  const lichess = usePuzzles("lichess").puzzles;
  const tags = useMemo(() => losingTags(losses, index), [losses, index]);
  const wins = useMemo(() => thrownStarts(losses.thrown), [losses]);
  const fresh = () => makePlan(games, getProgress(), tags, mine, lichess, wins, readTally());
  // The plan is fixed when the day's session starts, so answering doesn't reshuffle it.
  const [plan, setPlan] = useState<Plan>(() => readPlan() ?? fresh());
  useEffect(() => savePlan(plan), [plan]);
  const [skill] = useState(readSkill);
  const puzzles = useMemo(() => new Map([...mine, ...lichess].map((z) => [z.id, z])), [mine, lichess]);
  const byGame = useMemo(() => new Map(games.map((g) => [g.id, g])), [games]);

  const mark = (m: Mark) => setPlan((x) => ({ ...x, marks: x.marks.map((v, i) => (i === x.at ? m : v)) }));
  const next = () => setPlan((x) => ({ ...x, at: x.at + 1, marks: x.marks.map((v, i) => (i === x.at ? v ?? "skipped" : v)) }));
  const item = plan.items[plan.at];
  const drilled = [...new Set(plan.items.flatMap((x) => (x.kind === "puzzle" && x.tag ? [x.tag] : [])))];
  const nextLabel = plan.at + 1 < plan.items.length ? "Next" : "Finish";

  return (
    <>
      <div className="page-head">
        <h1>Today</h1>
        <p className="muted">
          Your newest games' key moments, puzzles on what decided your recent losses{drilled.length ? ` (${drilled.map(tagName).join(", ")})` : ""},
          the reviews due today and a win that got away, to win again.
        </p>
      </div>
      {plan.items.length > 0 && (
        <ol className="today-steps" aria-label="Today's session">
          {sections(plan).map((s) => (
            <li key={s.part} className={s.done === s.count ? "done" : plan.at >= s.from ? "now" : ""}>
              <b>{PART[s.part]}</b> <span className="num">{s.done} of {s.count}</span>
            </li>
          ))}
        </ol>
      )}
      <section className="card puzzle-card" aria-label="Today's session step">
        {item ? (
          <>
            <div className="card-head">
              <h2>{title(item, byGame, wins)}</h2>
              <span className="muted small num">Step {plan.at + 1} of {plan.items.length}</span>
            </div>
            <Suspense fallback={<Loading what="Loading the game" />}>
              <Step key={plan.at} item={item} puzzles={puzzles} wins={wins} skill={skill} nextLabel={nextLabel} onMark={mark} onNext={next} />
            </Suspense>
            {item.kind !== "play" && (
              <div className="today-skip"><button type="button" className="linkish small" onClick={next}>Skip this step</button></div>
            )}
          </>
        ) : <Done plan={plan} onAgain={() => setPlan(fresh())} />}
      </section>
    </>
  );
}

function title(x: Item, byGame: Map<string, GameSummary>, wins: Start[]) {
  if (x.kind === "puzzle") return x.tag ? `Drill: ${tagName(x.tag)}` : "Review";
  if (x.kind === "play") return `Win it again · ${wins.find((s) => s.id === x.id)?.title ?? ""}`;
  const g = byGame.get(x.game);
  return `${x.due ? "Review: key moment" : "Key moment"}${g ? ` · vs ${g.opponent}` : ""}`;
}

function Step({ item, puzzles, wins, skill, nextLabel, onMark, onNext }: {
  item: Item; puzzles: Map<string, Puzzle>; wins: Start[]; skill: number; nextLabel: string;
  onMark: (m: Mark) => void; onNext: () => void;
}) {
  if (item.kind === "key") return <KeyStep game={item.game} ply={item.ply} nextLabel={nextLabel} onMark={onMark} onNext={onNext} />;
  if (item.kind === "puzzle") {
    const z = puzzles.get(item.id);
    if (!z) return <Gone onNext={onNext} />;
    return <PuzzleBoard puzzle={z} onDone={(o) => { recordPuzzle(z, o); onMark(markOf(o)); }} onNext={onNext} nextLabel={nextLabel} />;
  }
  const s = wins.find((w) => w.id === item.id);
  if (!s) return <Gone onNext={onNext} />;
  return <Play start={s} skill={skill} embedded back={nextLabel} onBack={onNext} onEnd={(ok) => { recordTry(s.id, ok); onMark(ok ? "clean" : "missed"); }} />;
}

function KeyStep({ game, ply, nextLabel, onMark, onNext }: {
  game: string; ply: number; nextLabel: string; onMark: (m: Mark) => void; onNext: () => void;
}) {
  const g = useGame(game);
  if (g.key?.ply !== ply) return <Gone onNext={onNext} />;
  return <KeyMomentBoard g={g} onDone={(o) => { recordKey(g, o); onMark(markOf(o)); }} onNext={onNext} nextLabel={nextLabel} />;
}

/** A step whose puzzle, game or position isn't in the data any more (the export changed since the plan was made). */
function Gone({ onNext }: { onNext: () => void }) {
  return (
    <div className="empty">
      This one isn't in the data any more. <button type="button" className="btn ghost" onClick={onNext}>Go on</button>
    </div>
  );
}

function Done({ plan, onAgain }: { plan: Plan; onAgain: () => void }) {
  const { days } = streak(useProgress());
  const answered = plan.marks.filter((m) => m && m !== "skipped").length;
  const clean = plan.marks.filter((m) => m === "clean").length, skipped = plan.marks.filter((m) => m === "skipped").length;
  return (
    <div className="session-done">
      <h2>{plan.items.length ? "Done for today" : "Nothing planned today"}</h2>
      {plan.items.length > 0 ? (
        <p>
          <b className="num">{clean}</b> of {plural(answered, "step")} without help{skipped ? `, ${skipped} skipped` : ""}.
          {plan.marks.some((m) => m === "help" || m === "missed") && " The others come back sooner."}
          {days > 1 && ` ${days} days running.`}
        </p>
      ) : (
        <p>No new key moments, nothing due and no drill to do. Puzzles and the trainer have more.</p>
      )}
      <div className="puzzle-actions">
        <button type="button" className="btn" onClick={onAgain}>Another round</button>
        <Link className="btn ghost" to="/puzzles">Puzzles</Link>
        <Link className="btn ghost" to="/">Home</Link>
      </div>
    </div>
  );
}
