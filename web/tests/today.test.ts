// Today's plan: what a session holds and in what order. Ordering and counting only, so games and puzzles are stubs.
import { keyId } from "../src/lib/drill";
import { normalise, type Item as Card } from "../src/lib/progress";
import { DRILL, KEYS_MAX, losingTags, makePlan, readPlan, REVIEWS_MAX, savePlan, sections } from "../src/lib/today";
import type { Start } from "../src/lib/playout";
import type { GameSummary, Puzzle, PuzzleIndex } from "../src/types/export";

const game = (id: string, key_ply: number | null) => ({ id, key_ply }) as GameSummary;
const pz = (id: string, tags: string[], extra: Partial<Puzzle> = {}) =>
  ({ id, source: "mine", tags, game: "1", ply: 1, rating: null, ...extra }) as Puzzle;
const card = (due: number, kind: Card["kind"] = "puzzle"): Card => ({
  kind, updated: 0,
  card: { due, stability: 1, difficulty: 5, elapsed_days: 0, scheduled_days: 1, learning_steps: 0, reps: 1, lapses: 0, state: 2, last_review: null },
});
const index = { as_of: 0, mine: { hung_piece: 3, allowed_mate: 2, tactic: 1, quiet: 9 }, lichess: { hung_piece: 5, allowed_mate: 5 } } as PuzzleIndex;
const win = (id: string) => ({ id }) as Start;

test("the drill trains the causes of recent losses that a puzzle can train, recent first, then all time", () => {
  const losses = { causes: { quiet: 90, hung_piece: 80, allowed_mate: 20, tactic: 30, missed_mate: 3, gave_up: 40 },
                   causes_30_days: { quiet: 10, hung_piece: 19, allowed_mate: 7, tactic: 2 } };
  // Quiet and gave up aren't one move a puzzle trains; missed mate has no puzzles in the index.
  expect(losingTags(losses, index)).toEqual(["hung_piece", "allowed_mate", "tactic"]);
  expect(losingTags({ causes: { tactic: 30, allowed_mate: 20 }, causes_30_days: {} }, index)).toEqual(["tactic", "allowed_mate"]);
});

test("a plan: new key moments, then 3 + 2 drill puzzles, then reviews by due date, then one win to win again", () => {
  const now = Date.now();
  const games = [game("9", 30), game("8", null), game("7", 12), game("6", 40), game("5", 22), game("4", 18)];
  const p = normalise({ items: {
    [keyId("7", 12)]: card(9e15, "key"),   // tried, not due
    [keyId("4", 18)]: card(1, "key"),      // due, oldest
    [keyId("3", 5)]: card(1, "key"),       // due, but no longer a key moment in the games index
    r1: card(5), r2: card(3), h9: card(2),
  } });
  const mine = [pz("h1", ["hung_piece"], { game: "9" }), pz("h2", ["hung_piece"], { game: "8" }), pz("h3", ["hung_piece"], { game: "7" }),
    pz("h4", ["hung_piece"], { game: "6" }), pz("h9", ["hung_piece"], { game: "2" }), pz("m1", ["allowed_mate"]),
    pz("m2", ["allowed_mate", "hung_piece"]), pz("r1", ["fork"]), pz("r2", ["pin"])];
  const plan = makePlan(games, p, ["hung_piece", "allowed_mate"], mine, [], [win("thrown-a"), win("thrown-b")], { "thrown-a": { tries: 2, reached: 1, last: 0 } }, now);
  const ids = plan.items.map((x) => (x.kind === "key" ? `key:${x.game}${x.due ? ":due" : ""}` : x.kind === "puzzle" ? `${x.tag ?? "review"}:${x.id}` : `play:${x.id}`));
  expect(ids).toEqual([
    "key:9", "key:6", "key:5",                                      // the newest untried ones, KEYS_MAX of them
    "hung_piece:h1", "hung_piece:h2", "hung_piece:h3",             // never tried, my newest games first
    "allowed_mate:m1", "allowed_mate:m2",
    "key:4:due", "review:h9", "review:r2", "review:r1",             // longest overdue first, h9 too though it's a drilled kind
    "play:thrown-b",                                                // the newest not yet won again
  ]);
  expect(KEYS_MAX).toBe(3);
  expect(DRILL).toEqual([3, 2]);
  expect(plan.at).toBe(0);
  expect(plan.marks).toEqual(plan.items.map(() => null));
  expect(sections(plan).map((s) => [s.part, s.count])).toEqual([["key", 3], ["drill", 5], ["review", 4], ["play", 1]]);
});

test("one drillable cause gets all five puzzles, and reviews stop at the limit", () => {
  const mine = Array.from({ length: 9 }, (_, i) => pz(`t${i}`, ["tactic"], { game: String(i) }));
  const due = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`r${i}`, card(i + 1)]));
  const plan = makePlan([], normalise({ items: due }), ["tactic"], [...mine, ...Object.keys(due).map((id) => pz(id, ["fork"]))], [], [], {});
  expect(plan.items.filter((x) => x.kind === "puzzle" && x.tag === "tactic")).toHaveLength(5);
  expect(plan.items.filter((x) => x.kind === "puzzle" && !x.tag)).toHaveLength(REVIEWS_MAX);
});

test("the win to win again comes from a game whose key moment isn't in the session, when there's one", () => {
  const w = (id: string, game: string) => ({ id, thrown: { game } }) as unknown as Start;
  const plan = makePlan([game("9", 30)], normalise({}), [], [], [], [w("thrown-9-30", "9"), w("thrown-8-12", "8")], {});
  expect(plan.items.map((x) => (x.kind === "play" ? x.id : x.kind))).toEqual(["key", "thrown-8-12"]);
  const only = makePlan([game("9", 30)], normalise({}), [], [], [], [w("thrown-9-30", "9")], {});
  expect(only.items.at(-1)).toEqual({ kind: "play", id: "thrown-9-30" });
});

test("a started plan is kept for the day it was made; one not started is made again", () => {
  localStorage.clear();
  const plan = makePlan([game("9", 30)], normalise({}), [], [], [], [], {});
  savePlan(plan);
  expect(readPlan()).toBeNull();
  savePlan({ ...plan, marks: ["clean"] });   // answered, not moved on yet
  expect(readPlan()?.at).toBe(0);
  savePlan({ ...plan, at: 1, marks: ["clean"] });
  expect(readPlan()?.at).toBe(1);
  expect(readPlan(Date.now() + 2 * 86400000)).toBeNull();
});
