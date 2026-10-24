// Recharts charts. Each is drawn at its box's measured width. The game charts are memoised and the
// current-move cursor is an overlay outside them, so stepping through a long game doesn't redraw them.
import { memo, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceArea, ReferenceDot, ReferenceLine, Tooltip, XAxis, YAxis,
} from "recharts";
import type { RatingPoint } from "../types/export";
import { day, n1 } from "../lib/format";
import { useColors, type Colors } from "../lib/theme";
import type { Severity } from "../lib/names";

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.clientWidth));
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

type TipProps<T> = { active?: boolean; payload?: ReadonlyArray<{ payload?: T }> };
function tip<T>(read: (d: T) => [ReactNode, ReactNode]) {
  return function Tip({ active, payload }: TipProps<T>) {
    const d = payload?.[0]?.payload;
    if (!active || !d) return null;
    const [value, label] = read(d);
    return <div className="tip"><b>{value}</b><span>{label}</span></div>;
  };
}

const tick = (c: Colors) => ({ fill: c.muted, fontSize: 11, fontFamily: "var(--font-num)" });
const sevFill = (c: Colors, s: Severity) => (s === "blunder" ? c.blun : s === "mistake" ? c.mist : c.inacc);

// ---------- rating ----------

const RatingTip = tip<RatingPoint>((p) => [p.rating, day(p.ts)]);

export const RatingChart = memo(function RatingChart({ points, goal, goalDate }: { points: RatingPoint[]; goal: number; goalDate: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const c = useColors();
  const H = w < 560 ? 190 : 240;
  const [gy, gm, gd] = goalDate.split("-").map(Number);
  const year = new Date(points[0].ts * 1000).getFullYear();
  const t0 = new Date(year, 0, 1).getTime() / 1000;
  const goalTs = new Date(gy, gm - 1, gd).getTime() / 1000;
  const t1 = goalTs + 86400;
  const months: number[] = [];
  for (let d = new Date(year, 0, 1); d.getTime() / 1000 < t1; d.setMonth(d.getMonth() + 1)) months.push(d.getTime() / 1000);
  const vals = points.map((p) => p.rating);
  const lo = Math.min(...vals) - 30, hi = Math.max(goal, ...vals) + 30;
  const yTicks: number[] = [];
  for (let v = Math.ceil(lo / 100) * 100; v <= hi; v += 100) yTicks.push(v);
  const last = points[points.length - 1];
  const short = w < 560;

  return (
    <div className="chart-box" ref={ref} style={{ height: H }}>
      {w > 0 && (
        <AreaChart width={w} height={H} data={points} margin={{ top: 14, right: 40, bottom: 0, left: 0 }}
          accessibilityLayer={false}>
          <CartesianGrid vertical={false} stroke={c.line} />
          <XAxis dataKey="ts" type="number" domain={[t0, t1]} ticks={months} allowDataOverflow tick={tick(c)}
            tickLine={false} axisLine={{ stroke: c.line }} interval={0}
            tickFormatter={(t: number) => new Date(t * 1000).toLocaleDateString("en-GB", { month: short ? "narrow" : "short" })} />
          <YAxis domain={[lo, hi]} ticks={yTicks} allowDataOverflow width={40} tick={tick(c)} tickLine={false} axisLine={false} />
          <ReferenceLine y={goal} stroke={c.ink} strokeOpacity={0.5} strokeWidth={1.25}
            label={{ value: `Goal ${goal}`, position: "insideTopLeft", fill: c.ink, fontSize: 11, fontWeight: 650 }} />
          <ReferenceDot x={goalTs} y={goal} r={4.5} fill={c.surface} stroke={c.ink} strokeOpacity={0.7} strokeWidth={2} />
          <Area dataKey="rating" type="linear" baseValue={lo} stroke={c.bar} strokeWidth={2} fill={c.bar} fillOpacity={0.1}
            isAnimationActive={false} dot={false} activeDot={{ r: 4.5, fill: c.bar, stroke: c.surface, strokeWidth: 2 }} />
          <ReferenceDot x={last.ts} y={last.rating} r={4.5} fill={c.bar} stroke={c.surface} strokeWidth={2}
            label={{ value: last.rating, position: "right", fill: c.ink, fontSize: 11, fontWeight: 650 }} />
          <Tooltip content={RatingTip} cursor={{ stroke: c.muted }} isAnimationActive={false} />
        </AreaChart>
      )}
    </div>
  );
});

// ---------- game: Win% after every move, and think time ----------

// Shared geometry so the overlay cursor lands on the charts' x positions.
const Y_AXIS = 32, RIGHT = 10;
const plotX = (w: number, n: number, k: number) => Y_AXIS + (n ? k / n : 0) * Math.max(0, w - Y_AXIS - RIGHT);

/** The ply under a click, from its position. (Recharts' active index lags a tap, whose mouse events all arrive at once.) */
function plyAt(e: SyntheticEvent, n: number): number | null {
  const box = (e.target as Element).closest?.(".chart-box");
  const x = (e as unknown as MouseEvent).clientX;
  if (!box || typeof x !== "number") return null;
  const r = box.getBoundingClientRect();
  const plot = r.width - Y_AXIS - RIGHT;
  if (plot <= 0) return null;
  return Math.max(0, Math.min(n, Math.round(((x - r.left - Y_AXIS) / plot) * n)));
}

type EvalProps = {
  myWin: number[];            // my Win% at the start (index 0) and after each ply
  labels: string[];           // "start", "1. d4", "1…d5", …
  records: { ply: number; severity: Severity }[];
  turning: number | null;
  endgameStart: number | null;
  onPick: (ply: number) => void;
};

type WinPoint = { k: number; v: number; label: string };
const EvalTip = tip<WinPoint>((p) => [`${n1(p.v)}%`, p.label]);
const EVAL_TOP = 22, EVAL_BOTTOM = 22;

const EvalPlot = memo(function EvalPlot({ w, h, myWin, labels, records, turning, endgameStart, onPick }: EvalProps & { w: number; h: number }) {
  const c = useColors();
  const n = myWin.length - 1;
  const data: WinPoint[] = myWin.map((v, k) => ({ k, v, label: labels[k] }));
  const xTicks: number[] = [];
  const step = n > 160 ? 40 : 20;
  for (let k = step; k <= n; k += step) xTicks.push(k);
  return (
    <AreaChart width={w} height={h} data={data} margin={{ top: EVAL_TOP, right: RIGHT, bottom: 0, left: 0 }} accessibilityLayer={false}
      onClick={(_, e) => { const k = plyAt(e, n); if (k != null) onPick(k); }}
      style={{ cursor: "pointer" }}>
      {endgameStart != null && (
        <ReferenceArea x1={endgameStart} x2={n} fill={c.soft} fillOpacity={1} ifOverflow="extendDomain"
          label={{ value: "Endgame", position: "insideTopLeft", fill: c.muted, fontSize: 11 }} />
      )}
      <CartesianGrid vertical={false} stroke={c.line} />
      <XAxis dataKey="k" type="number" domain={[0, n]} ticks={xTicks} tick={tick(c)} tickLine={false} interval={0}
        axisLine={{ stroke: c.line }} height={EVAL_BOTTOM} tickFormatter={(k: number) => String(k / 2)} />
      <YAxis domain={[0, 100]} ticks={[0, 50, 100]} width={Y_AXIS} tick={tick(c)} tickLine={false} axisLine={false} />
      <Area dataKey="v" type="linear" baseValue={0} stroke={c.bar} strokeWidth={2} fill={c.bar} fillOpacity={0.1}
        isAnimationActive={false} dot={false} activeDot={{ r: 4, fill: c.ink, stroke: c.surface, strokeWidth: 2 }} />
      {turning != null && (
        <ReferenceLine x={turning} stroke={c.bad} strokeOpacity={0.6} strokeWidth={2}
          label={{ value: "Turning point", position: "top", fill: c.ink, fontSize: 11, fontWeight: 650 }} />
      )}
      {records.map((r) => (
        <ReferenceDot key={r.ply} x={r.ply} y={myWin[r.ply]} r={4.5} fill={sevFill(c, r.severity)} stroke={c.surface} strokeWidth={2} />
      ))}
      <Tooltip content={EvalTip} cursor={{ stroke: c.muted }} isAnimationActive={false} />
    </AreaChart>
  );
});

export function EvalChart({ cur, ...props }: EvalProps & { cur: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const h = w < 560 ? 160 : 180;
  const n = props.myWin.length - 1;
  const x = plotX(w, n, cur);
  const plotH = h - EVAL_TOP - EVAL_BOTTOM;
  return (
    <div className="chart-box" ref={ref} style={{ height: h }} role="img"
      aria-label={`Your Win% after every move; ${props.records.length} marked mistakes`}>
      {w > 0 && <EvalPlot w={w} h={h} {...props} />}
      {w > 0 && (
        <>
          <div className="chart-cursor" style={{ left: x, top: EVAL_TOP, height: plotH }} />
          <div className="chart-dot" style={{ left: x, top: EVAL_TOP + ((100 - props.myWin[cur]) / 100) * plotH }} />
        </>
      )}
    </div>
  );
}

type ThinkBar = { k: number; t: number; label: string; severity: Severity | null };
const ThinkTip = tip<ThinkBar>((b) => [`${n1(b.t)}s`, b.label]);
const THINK_H = 72, THINK_TOP = 8;

const ThinkPlot = memo(function ThinkPlot({ w, n, bars, onPick }: { w: number; n: number; bars: ThinkBar[]; onPick: (ply: number) => void }) {
  const c = useColors();
  const top = Math.max(10, Math.ceil(Math.max(0, ...bars.map((b) => b.t)) / 10) * 10);
  const size = Math.max(2, Math.min(8, ((w - Y_AXIS - RIGHT) / Math.max(1, n)) * 1.3));
  return (
    <BarChart width={w} height={THINK_H} data={bars} margin={{ top: THINK_TOP, right: RIGHT, bottom: 0, left: 0 }} barSize={size}
      accessibilityLayer={false} style={{ cursor: "pointer" }}
      onClick={(_, e) => {
        const k = plyAt(e, n);
        if (k == null || !bars.length) return;
        onPick(bars.reduce((a, b) => (Math.abs(b.k - k) < Math.abs(a.k - k) ? b : a)).k);   // nearest of my moves
      }}>
      <XAxis dataKey="k" type="number" domain={[0, n]} hide />
      <YAxis domain={[0, top]} ticks={[top]} width={Y_AXIS} tick={tick(c)} tickLine={false} axisLine={false} interval={0}
        tickFormatter={(v: number) => `${v}s`} allowDataOverflow />
      <ReferenceLine y={0} stroke={c.line} />
      <Bar dataKey="t" isAnimationActive={false} radius={[2, 2, 0, 0]}>
        {bars.map((b) => (
          <Cell key={b.k} fill={b.severity ? sevFill(c, b.severity) : c.muted} fillOpacity={b.severity ? 1 : 0.45} />
        ))}
      </Bar>
      <Tooltip content={ThinkTip} cursor={{ fill: c.soft }} isAnimationActive={false} />
    </BarChart>
  );
});

export function ThinkChart({ cur, n, bars, onPick }: { cur: number; n: number; bars: ThinkBar[]; onPick: (ply: number) => void }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  return (
    <div className="chart-box" ref={ref} style={{ height: THINK_H }} role="img" aria-label="Your think time on each of your moves">
      {w > 0 && <ThinkPlot w={w} n={n} bars={bars} onPick={onPick} />}
      {w > 0 && <div className="chart-cursor" style={{ left: plotX(w, n, cur), top: THINK_TOP, height: THINK_H - THINK_TOP }} />}
    </div>
  );
}
export type { ThinkBar };

// ---------- insights ----------

/** Score by the hour a game started. Hours with fewer than `few` games are drawn faint. */
export type HourPoint = { hour: number; games: number; score: number | null; accuracy: number | null };
const HourTip = tip<HourPoint>((p) => [
  p.games ? `${n1(p.score ?? 0)}%` : "No games",
  `${String(p.hour).padStart(2, "0")}:00–${String(p.hour).padStart(2, "0")}:59 · ${p.games} ${p.games === 1 ? "game" : "games"}${p.accuracy != null ? ` · accuracy ${n1(p.accuracy)}` : ""}`,
]);

export function HourChart({ data, few }: { data: HourPoint[]; few: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const c = useColors();
  const H = 180;
  return (
    <div className="chart-box" ref={ref} style={{ height: H }} role="img" aria-label="Your score by the hour your games started">
      {w > 0 && (
        <BarChart width={w} height={H} data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false}
          barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke={c.line} />
          <XAxis dataKey="hour" tick={tick(c)} tickLine={false} axisLine={{ stroke: c.line }} interval={w < 560 ? 5 : 2} />
          <YAxis domain={[0, 100]} ticks={[0, 50, 100]} width={36} tick={tick(c)} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => `${v}%`} />
          <ReferenceLine y={50} stroke={c.muted} strokeDasharray="3 3" />
          <Bar dataKey="score" isAnimationActive={false} radius={[3, 3, 0, 0]}>
            {data.map((d) => <Cell key={d.hour} fill={c.bar} fillOpacity={d.games >= few ? 1 : 0.35} />)}
          </Bar>
          <Tooltip content={HourTip} cursor={{ fill: c.soft }} isAnimationActive={false} />
        </BarChart>
      )}
    </div>
  );
}

/** Mistakes by think time: blunders and the other mistakes stacked, as a share of moves. */
export type RateRow = { label: string; moves: number; blunders: number; mistakes: number; total: number };
const RateTip = tip<RateRow>((r) => [`${n1(r.total)}% of moves`, `${r.label} seconds · ${r.moves.toLocaleString("en-GB")} moves · blunders ${n1(r.blunders)}%`]);

/** A round axis: about `count` steps of 1, 2 or 5 × 10ⁿ from 0 to just above `max`. */
export function niceTicks(max: number, count = 4) {
  const raw = Math.max(max, 1) / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const top = Math.ceil(Math.max(max, 1) / step) * step;
  return { top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(6)) };
}

export function MistakeRateChart({ data }: { data: RateRow[] }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const c = useColors();
  const H = 190;
  const { top, ticks } = niceTicks(Math.max(0, ...data.map((d) => d.total)));
  return (
    <div className="chart-box" ref={ref} style={{ height: H }} role="img"
      aria-label="Share of your moves that were mistakes or blunders, by how long you thought">
      {w > 0 && (
        <BarChart width={w} height={H} data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false}
          barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={c.line} />
          <XAxis dataKey="label" tick={tick(c)} tickLine={false} axisLine={{ stroke: c.line }} interval={0} />
          <YAxis domain={[0, top]} ticks={ticks} width={36} tick={tick(c)} tickLine={false} axisLine={false} tickFormatter={(v: number) => `${v}%`} />
          <Bar dataKey="blunders" stackId="a" fill={c.blun} stroke={c.surface} strokeWidth={1.5} isAnimationActive={false} />
          <Bar dataKey="mistakes" stackId="a" fill={c.mist} stroke={c.surface} strokeWidth={1.5} isAnimationActive={false}
            radius={[3, 3, 0, 0]} />
          <Tooltip content={RateTip} cursor={{ fill: c.soft }} isAnimationActive={false} />
        </BarChart>
      )}
    </div>
  );
}

/** A count per month (time losses). */
export type MonthPoint = { month: string; label: string; n: number };
const MonthTip = tip<MonthPoint>((p) => [String(p.n), p.label]);

export function MonthChart({ data, what }: { data: MonthPoint[]; what: string }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const c = useColors();
  const H = 150;
  const { top, ticks } = niceTicks(Math.max(0, ...data.map((d) => d.n)), 3);
  return (
    <div className="chart-box" ref={ref} style={{ height: H }} role="img" aria-label={what}>
      {w > 0 && (
        <BarChart width={w} height={H} data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} accessibilityLayer={false}
          barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke={c.line} />
          <XAxis dataKey="label" tick={tick(c)} tickLine={false} axisLine={{ stroke: c.line }} interval={0}
            tickFormatter={(l: string) => (w < 560 ? l.slice(0, 1) : l.slice(0, 3))} />
          <YAxis domain={[0, top]} ticks={ticks} width={36} tick={tick(c)} tickLine={false} axisLine={false} />
          <Bar dataKey="n" fill={c.bar} isAnimationActive={false} radius={[3, 3, 0, 0]} />
          <Tooltip content={MonthTip} cursor={{ fill: c.soft }} isAnimationActive={false} />
        </BarChart>
      )}
    </div>
  );
}
