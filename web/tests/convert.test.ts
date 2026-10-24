// Convert the win: which stored positions are offered, and the rules' verdict at the end of a game. The
// positions here are rules-only (mate, stalemate, bare kings), so no evaluation is involved.
import { Chess } from "chess.js";
import { thrownStarts, WINNING } from "../src/lib/convert";
import { verdict } from "../src/pages/Convert";
import type { ThrownEntry } from "../src/types/export";

const entry = (game: string, ts: number, win_before: number | null, extra: Partial<ThrownEntry> = {}): ThrownEntry => ({
  game, ts, result: "loss", peak: 95, ply: 30, san: "Kf1", drop: 50, colour: "white", opponent: "x",
  fen: "8/8/8/3k4/8/8/8/Q3K3 w - - 0 1", win_before, ...extra,
});

test("only positions stored at the winning threshold or above are offered, newest first", () => {
  const list = thrownStarts([entry("a", 1, WINNING), entry("b", 3, 95), entry("c", 2, WINNING - 0.1), entry("d", 4, null), entry("e", 5, 90, { fen: null })]);
  expect(list.map((s) => s.id)).toEqual(["thrown-b-30", "thrown-a-30"]);
});

test("the verdict comes from the rules: checkmate either way, stalemate, bare kings, fifty moves", () => {
  expect(verdict(new Chess("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"), "white")).toMatchObject({ won: true });
  expect(verdict(new Chess("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"), "black")).toMatchObject({ won: false });
  expect(verdict(new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), "white")?.text).toMatch(/^Stalemate/);
  expect(verdict(new Chess("7k/8/6K1/8/8/8/8/8 b - - 0 1"), "white")?.text).toMatch(/enough material/);
  expect(verdict(new Chess("7k/8/6K1/8/8/8/8/Q7 b - - 100 80"), "white")?.text).toMatch(/fifty-move/);
  expect(verdict(new Chess("8/8/8/3k4/8/8/8/Q3K3 w - - 0 1"), "white")).toBeNull();
});
