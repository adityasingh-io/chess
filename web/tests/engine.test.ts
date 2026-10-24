// UCI parsing: lines as Stockfish prints them. Scores come from the side to move and are turned to White's view.
import { parseInfo } from "../src/lib/engine";

const LINE = "info depth 18 seldepth 24 multipv 2 score cp -35 nodes 812345 nps 1304000 hashfull 120 time 623 pv e7e5 g1f3 b8c6";

test("an info line becomes a scored line from White's point of view", () => {
  expect(parseInfo(LINE, true)).toEqual({ multipv: 2, depth: 18, nps: 1304000, pv: ["e7e5", "g1f3", "b8c6"], eval: { cp: -35, mate: null } });
  expect(parseInfo(LINE, false)?.eval).toEqual({ cp: 35, mate: null });
});

test("mate scores flip with the side to move", () => {
  const mate = "info depth 30 multipv 1 score mate -2 nodes 10 nps 10 pv h7h8 g7h8";
  expect(parseInfo(mate, true)?.eval).toEqual({ cp: null, mate: -2 });
  expect(parseInfo(mate, false)?.eval).toEqual({ cp: null, mate: 2 });
});

test("bounds, currmove lines and strings are skipped", () => {
  expect(parseInfo("info depth 20 multipv 1 score cp 40 lowerbound nodes 5 pv e2e4", true)).toBeNull();
  expect(parseInfo("info depth 20 currmove e2e4 currmovenumber 1", true)).toBeNull();
  expect(parseInfo("info string NNUE evaluation using nn-1111.nnue", true)).toBeNull();
  expect(parseInfo("bestmove e2e4 ponder e7e5", true)).toBeNull();
});
