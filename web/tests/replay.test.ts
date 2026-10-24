// The board code against the real exports: replaying every game's moves with chess.js must reproduce the
// pipeline's SAN and every mistake record's position, and our SAN for Stockfish's lines must match the
// pipeline's (python-chess) rendering. chess.js takes a while over every game, hence the long timeouts.
// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { lineSan, numberedLine, replay } from "../src/lib/chess";
import { sanTokens } from "../src/lib/format";
import type { Game } from "../src/types/export";

const DIR = join(__dirname, "../public/data/games");
const games: Game[] = readdirSync(DIR).filter((f) => f !== "index.json")
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")));

test("there are exported games to check", () => {
  expect(games.length).toBeGreaterThan(0);
});

test("every game replays to the stored SAN and record positions", () => {
  for (const g of games) {
    const fens = [g.initial_fen, ...replay(g.initial_fen, g.moves.map((m) => m.uci))];
    expect(fens.length, g.id).toBe(g.moves.length + 1);
    expect(lineSan(g.initial_fen, g.moves.map((m) => m.uci)), g.id).toEqual(g.moves.map((m) => m.san));
    for (const r of g.records) expect(fens[r.ply - 1], r.id).toBe(r.fen);
  }
}, 120_000);

test("Stockfish's lines render the same SAN as the pipeline", () => {
  for (const g of games) {
    const fens = [g.initial_fen, ...replay(g.initial_fen, g.moves.map((m) => m.uci))];
    for (const r of g.records) {
      expect(numberedLine(r.fen, lineSan(r.fen, r.best_line)), r.id).toEqual(sanTokens(r.best_line_san));
      expect(numberedLine(fens[r.ply], lineSan(fens[r.ply], r.reply_line)), r.id).toEqual(sanTokens(r.reply_line_san));
    }
  }
}, 120_000);
