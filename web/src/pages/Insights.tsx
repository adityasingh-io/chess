// Insights: when and how you score, where the mistakes come from, and whether your leaks are shrinking.
// Every number is from insights.json (the rating goal from summary.json).
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { HourChart, MistakeRateChart, MonthChart, RatingChart, type HourPoint, type MonthPoint, type RateRow } from "../components/charts";
import { Nag, Trend } from "../components/bits";
import { useInsights, useSummary } from "../lib/data";
import { grouped, n1, plural } from "../lib/format";
import { FLAG, TYPE, tagName } from "../lib/names";
import type { EndgameWindow, GroupStat, OpeningTrend as OpeningTrendData, OpeningWindow } from "../types/export";

const FEW = 5;                 // groups with fewer games are drawn faint: too few to read much into
const OPENINGS_SHOWN = 8;

type Row = { key: string; label: string; games: number; score: number | null; accuracy: number | null };

const lowBound = (k: string | number) => Number(String(k).split(/[-+]/)[0]);
/** "0-40" plies → "under 20 moves", "40-60" → "20–30 moves", "100+" → "50+ moves". */
function movesLabel(k: string) {
  const [lo, hi] = k.split("-").map((x) => Number(x.replace("+", "")));
  if (k.endsWith("+")) return `${lo / 2}+ moves`;
  return lo === 0 ? `under ${hi / 2} moves` : `${lo / 2}–${hi / 2} moves`;
}
const PREVIOUS_ORDER = ["after a win", "after a loss", "after a draw", "first of a session"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Rows of groups: games, a score bar with the 50% mark, and accuracy. */
function GroupRows({ rows, label }: { rows: Row[]; label: string }) {
  return (
    <div className="grows" role="table" aria-label={label}>
      <div className="grow head" role="row">
        <span role="columnheader"><span className="sr-only">Group</span></span>
        <span role="columnheader" className="n">Games</span>
        <span role="columnheader">Score</span>
        <span role="columnheader" className="n">Accuracy</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className={`grow${r.games < FEW ? " few" : ""}`} role="row">
          <span role="rowheader" className="gname">{r.label}</span>
          <span role="cell" className="n num">{grouped(r.games)}</span>
          <span role="cell" className="gbar">
            <span className="track" aria-hidden="true"><i style={{ width: `${r.score ?? 0}%` }} /></span>
            <b className="num">{r.score != null ? `${n1(r.score)}%` : "–"}</b>
          </span>
          <span role="cell" className="n num">{r.accuracy != null ? n1(r.accuracy) : "–"}</span>
        </div>
      ))}
    </div>
  );
}

const rowsOf = (stats: GroupStat[], label: (k: string | number) => string) =>
  stats.map((s) => ({ key: String(s.key), label: label(s.key), games: s.games, score: s.score, accuracy: s.accuracy }));

export default function Insights() {
  const ins = useInsights();
  const s = useSummary();
  const [allOpenings, setAllOpenings] = useState(false);

  const colour = rowsOf(ins.by_colour, (k) => (k === "white" ? "As White" : "As Black"));
  const rating = rowsOf([...ins.by_opponent_rating].sort((a, b) => Number(a.key) - Number(b.key)),
    (k) => `${k}–${Number(k) + 99}`);
  const length = rowsOf([...ins.by_length].sort((a, b) => lowBound(a.key) - lowBound(b.key)), (k) => movesLabel(String(k)));
  const previous = rowsOf([...ins.by_previous_result].sort((a, b) => PREVIOUS_ORDER.indexOf(String(a.key)) - PREVIOUS_ORDER.indexOf(String(b.key))),
    (k) => cap(String(k)));
  const openings = rowsOf([...ins.by_opening].sort((a, b) => b.games - a.games), (k) => {
    const [c, family] = String(k).split(/: (.*)/s);
    return `${family} (${c === "white" ? "White" : "Black"})`;
  });

  const hours = useMemo<HourPoint[]>(() => Array.from({ length: 24 }, (_, hour) => {
    const g = ins.by_hour.find((x) => Number(x.key) === hour);
    return { hour, games: g?.games ?? 0, score: g?.score ?? null, accuracy: g?.accuracy ?? null };
  }), [ins]);
  const think = useMemo<RateRow[]>(() => [...ins.think_time].sort((a, b) => lowBound(a.key) - lowBound(b.key)).map((t) => ({
    label: t.key.replace("-", "–"), moves: t.moves, blunders: t.blunder_rate,
    mistakes: t.mistake_or_worse_rate - t.blunder_rate, total: t.mistake_or_worse_rate,
  })), [ins]);

  // Time losses per month, from January of the first game's year to the month of the newest game.
  const timeLosses = ins.time_losses as { count: number; by_month: { [m: string]: number } };
  const months = useMemo<MonthPoint[]>(() => {
    const first = ins.rating[0]?.ts ?? ins.as_of;
    const out: MonthPoint[] = [];
    const d = new Date(new Date(first * 1000).getFullYear(), 0, 1), end = new Date(ins.as_of * 1000);
    for (; d <= end; d.setMonth(d.getMonth() + 1)) {
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      out.push({ month: m, label: d.toLocaleDateString("en-GB", { month: "long" }), n: timeLosses.by_month[m] ?? 0 });
    }
    return out;
  }, [ins, timeLosses]);

  const phaseOrder = ["opening", "middlegame", "endgame"];
  const phases = [...ins.by_phase].sort((a, b) => phaseOrder.indexOf(a.key) - phaseOrder.indexOf(b.key));
  const rates = ins.leak_rates as { recent: { [t: string]: number | null }; previous: { [t: string]: number | null }; games: number[] };
  const [nRecent, nPrevious] = rates.games;

  return (
    <>
      <div className="page-head">
        <h1>Insights</h1>
        <p className="muted">
          Where your points come from and where they go, over {plural(s.analysed, "game")}. Scores count a win as 100 and a draw as 50;
          faint rows have fewer than {FEW} games.
        </p>
      </div>
      <div className="grid-2">
        {ins.rating.length > 1 && (
          <section className="card span-2">
            <div className="card-head"><h2>Rating</h2><span className="muted small">rated rapid games</span></div>
            <RatingChart points={ins.rating} goal={s.rating_goal} goalDate={s.goal_date} />
          </section>
        )}
        <section className="card">
          <div className="card-head">
            <h2>Are your leaks shrinking?</h2>
            <span className="muted small">per game</span>
          </div>
          <div className="keys">
            <span><i className="key-bar now" />Last {nRecent} games</span>
            <span><i className="key-bar then" />The {nPrevious} before</span>
          </div>
          <LeakTrend title="What went wrong" tags={Object.keys(TYPE).filter((t) => t in rates.recent)} rates={rates} />
          <LeakTrend title="When it happens" tags={Object.keys(FLAG).filter((t) => t in rates.recent)} rates={rates} />
        </section>
        <div className="stack">
          <section className="card">
            <div className="card-head"><h2>By phase</h2><span className="muted small">your moves, book moves left out</span></div>
            <div className="tiles">
              {phases.map((p) => (
                <div key={p.key} className="tile">
                  <span className="label">{cap(p.key)}</span>
                  <span className="big-num num">{p.accuracy != null ? n1(p.accuracy) : "–"}</span>
                  <span className="muted small">accuracy</span>
                  <b className="num tile-2">{p.mistakes_per_game.toFixed(2)}</b>
                  <span className="muted small">mistakes a game</span>
                  <span className="muted small tile-foot">over {grouped(p.moves)} moves</span>
                </div>
              ))}
            </div>
          </section>
          <section className="card">
            <div className="card-head">
              <h2>Think time and mistakes</h2>
              <span className="legend-inline">
                <span><Nag severity="blunder" /> Blunders</span>
                <span><Nag severity="mistake" /> Mistakes</span>
              </span>
            </div>
            <p className="muted small" style={{ margin: 0 }}>Share of your moves that were a mistake or a blunder, by how many seconds you thought.</p>
            <MistakeRateChart data={think} />
          </section>
        </div>
        {ins.openings && <OpeningTrend trend={ins.openings} />}
        {ins.endgames && <EndgameTrend recent={ins.endgames.recent} previous={ins.endgames.previous} />}
        <section className="card">
          <div className="card-head"><h2>By colour</h2></div>
          <GroupRows rows={colour} label="Score and accuracy by colour" />
        </section>
        <section className="card">
          <div className="card-head"><h2>After a win or a loss</h2><span className="muted small">started within 30 minutes of the last game</span></div>
          <GroupRows rows={previous} label="Score and accuracy by the previous game's result" />
        </section>
        <section className="card">
          <div className="card-head"><h2>By opponent rating</h2></div>
          <GroupRows rows={rating} label="Score and accuracy by opponent rating" />
        </section>
        <section className="card">
          <div className="card-head"><h2>By game length</h2><span className="muted small">a move is one by each side</span></div>
          <GroupRows rows={length} label="Score and accuracy by game length" />
        </section>
        <section className="card span-2">
          <div className="card-head"><h2>By hour of day</h2><span className="muted small">when the game started; dashed line at 50%</span></div>
          <HourChart data={hours} few={FEW} />
        </section>
        <section className="card">
          <div className="card-head">
            <h2>By opening</h2>
            <Link to="/openings" className="small">Openings →</Link>
          </div>
          <GroupRows rows={allOpenings ? openings : openings.slice(0, OPENINGS_SHOWN)} label="Score and accuracy by opening family" />
          {openings.length > OPENINGS_SHOWN && (
            <button type="button" className="btn ghost" onClick={() => setAllOpenings((a) => !a)}>
              {allOpenings ? "Show fewer" : `Show all ${openings.length}`}
            </button>
          )}
        </section>
        <section className="card">
          <div className="card-head">
            <h2>Lost on time</h2>
            <span className="muted small">{plural(timeLosses.count, "game")} in all</span>
          </div>
          <MonthChart data={months} what="Games you lost on time, per month" />
          <Link to="/games?cause=clock" className="small">Losses flagged in a playable position →</Link>
        </section>
      </div>
    </>
  );
}

/** Share of a start band that ended well: converted, held or saved. */
const share = (good: number, of: number) => (of ? (100 * good) / of : null);
const ENDGAME_ROWS: { key: string; label: string; good: (w: EndgameWindow) => number; of: (w: EndgameWindow) => number; outcome: string }[] = [
  { key: "converted", label: "Winning ones converted", good: (w) => w.converted, of: (w) => w.winning, outcome: "converted" },
  { key: "held", label: "Balanced ones held", good: (w) => w.held, of: (w) => w.balanced, outcome: "held" },
  { key: "saved", label: "Losing ones saved", good: (w) => w.saved, of: (w) => w.losing, outcome: "saved" },
];

/** My last endgames against the ones before: how often each start band ended well, and my accuracy in them. */
function EndgameTrend({ recent, previous }: { recent: EndgameWindow; previous: EndgameWindow | null }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>Are your endgames improving?</h2>
        <Link to="/endgames" className="small">Endgames →</Link>
      </div>
      <div className="keys">
        <span><i className="key-bar now" />Last {recent.endgames} endgames</span>
        {previous && <span><i className="key-bar then" />The {previous.endgames} before</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>By your Win% when the endgame started: 70 or more is winning, 30 or less losing.</p>
      <div className="causes">
        {ENDGAME_ROWS.map((r) => {
          const now = share(r.good(recent), r.of(recent)), before = previous ? share(r.good(previous), r.of(previous)) : null;
          return (
            <Link key={r.key} to={`/endgames?outcome=${r.outcome}`} className="cause"
              title={`${r.label}: ${r.good(recent)} of ${r.of(recent)} lately${previous ? `, ${r.good(previous)} of ${r.of(previous)} before` : ""}`}>
              <span className="cname">{r.label}</span>
              <span className="cval">
                <b className="num">{now != null ? `${Math.round(now)}%` : "–"}</b>{" "}
                <span className="muted num">{r.good(recent)} of {r.of(recent)}</span>
                {before != null && <> <span className="muted num">· {Math.round(before)}% before</span></>}
                {now != null && before != null && <> <Trend now={now} before={before} higherIsBetter /></>}
              </span>
              <span className="cbars" aria-hidden="true">
                <i className="now" style={{ width: `${(now ?? 0).toFixed(1)}%` }} />
                {before != null && <i className="then" style={{ width: `${before.toFixed(1)}%` }} />}
              </span>
            </Link>
          );
        })}
      </div>
      <p className="small" style={{ margin: 0 }}>
        Accuracy in these endgames: <b className="num">{recent.accuracy != null ? n1(recent.accuracy) : "–"}</b>
        {previous && <span className="muted"> · <span className="num">{previous.accuracy != null ? n1(previous.accuracy) : "–"}</span> before</span>}
      </p>
    </section>
  );
}

const OPENING_ROWS: { label: string; value: (w: OpeningWindow) => number | null; unit: string; higherIsBetter: boolean; max?: number }[] = [
  { label: "Moves in your lines", value: (w) => w.stayed, unit: "", higherIsBetter: true },
  { label: "Games you left your lines", value: (w) => share(w.left_mine, w.games), unit: "%", higherIsBetter: false, max: 100 },
  { label: "Win% after the opening", value: (w) => w.win_after_opening, unit: "%", higherIsBetter: true, max: 100 },
  { label: "Accuracy in the opening", value: (w) => w.accuracy, unit: "", higherIsBetter: true, max: 100 },
];

/** My last games against the ones before: how far they stayed in the trainer's lines and how the opening went,
    then the lines by month. */
function OpeningTrend({ trend }: { trend: OpeningTrendData }) {
  const { recent, previous } = trend;
  const months = trend.months.map((m): MonthPoint => ({
    month: m.month, n: m.stayed != null ? Math.round(m.stayed * 10) / 10 : 0,
    label: new Date(`${m.month}-01T12:00:00`).toLocaleDateString("en-GB", { month: "long" }),
  }));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Are your openings improving?</h2>
        <Link to="/openings" className="small">Openings →</Link>
      </div>
      <div className="keys">
        <span><i className="key-bar now" />Last {recent.games} games</span>
        {previous && <span><i className="key-bar then" />The {previous.games} before</span>}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Your lines are the trainer's; leaving them means playing a move none of them has. Win% after the opening is
        Stockfish's, after move 12.
      </p>
      <div className="causes">
        {OPENING_ROWS.map((r) => {
          const now = r.value(recent), before = previous ? r.value(previous) : null;
          const top = r.max ?? Math.max(now ?? 0, before ?? 0, 1);
          const text = (v: number | null) => (v == null ? "–" : `${n1(v)}${r.unit}`);
          return (
            <div key={r.label} className="cause">
              <span className="cname">{r.label}</span>
              <span className="cval">
                <b className="num">{text(now)}</b>
                {before != null && <> <span className="muted num">· {text(before)} before</span></>}
                {now != null && before != null && <> <Trend now={now} before={before} higherIsBetter={r.higherIsBetter} /></>}
              </span>
              <span className="cbars" aria-hidden="true">
                <i className="now" style={{ width: `${((100 * (now ?? 0)) / top).toFixed(1)}%` }} />
                {before != null && <i className="then" style={{ width: `${((100 * before) / top).toFixed(1)}%` }} />}
              </span>
            </div>
          );
        })}
      </div>
      <div className="label">Moves in your lines, by month</div>
      <MonthChart data={months} what="Moves your games stayed in your lines, on average, per month" />
    </section>
  );
}

function LeakTrend({ title, tags, rates }: {
  title: string; tags: string[]; rates: { recent: { [t: string]: number | null }; previous: { [t: string]: number | null } };
}) {
  const max = Math.max(0.01, ...tags.flatMap((t) => [rates.recent[t] ?? 0, rates.previous[t] ?? 0]));
  return (
    <div className="trend-group">
      <div className="label">{title}</div>
      <div className="causes">
        {tags.map((t) => {
          const now = rates.recent[t] ?? 0, before = rates.previous[t] ?? 0;
          return (
            <Link key={t} to={`/leaks/${t}`} className="cause" title={`${tagName(t)}: ${now.toFixed(2)} a game lately, ${before.toFixed(2)} before`}>
              <span className="cname">{tagName(t)}</span>
              <span className="cval">
                <b className="num">{now.toFixed(2)}</b> <span className="muted num">{before.toFixed(2)}</span> <Trend now={now} before={before} />
              </span>
              <span className="cbars" aria-hidden="true">
                <i className="now" style={{ width: `${((now / max) * 100).toFixed(1)}%` }} />
                <i className="then" style={{ width: `${((before / max) * 100).toFixed(1)}%` }} />
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
