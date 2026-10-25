import { Link } from "react-router";
import { RatingChart } from "../components/charts";
import { Trend } from "../components/bits";
import { RepertoireNote } from "../components/RepertoireNote";
import { endgameStarts, readTally, resignedId, resignedStarts, thrownId, thrownStarts } from "../lib/playout";
import { useEndgames, useGamesIndex, useGameSummaries, useInsights, useLeaks, useLosses, usePuzzleIndex, useSummary } from "../lib/data";
import { dueIds } from "../lib/drill";
import { dueLines, newLines, slipped, useLines } from "../lib/lines";
import { streak, useProgress } from "../lib/progress";
import { DRILL, dueKeys, losingTags, newKeys, PART, readPlan, REVIEWS_MAX, sections } from "../lib/today";
import { dateTime, day, moveName, n1, pct, plural, signed } from "../lib/format";
import { RESULT_WORD, TYPE, tagName } from "../lib/names";

const THROWN_SHOWN = 5;
const RECENT_DAYS = 30;   // the rating card's recent change and pace

export default function Dashboard() {
  const s = useSummary();
  const points = useInsights().rating;
  const first = points[0];
  return (
    <>
      <div className="page-head">
        <h1>Road to {s.rating_goal}</h1>
        <p className="muted">
          Updated {dateTime(s.as_of)} · {s.analysed} rapid games{first ? ` since ${day(first.ts)}` : ""}, every move checked
          by {s.engine.version}
        </p>
      </div>
      <div className="grid-2">
        <TodayCard />
        <Rating />
        <Scoreboard />
        <LastGame />
        <Practice />
        <WhyILost />
        <div className="stack">
          <TopLeaks />
          <Thrown />
        </div>
        {points.length > 1 && (
          <section className="card span-2" aria-label="Rating chart">
            <div className="card-head"><h2>Rapid rating since {day(points[0].ts)}</h2><YearHigh points={points} /></div>
            <RatingChart points={points} goal={s.rating_goal} goalDate={s.goal_date} />
          </section>
        )}
      </div>
    </>
  );
}

// The day's session (pages/Today.tsx): what it holds, or how far today's has got.
function TodayCard() {
  const p = useProgress();
  const games = useGamesIndex().games;
  const losses = useLosses();
  const index = usePuzzleIndex();
  const plan = readPlan();
  const { today, days } = streak(p);
  const status = [today ? `${plural(today, "answer")} today` : null, days > 1 ? `${days} days running` : null].filter(Boolean).join(" · ");
  let what: string, action: string;
  if (plan && plan.at >= plan.items.length && plan.items.length) {
    const clean = plan.marks.filter((m) => m === "clean").length, answered = plan.marks.filter((m) => m && m !== "skipped").length;
    what = `Done for today: ${clean} of ${plural(answered, "step")} without help.`;
    action = "Another round";
  } else if (plan) {
    what = sections(plan).map((x) => `${PART[x.part]} ${x.done} of ${x.count}`).join(" · ");
    action = `Continue · step ${plan.at + 1} of ${plan.items.length}`;
  } else {
    // Roughly what a plan made now would hold (the page makes it, with the puzzles).
    const keys = newKeys(games, p).length, tags = losingTags(losses, index).slice(0, DRILL.length);
    const reviews = Math.min(REVIEWS_MAX, dueIds(p).length + dueKeys(games, p).length);
    const win = thrownStarts(losses.thrown).some((t) => !readTally()[t.id]?.reached);
    what = [
      keys ? `${plural(keys, "key moment")} from your newest games` : null,
      tags.length ? `${DRILL.reduce((a, b) => a + b)} puzzles on what loses your games (${tags.map(tagName).join(", ")})` : null,
      reviews ? `${plural(reviews, "review")} due` : null,
      win ? "a win that got away, to win again" : null,
    ].filter(Boolean).join(" · ") || "Nothing new today: another round of puzzles";
    action = "Start";
  }
  return (
    <section className="card span-2 today-card" aria-label="Today">
      <div className="card-head">
        <h2>Today</h2>
        {status && <span className="muted small num">{status}</span>}
      </div>
      <p className="small" style={{ margin: 0 }}>{what}</p>
      <div className="puzzle-actions"><Link className="btn" to="/today">{action}</Link></div>
    </section>
  );
}

// Where the rating is, the last 30 days, and the pace the goal needs; the chart is further down.
function Rating() {
  const s = useSummary();
  const points = useInsights().rating;
  const rating = s.rating ?? points.at(-1)?.rating ?? null;
  const goalDay = new Date(`${s.goal_date}T00:00:00`);
  const today = new Date(s.as_of * 1000);
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((goalDay.getTime() - today.getTime()) / 86400000);
  // The rating 30 days ago: the last point before then (or the first one).
  const since = s.as_of - RECENT_DAYS * 86400;
  const base = [...points].reverse().find((x) => x.ts <= since) ?? points[0];
  const change = rating != null && base ? rating - base.rating : null;
  const toGo = rating != null ? s.rating_goal - rating : null;
  const weekly = (n: number, d: number) => `${signed((7 * n) / d, 0)} a week`;
  const goalText = goalDay.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return (
    <section className="card hero" aria-label="Rapid rating">
      <div className="card-head">
        <h2>Rapid rating</h2>
        <span className="goal">Goal <b>{s.rating_goal}</b> by {goalText}</span>
      </div>
      <div className="hero-nums">
        <span className="big">{rating ?? "–"}</span>
        {change != null && (
          <span className={`delta${change > 0 ? " up" : ""}`}>{change ? signed(change, 0) : "±0"} in the last {RECENT_DAYS} days</span>
        )}
      </div>
      {toGo != null && (
        <p className="small" style={{ margin: 0 }}>
          {toGo <= 0 ? <>Goal reached.</>
            : daysLeft > 0 ? <>To reach {s.rating_goal} by {goalText}: <b className="num">+{toGo}</b> in {daysLeft} days,
                about <b className="num">{weekly(toGo, daysLeft)}</b>.{change != null && <> Your last {RECENT_DAYS} days: <b className="num">{weekly(change, RECENT_DAYS)}</b>.</>}</>
            : <>The goal date has passed: <b className="num">+{toGo}</b> to go.</>}
        </p>
      )}
    </section>
  );
}

function YearHigh({ points }: { points: { ts: number; rating: number }[] }) {
  const hi = points.reduce((a, b) => (b.rating > a.rating ? b : a));
  return <span className="muted small">High {hi.rating} on {day(hi.ts)}</span>;
}

// Three counts that lose games, in my last N games against the N before (insights, games index).
function Scoreboard() {
  const rates = useInsights().leak_rates as { recent: { [t: string]: number | null }; previous: { [t: string]: number | null }; games: number[] };
  const games = useGamesIndex().games;
  const [n, m] = rates.games;
  const recent = games.slice(0, n), before = games.slice(n, n + m);
  const count = (list: typeof games, f: (g: (typeof games)[number]) => boolean) => list.filter(f).length;
  const rows = [
    { name: "Hung pieces", to: "/leaks/hung_piece", now: Math.round((rates.recent.hung_piece ?? 0) * n), then: Math.round((rates.previous.hung_piece ?? 0) * m) },
    { name: "Wins thrown away", to: "/games?thrown=1", now: count(recent, (g) => g.thrown), then: count(before, (g) => g.thrown) },
    { name: "Gave up while playable", to: "/games?cause=gave_up", now: count(recent, (g) => g.loss_cause === "gave_up"),
      then: count(before, (g) => g.loss_cause === "gave_up") },
  ];
  return (
    <section className="card" aria-label="Scoreboard">
      <div className="card-head"><h2>Scoreboard</h2><span className="muted small">last {n} games · the {m} before</span></div>
      <div className="toplist">
        {rows.map((r) => (
          <Link key={r.name} to={r.to} className="topleak score-row">
            <div className="nm">{r.name}</div>
            <span className="num score"><b>{r.now}</b> <span className="muted">{r.then}</span></span>
            <Trend now={r.now} before={r.then} />
          </Link>
        ))}
      </div>
    </section>
  );
}

// Practice outside the day's session: reviews, the drill on what loses games, opening lines and positions to play on.
function Practice() {
  const p = useProgress();
  const index = usePuzzleIndex();
  const lines = useLines();
  const losses = useLosses();
  const endgames = useEndgames();
  const due = dueIds(p).length;
  const linesDue = dueLines(lines, p).length, linesNew = newLines(lines, p).length;
  const linesSlipped = lines.filter((l) => slipped(l, p)).length;
  const top = losingTags(losses, index)[0];
  const tally = readTally();
  const starts = [...thrownStarts(losses.thrown), ...resignedStarts(losses.losses), ...endgameStarts(endgames.endgames, losses.thrown)];
  const toPlay = new Set(starts.filter((t) => !tally[t.id]?.reached).map((t) => t.id)).size;
  return (
    <section className="card" aria-label="More practice">
      <div className="card-head"><h2>More practice</h2></div>
      <div className="train-grid">
        <Link to="/puzzles?tab=due" className="train">
          <span className="label">Reviews</span>
          <b className="num">{due}</b>
          <span className="muted small">{due ? `${due === 1 ? "puzzle" : "puzzles"} due today` : "nothing due; new puzzles are waiting"}</span>
        </Link>
        {top && (
          <Link to={`/puzzles?drill=${top}`} className="train">
            <span className="label">What loses your games</span>
            <b>{tagName(top)}</b>
            <span className="muted small num">
              {losses.causes_30_days[top] ?? 0} of your losses in the last 30 days · a drill: {index.mine[top] ?? 0} of your positions, then Lichess
            </span>
          </Link>
        )}
        <Link to="/trainer" className="train">
          <span className="label">Openings</span>
          <b className="num">{linesDue || linesNew}</b>
          <span className="muted small">
            {linesDue ? (linesSlipped ? `lines due, ${linesSlipped} you left in a game` : "lines due") : linesNew ? "lines to learn" : "no lines yet"}
          </span>
        </Link>
        <Link to="/play" className="train">
          <span className="label">Play it out</span>
          <b className="num">{toPlay}</b>
          <span className="muted small">wins that got away, games you gave up and endgames you spoiled, to play on</span>
        </Link>
      </div>
    </section>
  );
}

// The newest game: how it went, and the ways back into it. Review it opens on its key moment when it has one.
function LastGame() {
  const g = useGamesIndex().games[0];
  const losses = useLosses();
  const thrown = losses.thrown.find((t) => t.game === g?.id);
  const gaveUp = losses.losses.some((l) => l.game === g?.id && l.cause === "gave_up");
  if (!g) return null;
  const counts = [[g.blunders, "blunder"], [g.mistakes, "mistake"], [g.inaccuracies, "inaccuracy"]] as const;
  return (
    <section className="card" aria-label="Last game">
      <div className="card-head">
        <h2>Last game</h2>
        <Link to={`/games/${g.id}${g.key_ply != null ? "?key=1" : ""}`} className="small">Review it →</Link>
      </div>
      <p style={{ margin: 0 }}>
        <b>{RESULT_WORD[g.result]}</b> vs {g.opponent} {g.opp_rating != null && <span className="muted num">({g.opp_rating})</span>}
        <span className="muted small"> · {dateTime(g.start_ts)} · {g.colour === "white" ? "White" : "Black"}{g.opening ? ` · ${g.opening}` : ""}</span>
      </p>
      <p className="small" style={{ margin: 0 }}>
        Accuracy <b className="num">{g.accuracy != null ? n1(g.accuracy) : "–"}</b>
        {counts.map(([n, word]) => <span key={word} className="muted"> · <span className="num">{n}</span> {n === 1 ? word : word === "inaccuracy" ? "inaccuracies" : `${word}s`}</span>)}
        {g.loss_cause && <> · why you lost: <b>{TYPE[g.loss_cause] ?? g.loss_cause}</b></>}
      </p>
      {g.repertoire && <p className="small" style={{ margin: 0 }}><RepertoireNote c={g.repertoire} opponent={g.opponent} /></p>}
      <div className="puzzle-actions">
        {g.puzzles > 0 && <Link className="btn" to={`/puzzles?game=${g.id}`}>Retry its mistakes ({g.puzzles})</Link>}
        {thrown && thrownStarts([thrown]).length > 0 && (
          <Link className="btn ghost" to={`/play?play=${thrownId(thrown.game, thrown.ply!)}`}>Play the thrown win again</Link>
        )}
        {gaveUp && <Link className="btn ghost" to={`/play?play=${resignedId(g.id)}`}>Play on from where you gave up</Link>}
      </div>
    </section>
  );
}

// Every loss has exactly one cause; bars are shares of losses, last 30 days against all time.
function WhyILost() {
  const losses = useLosses();
  const all = losses.causes, recent = losses.causes_30_days;
  const sum = (o: { [k: string]: number }) => Object.values(o).reduce((a, b) => a + b, 0);
  const tAll = sum(all), tRecent = sum(recent);
  const share = (n: number, t: number) => (t ? (n / t) * 100 : 0);
  const order = Object.keys(all).sort((a, b) => (recent[b] ?? 0) - (recent[a] ?? 0) || all[b] - all[a]);
  const max = Math.max(1, ...order.map((k) => Math.max(share(recent[k] ?? 0, tRecent), share(all[k], tAll))));
  return (
    <section className="card">
      <div className="card-head"><h2>Why I lost</h2><span className="muted small">one cause per loss</span></div>
      <div className="keys">
        <span><i className="key-bar now" />Last 30 days ({tRecent} {tRecent === 1 ? "loss" : "losses"})</span>
        <span><i className="key-bar then" />All time ({tAll})</span>
      </div>
      <div className="causes">
        {order.map((k) => {
          const r = share(recent[k] ?? 0, tRecent), a = share(all[k], tAll);
          return (
            <Link key={k} to={`/games?cause=${k}`} className="cause"
              title={`${TYPE[k] ?? k}: ${recent[k] ?? 0} of ${tRecent} recent losses, ${all[k]} of ${tAll} all time`}>
              <span className="cname">{TYPE[k] ?? k}</span>
              <span className="cval">
                <b className="num">{pct(r)}</b> <span className="muted num">{pct(a)}</span>
              </span>
              <span className="cbars" aria-hidden="true">
                <i className="now" style={{ width: `${((r / max) * 100).toFixed(1)}%` }} />
                <i className="then" style={{ width: `${((a / max) * 100).toFixed(1)}%` }} />
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function TopLeaks() {
  const s = useSummary();
  const n = useLeaks().recent_games;
  return (
    <section className="card" aria-label="Top leaks">
      <div className="card-head"><h2>Top leaks</h2><Link to="/leaks" className="small">All leaks →</Link></div>
      <div className="toplist">
        {s.top_leaks.map((l, i) => {
          const now = Math.round((l.recent ?? 0) * n), before = Math.round((l.previous ?? 0) * n);
          return (
            <Link key={l.tag} to={`/leaks/${l.tag}`} className="topleak">
              <span className="rank">{i + 1}</span>
              <div>
                <div className="nm">{tagName(l.tag)}</div>
                <div className="sub">
                  {l.recent == null ? `${l.count} in all` : `${now} in your last ${n} games, ${before} in the ${n} before`}
                </div>
              </div>
              {l.recent != null && l.previous != null && <Trend now={now} before={before} />}
            </Link>
          );
        })}
      </div>
    </section>
  );
}

function Thrown() {
  const losses = useLosses();
  const s = useSummary();
  const games = useGameSummaries();
  const latest = [...losses.thrown].sort((a, b) => b.ts - a.ts).slice(0, THROWN_SHOWN);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Winning games not won</h2>
        <Link to="/games?thrown=1" className="small">All {s.thrown} →</Link>
      </div>
      <p className="muted small" style={{ margin: 0 }}>Games where your Win% reached 80 and you didn't win.</p>
      <div className="rows">
        {latest.map((t) => {
          const g = games.get(t.game);
          return (
            <Link key={t.game} className="row" to={`/games/${t.game}${t.ply ? `?ply=${t.ply}` : ""}`}>
              <span className="t">
                vs {g?.opponent ?? "?"} {g?.opp_rating != null && <span className="muted num">({g.opp_rating})</span>}
              </span>
              <span className="s">
                {day(t.ts)} · {g ? (g.colour === "white" ? "White" : "Black") : ""}{g?.opening ? ` · ${g.opening}` : ""} · peaked
                at {n1(t.peak)}%{t.ply && t.san && (
                  <>, then <span className="nowrap">{moveName(t.ply, t.san)}{t.drop != null ? ` −${n1(t.drop)}` : ""}</span></>
                )}
              </span>
              <span className="r"><span className="pill">{t.result === "loss" ? "Lost" : "Drew"}</span></span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
