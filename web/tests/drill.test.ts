// Which puzzles a session shows and in what order. Ordering only, so the puzzles are stubs.
import { niceTicks } from "../src/components/charts";
import { byLevel, byNewestGame, drillQueue, dueIds, MINE_IN_DRILL, queue, SESSION } from "../src/lib/drill";
import { normalise, type Item } from "../src/lib/progress";
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

test("due ids are per kind", () => {
  const p = normalise({ items: { a: item(1), b: { ...item(1), kind: "line" }, c: item(5000) } });
  expect(dueIds(p, "puzzle", 1000)).toEqual(["a"]);
  expect(dueIds(p, "line", 1000)).toEqual(["b"]);
});

test("chart ticks are round numbers that cover the maximum", () => {
  expect(niceTicks(37)).toEqual({ top: 40, ticks: [0, 10, 20, 30, 40] });
  expect(niceTicks(0)).toEqual({ top: 1, ticks: [0, 0.5, 1] });
  expect(niceTicks(206, 3)).toEqual({ top: 300, ticks: [0, 100, 200, 300] });
});
