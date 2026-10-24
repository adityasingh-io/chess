// The Win% port: hand-computed points of the formula, then agreement with the pipeline on every stored
// move (its `win` is computed from its `eval`, or from the result when the game is over by the rules).
// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { outcome, replay } from "../src/lib/chess";
import { winFromCp, winOf, winOfOutcome } from "../src/lib/winpct";
import type { Game } from "../src/types/export";

const DIR = join(__dirname, "../public/data/games");
const games: Game[] = readdirSync(DIR).filter((f) => f !== "index.json")
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));

test("the formula at hand-computed points", () => {
  expect(winFromCp(0)).toBe(50);
  expect(winFromCp(100)).toBeCloseTo(59.1026, 4);
  expect(winFromCp(-250)).toBeCloseTo(28.4852, 4);
  expect(winFromCp(1000)).toBeCloseTo(97.5447, 4);
  expect(winFromCp(5000)).toBe(winFromCp(1000));   // clamped at ±1000
  expect(winOf({ cp: null, mate: 3 })).toBe(winFromCp(1000));
  expect(winOf({ cp: null, mate: -1 })).toBe(winFromCp(-1000));
  expect(winOf({ cp: null, mate: null })).toBeNull();
  expect(winOfOutcome("draw")).toBe(50);
  expect(winOfOutcome("black")).toBe(winFromCp(-1000));
});

test("every stored move's Win% comes from its stored score", () => {
  let checked = 0;
  for (const g of games) {
    const ended = g.moves.some((m) => !m.eval);
    const fens = ended ? [g.initial_fen, ...replay(g.initial_fen, g.moves.map((m) => m.uci))] : [];
    for (const m of g.moves) {
      const o = m.eval ? null : outcome(fens[m.ply]);
      const win = m.eval ? winOf(m.eval) : o ? winOfOutcome(o) : null;
      expect(win, `${g.id} ply ${m.ply}`).not.toBeNull();
      expect(Math.abs(win! - m.win), `${g.id} ply ${m.ply}`).toBeLessThanOrEqual(0.05 + 1e-9);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(1000);
}, 120_000);
