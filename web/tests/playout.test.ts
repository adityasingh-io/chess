// Play it out: which stored positions are offered, and the rules' verdict at the end of a game. The
// positions here are rules-only (mate, stalemate, bare kings), so no evaluation is involved.
import { Chess } from "chess.js";
import { reached, resignedStarts, thrownStarts, WINNING } from "../src/lib/playout";
import { verdict } from "../src/pages/PlayOut";
import type { LossEntry, ThrownEntry } from "../src/types/export";

const entry = (game: string, ts: number, win_before: number | null, extra: Partial<ThrownEntry> = {}): ThrownEntry => ({
  game, ts, result: "loss", peak: 95, ply: 30, san: "Kf1", drop: 50, colour: "white", opponent: "x",
  fen: "8/8/8/3k4/8/8/8/Q3K3 w - - 0 1", win_before, ...extra,
});

test("only positions stored at the winning threshold or above are offered, newest first", () => {
  const list = thrownStarts([entry("a", 1, WINNING), entry("b", 3, 95), entry("c", 2, WINNING - 0.1), entry("d", 4, null), entry("e", 5, 90, { fen: null })]);
  expect(list.map((s) => s.id)).toEqual(["thrown-b-30", "thrown-a-30"]);
});

test("games given up start where they ended, newest first, and are saved by not losing", () => {
  const loss = (game: string, ts: number, cause: string): LossEntry => ({
    game, ts, cause, subtype: null, flags: [], turning_ply: null, record: null, colour: "black", opponent: "x",
    final_fen: "8/8/8/3k4/8/8/8/Q3K3 w - - 0 1", final_win: 55,
  });
  expect(resignedStarts([loss("a", 1, "gave_up"), loss("b", 2, "hung_piece"), loss("c", 3, "gave_up")]).map((s) => s.id))
    .toEqual(["resigned-c", "resigned-a"]);
  expect([reached("resigned", "draw"), reached("resigned", "loss"), reached("thrown", "draw"), reached("thrown", "win")])
    .toEqual([true, false, false, true]);
});

test("the verdict comes from the rules: checkmate either way, stalemate, bare kings, fifty moves", () => {
  expect(verdict(new Chess("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"), "white")).toMatchObject({ result: "win" });
  expect(verdict(new Chess("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"), "black")).toMatchObject({ result: "loss" });
  expect(verdict(new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), "white")?.text).toMatch(/^Stalemate/);
  expect(verdict(new Chess("7k/8/6K1/8/8/8/8/8 b - - 0 1"), "white")?.text).toMatch(/enough material/);
  expect(verdict(new Chess("7k/8/6K1/8/8/8/8/Q7 b - - 100 80"), "white")?.text).toMatch(/fifty-move/);
  expect(verdict(new Chess("8/8/8/3k4/8/8/8/Q3K3 w - - 0 1"), "white")).toBeNull();
});
