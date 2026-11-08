// The prep session's plan, from the real exports: a likely line is their most played move and mine at each turn,
// and the plan runs likely lines, then the costly moves to punish, then my key moments (losses first).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { posKey, replay, sideToMove } from "../src/lib/chess";
import { START } from "../src/lib/lines";
import { KEYS_MAX, LIKELY_MIN, LINE_PLIES, likelyLine, prepPlan, prepSections } from "../src/lib/prep";
import type { OpeningReport, Rival, Rivals } from "../src/types/export";

const data = <T,>(p: string): T => JSON.parse(readFileSync(join(__dirname, "../public/data", p), "utf8"));
const h = data<Rivals>("rivals/index.json").rivals[0];
const r = data<Rival>(`rivals/${h.username.toLowerCase()}.json`);
const mine = { white: data<OpeningReport>("openings/white.json"), black: data<OpeningReport>("openings/black.json") };

test("a likely line follows their most played moves and mine, until one of theirs was played only once", () => {
  for (const you of ["white", "black"] as const) {
    const theirs = you === "white" ? r.black : r.white;
    const line = likelyLine(you, theirs, mine[you]);
    const them = new Map(theirs.tree.map((n) => [n.key, n]));
    const me = new Map(mine[you].tree.map((n) => [n.key, n]));
    expect(line.length).toBeGreaterThan(0);
    let fen = START;
    for (const m of line) {
      expect(m.theirs).toBe(sideToMove(fen) !== you);
      if (m.theirs) {
        const n = them.get(posKey(fen))!;
        expect([m.uci, m.games, m.of, m.label, m.drop]).toEqual([n.moves[0].uci, n.moves[0].games, n.games, n.moves[0].label, n.moves[0].drop]);
        expect(m.games).toBeGreaterThanOrEqual(LIKELY_MIN);
      } else {
        const n = me.get(posKey(fen))!;
        expect([m.uci, m.games, m.of]).toEqual([n.moves[0].uci, n.moves[0].games, n.games]);
      }
      fen = replay(fen, [m.uci])[0];
    }
    if (line.length < LINE_PLIES) {   // it stopped where the next move is missing, or theirs is rare
      const theirTurn = sideToMove(fen) !== you;
      const next = (theirTurn ? them : me).get(posKey(fen))?.moves[0];
      expect(!next || (theirTurn && next.games < LIKELY_MIN)).toBe(true);
    }
  }
});

test("the plan: likely lines, then every costly move to punish, then my key moments, losses first", () => {
  const items = prepPlan(h, r, mine);
  const kinds = items.map((x) => x.kind);
  expect(kinds).toEqual([...kinds].sort((a, b) => ["line", "punish", "key"].indexOf(a) - ["line", "punish", "key"].indexOf(b)));
  expect(items.filter((x) => x.kind === "punish").map((x) => x.kind === "punish" && x.index)).toEqual(r.prep.map((_, i) => i));
  const keys = items.flatMap((x) => (x.kind === "key" ? [h.games.find((g) => g.id === x.game)!] : []));
  const keyed = h.games.filter((g) => g.key_ply != null);
  expect(keys.length).toBe(Math.min(KEYS_MAX, keyed.length));
  expect(keys.map((g) => g.result === "loss")).toEqual([...keys.map((g) => g.result === "loss")].sort((a, b) => Number(b) - Number(a)));
  expect(prepSections(items, 1).map((s) => [s.part, s.count, s.done])).toEqual(
    [...new Set(kinds)].map((k, i) => [k, kinds.filter((x) => x === k).length, i === 0 ? 1 : 0]));
});
