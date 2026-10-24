// Puzzles: my own mistakes as puzzles, Lichess puzzles of the same kind, and whatever is due today, each
// filterable by tag. A session is up to ten puzzles; every answer schedules the puzzle's next review (FSRS,
// kept on this device). ?drill=<tag> is the session a leak's "Drill these" starts; ?game=<id> retries one
// game's mistakes in the order they happened.
import { Suspense, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { Loading } from "../components/AppShell";
import { PuzzleBoard, type Outcome } from "../components/PuzzleBoard";
import { usePuzzles } from "../lib/data";
import { byLevel, byNewestGame, drillQueue, dueIds, dueQueue, hasTag, queue } from "../lib/drill";
import { grouped, plural } from "../lib/format";
import { tagName } from "../lib/names";
import { getProgress, grade, rateLevel, Rating, tagStats, useProgress } from "../lib/progress";
import type { Puzzle } from "../types/export";

type Tab = "mine" | "lichess" | "due" | "drill" | "game";
const NONE: Puzzle[] = [];
const TABS: [Tab, string][] = [["mine", "My mistakes"], ["lichess", "Same kind"], ["due", "Due today"]];

export const gradeOf = (o: Outcome) =>
  o.revealed || o.wrong >= 2 ? Rating.Again : o.wrong || o.hint ? Rating.Hard : Rating.Good;

export default function Puzzles() {
  const [params, setParams] = useSearchParams();
  const drill = params.get("drill"), game = params.get("game");
  const tab: Tab = drill ? "drill" : game ? "game" : ((params.get("tab") as Tab) ?? "mine");
  const tag = drill ?? game ?? params.get("tag") ?? "";
  const progress = useProgress();
  const due = dueIds(progress).length;
  const [round, setRound] = useState(0);
  const go = (t: Tab, g = "") => setParams({ ...(t !== "mine" ? { tab: t } : {}), ...(g ? { tag: g } : {}) }, { replace: true });

  return (
    <>
      <div className="page-head">
        <h1>{drill ? `Drill: ${tagName(drill)}` : game ? "This game's mistakes" : "Puzzles"}</h1>
        <p className="muted">
          {drill
            ? "Your own positions with this mistake first, then Lichess puzzles of the same kind."
            : game ? "The positions from this game where one move was clearly best, in the order you reached them."
            : "Positions from your games where one move is clearly best, and Lichess puzzles that train the same patterns. Answers schedule each puzzle's next review."}
        </p>
      </div>
      <div className="puzzle-tabs">
        <span className="seg" role="group" aria-label="Puzzle set">
          {TABS.map(([t, label]) => (
            <button key={t} type="button" aria-pressed={tab === t} onClick={() => go(t)}>
              {label}{t === "due" && due ? ` (${due})` : ""}
            </button>
          ))}
        </span>
        {drill && <Link className="small" to={`/leaks/${drill}`}>← Back to the leak</Link>}
        {game && <Link className="small" to={`/games/${game}`}>← Back to the game</Link>}
      </div>
      <Suspense fallback={<Loading what="Loading puzzles" />}>
        <Session key={`${tab}:${tag}:${round}`} tab={tab} tag={tag} onTag={(g) => go(tab === "drill" || tab === "game" ? "mine" : tab, g)}
          onAgain={() => setRound((r) => r + 1)} />
      </Suspense>
      <TagStats />
    </>
  );
}

function Session({ tab, tag, onTag, onAgain }: { tab: Tab; tag: string; onTag: (tag: string) => void; onAgain: () => void }) {
  const mine = usePuzzles("mine").puzzles;
  // The Lichess set is a couple of MB: only load it where the session needs it.
  const needLichess = tab === "lichess" || tab === "drill" || (tab === "due" && dueIds(getProgress()).some((id) => id.startsWith("l-")));
  const lichess = needLichess ? usePuzzles("lichess").puzzles : NONE;   // use() may be called conditionally
  const pool = useMemo(() => (tab === "mine" ? mine : tab === "lichess" ? lichess : [...mine, ...lichess]), [tab, mine, lichess]);
  // The queue is fixed when the session starts, so answering doesn't reshuffle it.
  const [list] = useState<Puzzle[]>(() => {
    const p = getProgress();
    if (tab === "drill") return drillQueue(tag, mine, lichess, p);
    if (tab === "game") return mine.filter((z) => z.game === tag).sort((a, b) => (a.ply ?? 0) - (b.ply ?? 0));
    if (tab === "due") return dueQueue(pool, p, tag);
    return queue(pool.filter(hasTag(tag)), p, tab === "mine" ? byNewestGame : byLevel(p.level));
  });
  const [i, setI] = useState(0);
  const [results, setResults] = useState<Outcome[]>([]);
  const tags = useMemo(() => {
    const count = new Map<string, number>();
    for (const z of tab === "due" ? dueQueue(pool, getProgress()) : pool) for (const t of z.tags) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1]);
  }, [pool, tab]);

  const onDone = (z: Puzzle, o: Outcome) => {
    grade(z.id, "puzzle", gradeOf(o), z.tags);
    if (z.source === "lichess" && z.rating != null) rateLevel(z.rating, o.solved && !o.wrong && !o.hint);
    setResults((r) => [...r, o]);
  };
  const solved = results.filter((o) => o.solved && !o.wrong && !o.hint).length;

  return (
    <>
      {tab !== "drill" && tab !== "game" && tags.length > 0 && (
        <div className="chips tag-filter" role="group" aria-label="Filter by tag">
          <button type="button" aria-pressed={!tag} onClick={() => onTag("")}>All</button>
          {tags.map(([t, n]) => (
            <button key={t} type="button" aria-pressed={tag === t} onClick={() => onTag(t)}>{tagName(t)} <span className="num muted">{n}</span></button>
          ))}
        </div>
      )}
      <section className="card puzzle-card" aria-label="Puzzle session">
        {!list.length ? (
          <div className="empty">
            {tab === "due" ? "Nothing due today. New puzzles are under My mistakes and Same kind." : "No new puzzles here. Reviews come back when they're due."}
          </div>
        ) : i < list.length ? (
          <>
            <div className="card-head">
              <h2>Puzzle {i + 1} of {list.length}</h2>
              {results.length > 0 && (
                <span className="muted small num">{solved} solved cleanly · {results.length - solved} with help or missed</span>
              )}
            </div>
            <PuzzleBoard key={list[i].id} puzzle={list[i]} onDone={(o) => onDone(list[i], o)} onNext={() => setI(i + 1)}
              nextLabel={i + 1 < list.length ? "Next puzzle" : "Finish"} />
          </>
        ) : (
          <div className="session-done">
            <h2>Session done</h2>
            <p><b className="num">{solved}</b> of {plural(list.length, "puzzle")} solved without help.
              {results.length - solved > 0 && " The others come back sooner."}</p>
            <button type="button" className="btn" onClick={onAgain}>Another round</button>
          </div>
        )}
      </section>
      <p className="muted small">
        {grouped(mine.length)} puzzles from your games{lichess.length ? ` · ${grouped(lichess.length)} from Lichess` : ""}.
        Your puzzle level: <span className="num">{getProgress().level}</span> (Lichess puzzles near it come first).
      </p>
    </>
  );
}

function TagStats() {
  const p = useProgress();
  const rows = [...tagStats(p)].sort((a, b) => b[1].tries - a[1].tries).slice(0, 12);
  if (!rows.length) return null;
  return (
    <section className="card">
      <div className="card-head"><h2>By tag</h2><span className="muted small">every answer so far</span></div>
      <div className="grows" role="table" aria-label="Puzzle results by tag">
        <div className="grow head" role="row">
          <span role="columnheader"><span className="sr-only">Tag</span></span>
          <span role="columnheader" className="n">Tries</span>
          <span role="columnheader">Solved without help</span>
          <span role="columnheader" className="n"><span className="sr-only">Count</span></span>
        </div>
        {rows.map(([t, s]) => {
          const pct = (100 * s.good) / s.tries;
          return (
            <div key={t} className="grow" role="row">
              <span role="rowheader" className="gname">{tagName(t)}</span>
              <span role="cell" className="n num">{s.tries}</span>
              <span role="cell" className="gbar">
                <span className="track" aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                <b className="num">{Math.round(pct)}%</b>
              </span>
              <span role="cell" className="n num muted">{s.good}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
