// Maia-2's rules-level side against recorded Maia-2 output (tests/fixtures/maia.json, from the maia2 Python
// package on positions from my games): the move list, the board encoding, the legal moves and the rating buckets.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { category, encode, MOVES } from "../src/lib/maia";

type Fixture = { moves: string[]; categories: Record<string, number>; cases: { fen: string; planes: number[]; legal: number[] }[] };
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/maia.json"), "utf8")) as Fixture;

test("the move list is Maia-2's, in its order", () => {
  expect(MOVES).toEqual(fixture.moves);
});

test("rating buckets", () => {
  for (const [elo, cat] of Object.entries(fixture.categories)) expect(category(Number(elo))).toBe(cat);
});

test("positions encode as Maia-2 encodes them, Black's flipped, with the same legal moves", () => {
  expect(fixture.cases.some((c) => c.fen.split(" ")[1] === "b")).toBe(true);
  expect(fixture.cases.some((c) => c.fen.split(" ")[3] !== "-")).toBe(true);
  for (const c of fixture.cases) {
    const enc = encode(c.fen);
    const on = [...enc.planes.keys()].filter((i) => enc.planes[i] === 1);
    expect(on, c.fen).toEqual(c.planes);
    expect([...enc.legal].sort((a, b) => a - b), c.fen).toEqual(c.legal);
  }
});
