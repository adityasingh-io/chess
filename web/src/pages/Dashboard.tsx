import { Link } from "react-router";
import { RatingChart } from "../components/charts";
import { Trend } from "../components/bits";
import { useGameSummaries, useInsights, useLeaks, useLosses, useSummary } from "../lib/data";
import { dateTime, day, moveName, n1, pct } from "../lib/format";
import { TYPE, tagName } from "../lib/names";

const THROWN_SHOWN = 5;

export default function Dashboard() {
  const s = useSummary();
  const insights = useInsights();
  const points = insights.rating;
  const goalDay = new Date(`${s.goal_date}T00:00:00`);
  const today = new Date(s.as_of * 1000);
  today.setHours(0, 0, 0, 0);
  const daysLeft = Math.round((goalDay.getTime() - today.getTime()) / 86400000);
  const first = points[0], rating = s.rating ?? points.at(-1)?.rating ?? null;

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
        <section className="card hero span-2">
          <div className="card-head">
            <h2>Rapid rating</h2>
            {rating != null && (
              <span className="goal">
                Goal <b>{s.rating_goal}</b> by {goalDay.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} ·{" "}
                <b>{s.rating_goal - rating > 0 ? `+${s.rating_goal - rating}` : "reached"}</b>
                {daysLeft >= 0 ? ` in ${daysLeft} days` : ""}
              </span>
            )}
          </div>
          {points.length > 0 && <RatingHero points={points} />}
          {points.length > 1 && <RatingChart points={points} goal={s.rating_goal} goalDate={s.goal_date} />}
        </section>
        <WhyILost />
        <div className="stack">
          <TopLeaks />
          <Thrown />
        </div>
        <section className="card span-2">
          <div className="card-head"><h2>Today's training</h2><span className="pill later">Phase 5</span></div>
          <div className="empty">Puzzles due and one opening drill appear here once the puzzle and repertoire trainers exist.</div>
        </section>
      </div>
    </>
  );
}

function RatingHero({ points }: { points: { ts: number; rating: number }[] }) {
  const vals = points.map((p) => p.rating);
  const hiAt = vals.indexOf(Math.max(...vals));
  const change = vals[vals.length - 1] - vals[0];
  return (
    <div className="hero-nums">
      <span className="big">{vals[vals.length - 1]}</span>
      <span className={`delta ${change < 0 ? "down" : "up"}`}>
        {change < 0 ? "↓" : change > 0 ? "↑" : "="} {Math.abs(change)} since {day(points[0].ts)}
      </span>
      <span className="muted">Year high {vals[hiAt]} on {day(points[hiAt].ts)}</span>
    </div>
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
    <section className="card">
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
