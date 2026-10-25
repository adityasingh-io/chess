// Which puzzles a session shows and in what order. Ordering only, so the puzzles are stubs.
import { niceTicks } from "../src/components/charts";
import { byLevel, byNewestGame, drillQueue, dueIds, gradeOf, keyGame, keyId, MINE_IN_DRILL, queue, SESSION } from "../src/lib/drill";
import { normalise, Rating, type Item } from "../src/lib/progress";
import type { Puzzle } from "../src/types/export";

const pz = (id: string, extra: Partial<Puzzle> = {}) => ({ id, source: "mine", tags: ["fork"], game: "1", ply: 1, rating: null, ...extra }) as Puzzle;
const item = (due: number): Item => ({
  kind: "puzzle", updated: 0,
  card: { due, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: null },
});

test("due reviews come first, oldest first, then puzzles never tried; tried ones not due are left out", () => {
  const p = normalise({ items: { a: item(300), b: item(100), c: item(9e15) } });
  const list = [pz("a"), pz("b"), pz("c"), pz("d", { game: "5" }), pz("e", { game: "9" })];
  expect(queue(list, p, byNewestGame, SESSION, 1000).map((z) => z.id)).toEqual(["b", "a", "e", "d"]);
  expect(queue(list, p, byNewestGame, 3, 1000)).toHaveLength(3);
});

test("a leak drill takes my own puzzles first, then Lichess puzzles nearest my level", () => {
  const p = normalise({ level: 1000 });
  const mine = Array.from({ length: 8 }, (_, i) => pz(`m${i}`, { game: String(i) }));
  const lichess = [1400, 1050, 600, 980, 1200, 700, 1000].map((r, i) => pz(`l${i}`, { source: "lichess", rating: r }));
  const ids = drillQueue("fork", mine, lichess, p).map((z) => z.id);
  expect(ids).toHaveLength(SESSION);
  expect(ids.slice(0, MINE_IN_DRILL)).toEqual(["m7", "m6", "m5", "m4", "m3"]);
  expect(ids.slice(MINE_IN_DRILL)).toEqual(["l6", "l3", "l1", "l4", "l5"]);
  // With no Lichess puzzles of the kind, my own fill the session.
  expect(drillQueue("fork", mine, [], p)).toHaveLength(8);
  expect(byLevel(1000)(lichess[1], lichess[0])).toBeLessThan(0);
});

test("a shorter drill keeps the same share of my own puzzles", () => {
  const p = normalise({ level: 1000 });
  const mine = Array.from({ length: 8 }, (_, i) => pz(`m${i}`, { game: String(i) }));
  const lichess = [1400, 1050, 600].map((r, i) => pz(`l${i}`, { source: "lichess", rating: r }));
  expect(drillQueue("fork", mine, lichess, p, 3).map((z) => z.id)).toEqual(["m7", "m6", "l1"]);
  expect(drillQueue("fork", mine, lichess, p, 2).map((z) => z.id)).toEqual(["m7", "l1"]);
  expect(drillQueue("fork", mine, [], p, 3)).toHaveLength(3);
});

test("due ids are per kind", () => {
  const p = normalise({ items: { a: item(1), b: { ...item(1), kind: "line" }, c: item(5000), [keyId("185895104948", 24)]: { ...item(1), kind: "key" } } });
  expect(dueIds(p, "puzzle", 1000)).toEqual(["a"]);
  expect(dueIds(p, "line", 1000)).toEqual(["b"]);
  expect(dueIds(p, "key", 1000)).toEqual(["k-185895104948-24"]);
  expect(keyGame("k-185895104948-24")).toBe("185895104948");
});

test("an answer's grade: clean is Good, one slip or a hint is Hard, two slips or shown is Again", () => {
  const o = { solved: true, wrong: 0, hint: false, revealed: false };
  expect(gradeOf(o)).toBe(Rating.Good);
  expect(gradeOf({ ...o, wrong: 1 })).toBe(Rating.Hard);
  expect(gradeOf({ ...o, hint: true })).toBe(Rating.Hard);
  expect(gradeOf({ ...o, wrong: 2 })).toBe(Rating.Again);
  expect(gradeOf({ ...o, solved: false, revealed: true })).toBe(Rating.Again);
});

test("chart ticks are round numbers that cover the maximum", () => {
  expect(niceTicks(37)).toEqual({ top: 40, ticks: [0, 10, 20, 30, 40] });
  expect(niceTicks(0)).toEqual({ top: 1, ticks: [0, 0.5, 1] });
  expect(niceTicks(206, 3)).toEqual({ top: 300, ticks: [0, 100, 200, 300] });
});
