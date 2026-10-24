// Play it out: which stored positions are offered, and the rules' verdict at the end of a game. The
// positions here are rules-only (mate, stalemate, bare kings), so no evaluation is involved.
import { Chess } from "chess.js";
import { ENDGAME_LOSING, ENDGAME_WINNING, endgameStarts, reached, resignedStarts, thrownStarts, WINNING } from "../src/lib/playout";
import { verdict } from "../src/pages/PlayOut";
import type { EndgameGame, LossEntry, ThrownEntry } from "../src/types/export";

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
  const list = resignedStarts([loss("a", 1, "gave_up"), loss("b", 2, "hung_piece"), loss("c", 3, "gave_up")]);
  expect(list.map((s) => s.id)).toEqual(["resigned-c", "resigned-a"]);
  expect(list.every((s) => s.need === "draw")).toBe(true);
  expect([reached("draw", "draw"), reached("draw", "loss"), reached("win", "draw"), reached("win", "win")])
    .toEqual([true, false, false, true]);
});

test("spoiled endgames start before the spoiling move: a win to play for when winning or a win that got away, a draw when balanced", () => {
  const eg = (game: string, ts: number, spoiler_win: number | null, ply = 70): EndgameGame => ({
    game, ts, result: "draw", colour: "black", opponent: "x", spoiler_fen: "8/8/8/3k4/8/8/8/Q3K3 w - - 0 1", spoiler_win,
    info: { start_ply: 60, type: "rook", win_start: 75, outcome: "spoiled", spoiler_ply: ply, spoiler_san: "Kd5",
            spoiler_drop: 40, spoiler_best_line_san: null },
  });
  const list = endgameStarts([eg("a", 1, ENDGAME_WINNING), eg("b", 2, ENDGAME_LOSING + 1), eg("c", 3, ENDGAME_LOSING), eg("d", 4, null),
                              eg("e", 5, 50, 30)], [entry("e", 5, 50)]);
  expect(list.map((s) => [s.id, s.need])).toEqual([["thrown-e-30", "win"], ["endgame-b-70", "draw"], ["endgame-a-70", "win"]]);
});

test("the verdict comes from the rules: checkmate either way, stalemate, bare kings, fifty moves", () => {
  expect(verdict(new Chess("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"), "white")).toMatchObject({ result: "win" });
  expect(verdict(new Chess("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"), "black")).toMatchObject({ result: "loss" });
  expect(verdict(new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), "white")?.text).toMatch(/^Stalemate/);
  expect(verdict(new Chess("7k/8/6K1/8/8/8/8/8 b - - 0 1"), "white")?.text).toMatch(/enough material/);
  expect(verdict(new Chess("7k/8/6K1/8/8/8/8/Q7 b - - 100 80"), "white")?.text).toMatch(/fifty-move/);
  expect(verdict(new Chess("8/8/8/3k4/8/8/8/Q3K3 w - - 0 1"), "white")).toBeNull();
});
