// Training progress: scheduling, merging two devices' records, streaks and per-tag counts. FSRS itself is
// ts-fsrs; these check how the app stores and combines its output. Nothing here judges a chess move, so
// the inputs are hand-made.
import {
  activeLines, addLine, getProgress, grade, importProgress, merge, normalise, Rating, rateLevel, removeLine,
  setProgress, START_LEVEL, streak, tagStats, type Progress,
} from "../src/lib/progress";

const DAY = 86400000;
const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();

beforeEach(() => {
  localStorage.clear();
  setProgress(normalise({}), { silent: true });
});

test("a clean solve comes back days later, a miss sooner, and neither today", () => {
  const now = new Date(at(24));
  grade("good", "puzzle", Rating.Good, ["fork"], now);
  grade("again", "puzzle", Rating.Again, ["pin"], now);
  const p = getProgress();
  const days = (id: string) => (p.items[id].card.due - now.getTime()) / DAY;
  expect(days("good")).toBeGreaterThanOrEqual(1);
  expect(days("again")).toBeGreaterThanOrEqual(1);
  expect(days("good")).toBeGreaterThan(days("again"));
  expect(p.attempts.map((a) => a.id)).toEqual(["good", "again"]);
  expect(JSON.parse(localStorage.getItem("coach-progress-v1")!).items.good.kind).toBe("puzzle");
});

test("merging keeps the newer answer per item, pools attempts once, and takes the newer level", () => {
  const card = (due: number) => ({ due, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0,
    reps: 1, lapses: 0, state: 2, last_review: null });
  const a: Progress = {
    ...normalise({}), level: 950, updated: 10,
    items: { x: { kind: "puzzle", card: card(1), updated: 5 }, y: { kind: "puzzle", card: card(2), updated: 9 } },
    attempts: [{ id: "x", kind: "puzzle", at: 5, grade: Rating.Good, tags: [] }],
  };
  const b: Progress = {
    ...normalise({}), level: 870, updated: 20,
    items: { x: { kind: "puzzle", card: card(3), updated: 7 }, y: { kind: "puzzle", card: card(4), updated: 1 } },
    attempts: [{ id: "x", kind: "puzzle", at: 5, grade: Rating.Good, tags: [] }, { id: "x", kind: "puzzle", at: 7, grade: Rating.Hard, tags: [] }],
  };
  const m = merge(a, b);
  expect(m.items.x.card.due).toBe(3);
  expect(m.items.y.card.due).toBe(2);
  expect(m.attempts.map((x) => x.at)).toEqual([5, 7]);
  expect(m.level).toBe(870);
  expect(m.updated).toBe(20);
  expect(merge(b, a)).toEqual(m);
});

test("a line removed on one device after it was added stays removed when merged", () => {
  addLine({ id: "t-1", colour: "white", name: "1. d4", moves: ["d2d4"] });
  const phone = structuredClone(getProgress());
  phone.lines["t-1"].removed = phone.lines["t-1"].added + 1000;
  const merged = merge(getProgress(), phone);
  expect(activeLines(merged)).toHaveLength(0);
  removeLine("t-1");
  expect(activeLines(getProgress())).toHaveLength(0);
  addLine({ id: "t-1", colour: "white", name: "1. d4", moves: ["d2d4"] });
  expect(activeLines(getProgress()).map((l) => l.id)).toEqual(["t-1"]);
});

test("the streak counts days in a row up to today, or up to yesterday before today's first answer", () => {
  const p = normalise({
    attempts: [at(20), at(22), at(23, 9), at(23, 21)].map((t) => ({ id: "x", kind: "puzzle", at: t, grade: Rating.Good, tags: [] })),
  });
  expect(streak(p, at(24, 8))).toEqual({ today: 0, days: 2 });
  p.attempts.push({ id: "y", kind: "puzzle", at: at(24, 9), grade: Rating.Again, tags: [] });
  expect(streak(p, at(24, 10))).toEqual({ today: 1, days: 3 });
  expect(streak(p, at(26, 10))).toEqual({ today: 0, days: 0 });
});

test("a puzzle answered twice in a day counts once per tag", () => {
  const p = normalise({
    attempts: [
      { id: "x", kind: "puzzle", at: at(24, 9), grade: Rating.Again, tags: ["fork"] },
      { id: "x", kind: "puzzle", at: at(24, 10), grade: Rating.Good, tags: ["fork"] },
      { id: "x", kind: "puzzle", at: at(25, 10), grade: Rating.Good, tags: ["fork"] },
      { id: "z", kind: "line", at: at(25, 10), grade: Rating.Good, tags: ["fork"] },
    ],
  });
  expect(tagStats(p).get("fork")).toEqual({ tries: 2, good: 1 });
});

test("the puzzle level moves like Elo", () => {
  rateLevel(START_LEVEL, true);
  expect(getProgress().level).toBe(START_LEVEL + 20);
  rateLevel(START_LEVEL + 20, false);
  expect(getProgress().level).toBe(START_LEVEL);
});

test("an exported file imports back without changes, and an unknown version is refused", () => {
  grade("a", "puzzle", Rating.Good, [], new Date(at(24)));
  const text = JSON.stringify(getProgress());
  expect(importProgress(text)).toBe(0);
  expect(() => importProgress(JSON.stringify({ version: 2 }))).toThrow(/version/);
});
