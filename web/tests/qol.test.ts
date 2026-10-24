// Rules-level helpers behind the board options and hover-to-show: finding the moves and squares an explanation
// names, hanging pieces, passing the turn for the threat, the move between two positions, and the missed list.
import { hanging, moveBetween, passTurn, replay } from "../src/lib/chess";
import { missed } from "../src/lib/drill";
import { START } from "../src/lib/lines";
import { Rating, type Progress } from "../src/lib/progress";
import { bestKinds, segments } from "../src/lib/refs";

test("an explanation's moves come from its lines, then from the position after the move named before", () => {
  const [afterE4, afterE5] = replay(START, ["e2e4", "e7e5"]);
  const segs = segments("e4 puts a pawn in the centre on e4; Stockfish answers e5, then Nf3.", [
    { fen: START, ucis: ["e2e4", "e7e5"], kind: bestKinds },
  ], "white");
  expect(segs).toEqual([
    { text: "e4", peek: { fen: START, uci: "e2e4", kind: "best" } },
    " puts a pawn in the centre on ",
    { text: "e4", peek: { squares: ["e4"] } },
    "; Stockfish answers ",
    { text: "e5", peek: { fen: afterE4, uci: "e7e5", kind: "them" } },
    ", then ",
    { text: "Nf3", peek: { fen: afterE5, uci: "g1f3", kind: "best" } },
    ".",
  ]);
  // Scores and material counts aren't moves or squares; a move that fits nowhere stays text.
  expect(segments("(+1 in material), mate in 3, Qh5", [], "white")).toEqual(["(+1 in material), mate in 3, Qh5"]);
});

test("hanging pieces: attacked by the other side and not defended", () => {
  // 1. e4 d5 2. Nc3 Bg4 3. Bc4: both bishops hang; d5 and e4 are defended.
  const fen = "rn1qkbnr/ppp1pppp/8/3p4/2B1P1b1/2N5/PPPP1PPP/R1BQK1NR b KQkq - 3 3";
  expect(hanging(fen).sort((a, b) => a.square.localeCompare(b.square)))
    .toEqual([{ square: "c4", side: "white" }, { square: "g4", side: "black" }]);
  expect(hanging(START)).toEqual([]);
});

test("passing the turn: the other side to move, but not out of check", () => {
  expect(passTurn(START)?.split(" ").slice(0, 2)).toEqual([START.split(" ")[0], "b"]);
  // 1. e4 f6 2. d4 g5 3. Qh5+: Black is in check.
  expect(passTurn(replay(START, ["e2e4", "f7f6", "d2d4", "g7g5", "d1h5"]).at(-1)!)).toBeNull();
});

test("the move between two positions, for move sounds", () => {
  const [e4, d5, exd5] = replay(START, ["e2e4", "d7d5", "e4d5"]);
  expect(moveBetween(START, e4)).toMatchObject({ san: "e4", capture: false, check: false });
  expect(moveBetween(d5, exd5)).toMatchObject({ san: "exd5", capture: true });
  expect(moveBetween(e4, START)).toBeNull();   // a step back
  expect(moveBetween(START, d5)).toBeNull();   // a jump
});

test("missed puzzles: the latest answer wasn't clean, latest first", () => {
  const at = (id: string, t: number, grade: number) => ({ id, kind: "puzzle" as const, at: t, grade: grade as Rating.Good, tags: [] });
  const p = { attempts: [at("a", 1, Rating.Again), at("b", 2, Rating.Hard), at("a", 3, Rating.Good), at("c", 4, Rating.Again),
    { ...at("r", 5, Rating.Again), kind: "line" as const }] } as unknown as Progress;
  expect(missed(p).map((x) => x.id)).toEqual(["c", "b"]);
});
