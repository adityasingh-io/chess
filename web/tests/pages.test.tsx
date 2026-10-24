// Pages rendered with the real exports (fetch reads public/data in tests/setup.ts): numbers on screen must
// be the exported ones.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { lineSan, numberedLine, posKey, replay } from "../src/lib/chess";
import { evalFor, sanTokens } from "../src/lib/format";
import { grade, normalise, Rating, setProgress } from "../src/lib/progress";
import { ENDGAME_TYPE, OUTCOME } from "../src/lib/names";
import { routes } from "../src/router";
import { Chess } from "chess.js";
import { endgameStarts } from "../src/lib/playout";
import type { Endgames, Game, GamesIndex, Insights, Leaks, Losses, OpeningReport, PuzzleIndex, PuzzleSet, Repertoire, Summary } from "../src/types/export";

const data = <T,>(p: string): T => JSON.parse(readFileSync(join(__dirname, "../public/data", p), "utf8"));
const summary = data<Summary>("summary.json");
const losses = data<Losses>("losses.json");

async function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  await act(async () => { render(<RouterProvider router={router} />); });
  return router;
}
const SLOW = { timeout: 10_000 };   // first render waits for the lazily loaded page module
/** A paragraph reading `text`, whose moves and squares may be buttons (hover to see them on the board). */
const para = (text: string) => (_: string, el: Element | null) => el?.tagName === "P" && el.textContent === text;

test("dashboard shows the exported rating and loss shares", async () => {
  await open("/");
  expect(await screen.findByText(String(summary.rating), { selector: ".big" }, SLOW)).toBeTruthy();
  const total = Object.values(losses.causes_30_days).reduce((a, b) => a + b, 0);
  expect(screen.getByText(`Last 30 days (${total} losses)`)).toBeTruthy();
  const [cause, count] = Object.entries(losses.causes_30_days).sort((a, b) => b[1] - a[1])[0];
  const row = (await screen.findAllByRole("link")).find((a) => a.getAttribute("href") === `/games?cause=${cause}`)!;
  expect(within(row).getByText(`${Math.round((count / total) * 100)}%`)).toBeTruthy();
}, 20_000);

test("leaks list every tag with its count", async () => {
  await open("/leaks");
  const leaks = data<Leaks>("leaks.json").leaks.filter((l) => l.count > 0);
  expect(await screen.findAllByRole("link", { name: /Win% lost/ }, SLOW)).toHaveLength(leaks.length);
}, 20_000);

test("the viewer steps through a game with the keyboard", async () => {
  const id = "164948678288";
  const g = data<Game>(`games/${id}.json`);
  await open(`/games/${id}?ply=0`);
  expect(await screen.findByText("Start position", {}, SLOW)).toBeTruthy();
  for (let i = 0; i < 3; i++) await act(async () => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
  expect(screen.getByText(`3 of ${g.moves.length}`, { exact: false })).toBeTruthy();
  await act(async () => { fireEvent.keyDown(window, { key: "End" }); });
  expect(screen.getByText(`${g.moves.length} of ${g.moves.length}`, { exact: false })).toBeTruthy();
  // A mistake record's explanation is the pipeline's template text, shown as is.
  const r = g.records[0];
  fireEvent.click(document.querySelector(`.mv[data-ply="${r.ply}"]`)!);
  expect(await screen.findByText(para(r.explanation))).toBeTruthy();
}, 20_000);

test("a note Claude worded replaces the template, which stays one tap away", async () => {
  const id = "185836926026";
  const g = data<Game>(`games/${id}.json`);
  const r = g.records[0];
  const note = `You played ${r.san}. Stockfish preferred ${r.best_san}.`;
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => String(input).endsWith(`games/${id}.json`)
    ? new Response(JSON.stringify({ ...g, records: g.records.map((x, i) => i === 0 ? { ...x, note } : x) }))
    : real(input)) as typeof fetch;
  try {
    await open(`/games/${id}?ply=${r.ply}`);
    expect(await screen.findByText(para(note), {}, SLOW)).toBeTruthy();
    const details = screen.getByText("Worded by Claude from Stockfish's facts").closest("details")!;
    expect(within(details as HTMLElement).getByText(para(r.explanation))).toBeTruthy();
  } finally {
    globalThis.fetch = real;
  }
}, 20_000);

test("the arrow buttons step the game and stop at its ends; the eval bar shows the stored score", async () => {
  const id = "164948678288";
  const g = data<Game>(`games/${id}.json`);
  await open(`/games/${id}?ply=0`);
  expect(await screen.findByText("Start position", {}, SLOW)).toBeTruthy();
  const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
  expect(button(/^Previous move/).disabled).toBe(true);
  for (let i = 0; i < 5; i++) await act(async () => { fireEvent.click(button(/^Next move/)); });
  expect(screen.getByText(`5 of ${g.moves.length}`, { exact: false })).toBeTruthy();
  const m = g.moves[4];
  const bar = document.querySelector(".v-board .evalbar")!;
  expect(bar.getAttribute("data-win")).toBe(m.win.toFixed(1));
  expect(bar.getAttribute("aria-label")).toContain(`Stockfish ${evalFor(m.eval, g.colour)} for you`);
  await act(async () => { fireEvent.click(button(/^Last move/)); });
  expect(button(/^Next move/).disabled).toBe(true);
}, 20_000);

test("compare steps my move's line and Stockfish's best together", async () => {
  const id = "164948678288";
  const g = data<Game>(`games/${id}.json`);
  const r = g.records[0];
  await open(`/games/${id}?ply=${r.ply}&compare=1`);
  const you = await screen.findByRole("group", { name: "Your move, then Stockfish's line" }, SLOW);
  const best = screen.getByRole("group", { name: "Stockfish's best line" });
  expect(document.querySelectorAll(".cmp-side .board")).toHaveLength(2);
  const pressed = (el: HTMLElement) => within(el).queryByRole("button", { pressed: true })?.textContent ?? null;
  const bars = () => [...document.querySelectorAll(".cmp-side .evalbar")].map((b) => b.getAttribute("aria-label"));
  expect(pressed(you)).toBeNull();
  // Before the move both boards show the same position, so both bars show its score.
  expect(bars()[0]).toContain(evalFor(r.best_eval, r.colour));
  expect(bars()[1]).toContain(evalFor(r.best_eval, r.colour));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Forward a move in both lines/ })); });
  await act(async () => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
  expect(pressed(you)).toBe(sanTokens(r.reply_line_san)[0]);
  expect(pressed(best)).toBe(sanTokens(r.best_line_san)[1]);
  // Then each board's bar is Stockfish's stored score for its line.
  expect(bars()[0]).toContain(evalFor(r.after_eval, r.colour));
  expect(bars()[1]).toContain(evalFor(r.best_eval, r.colour));
  await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
  expect(document.querySelector(".cmp")).toBeNull();
  expect(screen.getByText(`${r.ply} of ${g.moves.length}`, { exact: false })).toBeTruthy();
}, 20_000);

test("a leak position steps through either line", async () => {
  await open("/leaks/hung_piece");
  const card = (await screen.findAllByRole("article", {}, SLOW))[0];
  const chips = () => within(card).getByRole("group", { name: /line/ });
  fireEvent.click(within(card).getByRole("button", { name: "Your move" }));
  fireEvent.click(within(card).getByRole("button", { name: "Forward a move" }));
  fireEvent.click(within(card).getByRole("button", { name: "Forward a move" }));
  const tokens = within(chips()).getAllByRole("button").map((b) => b.textContent);
  expect(within(chips()).getByRole("button", { pressed: true }).textContent).toBe(tokens[1]);
  fireEvent.click(within(card).getByRole("button", { name: "Stockfish's best" }));
  expect(within(chips()).queryByRole("button", { pressed: true })).toBeNull();
}, 20_000);

const pctText = (x: number | null) => (x == null ? "–" : `${x.toFixed(1)}%`);

test("the opening tree shows the exported counts and steps into a child position", async () => {
  const report = data<OpeningReport>("openings/white.json");
  const root = report.tree[0];
  await open("/openings/white");
  const tree = await screen.findByRole("region", { name: "Your opening tree as White" }, SLOW);
  expect(within(tree).getByText(`${root.games} games`)).toBeTruthy();
  expect(within(tree).getByText(`your score ${pctText(root.score)}`)).toBeTruthy();
  // The first row of the moves table is my most played move with its games and score.
  const top = root.moves[0];
  const row = within(tree).getAllByRole("row").find((r) => r.textContent?.includes(top.san))!;
  expect(within(row).getByText(String(top.games))).toBeTruthy();
  expect(within(row).getByText(pctText(top.score))).toBeTruthy();
  // ▶ follows my most played move; the position after it is a tree node with its own count.
  await act(async () => { fireEvent.click(within(tree).getByRole("button", { name: "Forward along your most played move" })); });
  const child = report.tree.find((n) => n.key === posKey(replay(root.fen, [top.uci])[0]))!;
  expect(within(tree).getByText(`${child.games} games`)).toBeTruthy();
  expect(within(tree).getByRole("button", { name: /^1\. / , pressed: true })).toBeTruthy();
  expect(document.querySelectorAll(".fam")).toHaveLength(report.families.length);
}, 20_000);

test("the endgame table matches the export and a cell filters the list", async () => {
  const e = data<Endgames>("endgames.json");
  await open("/endgames");
  expect(await screen.findByRole("button", { name: `All outcomes, every type: ${e.endgames.length}` }, SLOW)).toBeTruthy();
  for (const [type, row] of Object.entries(e.table)) {
    for (const [outcome, n] of Object.entries(row)) {
      expect(screen.getByRole("button", { name: `${OUTCOME[outcome]}, ${ENDGAME_TYPE[type]}: ${n}` })).toBeTruthy();
    }
  }
  const words = (n: number) => `${n} game${n === 1 ? "" : "s"}, newest first`;
  const spoiled = e.endgames.filter((x) => x.info.outcome === "spoiled");
  expect(screen.getByText(words(spoiled.length))).toBeTruthy();
  const rook = e.endgames.filter((x) => x.info.type === "rook");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: `All outcomes, Rook: ${rook.length}` })); });
  expect(screen.getByText(words(rook.length))).toBeTruthy();
}, 20_000);

test("Endgames → Practice: a drill per endgame type with the exported counts, and the spoiled ones to play out", async () => {
  const index = data<PuzzleIndex>("puzzles/index.json");
  const starts = endgameStarts(data<Endgames>("endgames.json").endgames, losses.thrown);
  const router = await open("/endgames");
  const rook = await screen.findByRole("link", { name: /^Rook endgames/ }, SLOW);
  expect(rook.getAttribute("href")).toBe("/puzzles?drill=endgame_rook&from=endgames");
  expect(within(rook).getByText(`${index.mine.endgame_rook ?? 0} of yours · ${index.lichess.endgame_rook} from Lichess`)).toBeTruthy();
  const play = screen.getByRole("link", { name: /^Play out your spoiled endgames/ });
  expect(within(play).getByText(`${starts.length} positions against Stockfish, ${starts.length} not yet redone`)).toBeTruthy();
  await act(async () => { await router.navigate("/puzzles?drill=endgame_rook&from=endgames"); });
  expect(await screen.findByRole("heading", { name: "Drill: Rook endgames" }, SLOW)).toBeTruthy();
  expect(screen.getByRole("link", { name: "← Back to endgames" }).getAttribute("href")).toBe("/endgames");
}, 20_000);

test("insights show the exported group scores, leak rates and time losses", async () => {
  const ins = data<Insights>("insights.json");
  await open("/insights");
  const colour = await screen.findByRole("table", { name: "Score and accuracy by colour" }, SLOW);
  for (const c of ins.by_colour) {
    const row = within(colour).getByRole("row", { name: new RegExp(`^As ${c.key === "white" ? "White" : "Black"}`) });
    expect(within(row).getByText(String(c.games))).toBeTruthy();
    expect(within(row).getByText(pctText(c.score))).toBeTruthy();
  }
  const rates = ins.leak_rates as { recent: Record<string, number>; previous: Record<string, number> };
  const hung = screen.getByRole("link", { name: /^Hung a piece/ });
  // Both rates are shown; they can be equal, so count matches instead of expecting one each.
  const recent = rates.recent.hung_piece.toFixed(2), previous = rates.previous.hung_piece.toFixed(2);
  expect(within(hung).getAllByText(recent)).toHaveLength(recent === previous ? 2 : 1);
  if (recent !== previous) expect(within(hung).getByText(previous)).toBeTruthy();
  const losses = ins.time_losses as { count: number };
  expect(screen.getByText(`${losses.count} games in all`)).toBeTruthy();
  // Endgames: how often each start band ended well, lately against before.
  const w = ins.endgames!.recent;
  const converted = screen.getByRole("link", { name: /^Winning ones converted/ });
  expect(within(converted).getByText(`${w.converted} of ${w.winning}`)).toBeTruthy();
  expect(screen.getByText(`Last ${w.endgames} endgames`)).toBeTruthy();
}, 20_000);

test("Play on: a move on a Compare board plays on from its line, and Esc goes back to the lines", async () => {
  localStorage.clear();
  localStorage.setItem("coach-bot", "off");   // nobody answers: no engine runs in jsdom
  const engines = globalThis.Worker;
  globalThis.Worker = class { onmessage = null; onerror = null; postMessage() {} terminate() {} } as unknown as typeof Worker;
  try {
    const id = "164948678288";
    const g = data<Game>(`games/${id}.json`);
    const r = g.records[0];
    await open(`/games/${id}?ply=${r.ply}&compare=1`);
    await screen.findByRole("group", { name: "Stockfish's best line" }, SLOW);
    expect(screen.getByRole("group", { name: "Who answers your moves" })).toBeTruthy();
    const before = replay(g.initial_fen, g.moves.slice(0, r.ply - 1).map((m) => m.uci)).at(-1)!;
    const mv = new Chess(before).moves({ verbose: true })[0];
    const board = `game-${id}-best`;
    await act(async () => { fireEvent.click(document.getElementById(`${board}-square-${mv.from}`)!); });
    await act(async () => { fireEvent.click(document.getElementById(`${board}-square-${mv.to}`)!); });
    const played = screen.getByRole("group", { name: "Played on from here" });
    expect(within(played).getByRole("button", { pressed: true }).textContent).toBe(numberedLine(before, [mv.san])[0]);
    expect(document.getElementById(`${board}-square-${mv.to}`)!.querySelector("[data-piece]")).not.toBeNull();
    await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
    expect(screen.queryByRole("group", { name: "Played on from here" })).toBeNull();
    expect(document.querySelector(".cmp")).not.toBeNull();
  } finally {
    globalThis.Worker = engines;
  }
}, 20_000);

test("marks: a Brilliant move has its badge in the move list, its reason in the explanation, and a count that goes to it", async () => {
  // The first game (by id) with a Brilliant move of mine.
  const games = readdirSync(join(__dirname, "../public/data/games")).sort().map((f) => data<Game>(`games/${f}`));
  const g = games.find((x) => x.moves.some((m) => m.side === x.colour && m.mark?.kind === "brilliant"))!;
  const m = g.moves.find((x) => x.side === g.colour && x.mark?.kind === "brilliant")!;
  const fens = [g.initial_fen, ...replay(g.initial_fen, g.moves.map((x) => x.uci))];
  await open(`/games/${g.id}?ply=0`);
  await screen.findByRole("button", { name: /^Explore/ }, SLOW);
  const moveCell = document.querySelector(`.moves .mv[data-ply="${m.ply}"]`)!;
  expect(moveCell.querySelector(".markb.brilliant")?.textContent).toBe("!!");
  // The classifications table: every move counted once per side; my Brilliant count goes to the move.
  const table = document.querySelector(".classes-table")!;
  const mine = [...table.querySelectorAll("tbody tr")].map((tr) => Number(tr.querySelectorAll("td")[0].textContent));
  expect(mine.reduce((a, b) => a + b, 0)).toBe(g.moves.filter((x) => x.side === g.colour).length);
  const row = [...table.querySelectorAll("tbody tr")].find((tr) => tr.querySelector("th")!.textContent!.includes("Brilliant"))!;
  const brilliants = g.moves.filter((x) => x.side === g.colour && x.mark?.kind === "brilliant").length;
  expect(row.querySelectorAll("td")[0].textContent).toBe(String(brilliants));
  await act(async () => { fireEvent.click(row.querySelector("td button")!); });
  expect(document.querySelector('.moves .mv[aria-current="step"]')?.getAttribute("data-ply")).toBe(String(m.ply));
  // The explanation says why, from the stored line: the reply that takes the piece, then my next move.
  const lead = document.querySelector(".v-explain .lead")!;
  expect(lead.querySelector(".markb.brilliant")).not.toBeNull();
  expect(lead.textContent).toContain("Brilliant");
  const line = numberedLine(fens[m.ply], lineSan(fens[m.ply], m.mark!.line, 2)).join(" ");
  const down = -m.mark!.material!;
  expect(document.querySelector(".v-explain")!.textContent).toContain(
    `A sacrifice that works: after ${line} you're ${down} point${down === 1 ? "" : "s"} of material down`);
}, 20_000);

test("Compare is always in the button row: greyed out with the reason where there's nothing to compare", async () => {
  const id = "164948678288";
  const r = data<Game>(`games/${id}.json`).records[0];
  await open(`/games/${id}?ply=0`);
  const compare = await screen.findByRole("button", { name: "Compare" }, SLOW);
  expect(compare.getAttribute("aria-disabled")).toBe("true");
  await act(async () => { fireEvent.click(compare); });
  expect(document.querySelector(".nav-note")?.textContent).toMatch(/^Compare puts one of your moves next to Stockfish's best/);
  expect(document.querySelector(".cmp")).toBeNull();
  // A step on: the reason goes with the move it was for.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next move (→)" })); });
  expect(document.querySelector(".nav-note")).toBeNull();
  // On a mistake of mine it opens the comparison.
  cleanup();
  await open(`/games/${id}?ply=${r.ply}`);
  const mine = await screen.findByRole("button", { name: "Compare" }, SLOW);
  expect(mine.getAttribute("aria-disabled")).toBe("false");
  await act(async () => { fireEvent.click(mine); });
  expect(document.querySelector(".cmp")).not.toBeNull();
}, 20_000);

/** Runs `body` with Worker stubbed out: the live engine and the bots start but never answer. */
async function noWorkers(body: () => Promise<void>) {
  const engines = globalThis.Worker;
  globalThis.Worker = class { onmessage = null; onerror = null; postMessage() {} terminate() {} } as unknown as typeof Worker;
  try { await body(); } finally { globalThis.Worker = engines; }
}
/** A legal move in `fen` other than `not` (uci), as chess.js gives it. */
const otherMove = (fen: string, not?: string) => new Chess(fen).moves({ verbose: true }).find((x) => x.from + x.to !== not?.slice(0, 4))!;
const uciOf = (x: { from: string; to: string; promotion?: string }) => x.from + x.to + (x.promotion ?? "");
const curPly = () => document.querySelector('.moves .mv[aria-current="step"]')?.getAttribute("data-ply") ?? null;

test("Explore: a move off the game starts a side line under it; a bot picked on its turn answers at once", async () => {
  localStorage.clear();
  localStorage.setItem("coach-bot", "off");
  await noWorkers(async () => {
    const id = "164948678288";
    const g = data<Game>(`games/${id}.json`);
    await open(`/games/${id}?ply=0`);
    await act(async () => { fireEvent.click(await screen.findByRole("button", { name: /^Explore/ }, SLOW)); });
    const who = screen.getByRole("group", { name: "Who answers your moves" });
    expect(within(who).getByRole("button", { pressed: true }).textContent).toBe("Nobody");
    const mv = otherMove(g.initial_fen, g.moves[0].uci);
    const sq = (s: string) => document.getElementById(`game-${id}-square-${s}`)!;
    await act(async () => { fireEvent.click(sq(mv.from)); });
    await act(async () => { fireEvent.click(sq(mv.to)); });
    const name = numberedLine(g.initial_fen, [mv.san])[0];
    const line = screen.getByRole("group", { name: `Side line ${name}` });
    expect(within(line).getByRole("button", { current: "step" }).textContent).toBe(name);
    const panel = screen.getByRole("group", { name: "This side line" });
    expect(within(panel).getAllByRole("button").map((b) => b.textContent)).toEqual([name]);
    expect(document.querySelector(".v-board .playon")!.textContent).toContain("Nobody answers: play any move, for either side.");
    // It's the other side's turn at the end of the side line, so the bot picked now moves straight away.
    await act(async () => { fireEvent.click(within(who).getByRole("button", { name: "~800" })); });
    expect(localStorage.getItem("coach-bot")).toBe("maia-800");
    expect(document.querySelector(".v-board .playon")!.textContent).toContain("Maia ~800 is choosing…");
  });
}, 20_000);

test("◀ ▶ follow the side line the board is on, then the game again from where it leaves it", async () => {
  localStorage.clear();
  localStorage.setItem("coach-bot", "off");
  await noWorkers(async () => {
    const id = "164948678288";
    const g = data<Game>(`games/${id}.json`);
    const k = 10;
    const fen = replay(g.initial_fen, g.moves.slice(0, k).map((x) => x.uci)).at(-1)!;
    await open(`/games/${id}?ply=${k}`);
    await screen.findByRole("button", { name: /^Explore/ }, SLOW);
    const sq = (s: string) => document.getElementById(`game-${id}-square-${s}`)!;
    const tapMove = async (x: { from: string; to: string }) => {
      await act(async () => { fireEvent.click(sq(x.from)); });
      await act(async () => { fireEvent.click(sq(x.to)); });
    };
    const nav = (label: RegExp) => act(async () => { fireEvent.click(screen.getByRole("button", { name: label })); });
    // Two moves off the game, for both sides (nobody answers).
    const a = otherMove(fen, g.moves[k].uci);
    const afterA = replay(fen, [uciOf(a)])[0];
    const b = otherMove(afterA);
    await tapMove(a);
    await tapMove(b);
    const first = numberedLine(fen, [a.san])[0];
    const line = screen.getByRole("group", { name: `Side line ${first}` });
    expect(within(line).getAllByRole("button").map((x) => x.textContent)).toEqual([...numberedLine(fen, [a.san, b.san]), "×"]);
    expect(screen.getByRole("button", { name: /^Forward along this side line/ }).hasAttribute("disabled")).toBe(true);
    expect(curPly()).toBeNull();
    // ◀ steps back along the side line, then onto the game where it leaves it; ▶ there follows the game.
    await nav(/^Back a move/);
    expect(within(line).getByRole("button", { current: "step" }).textContent).toBe(first);
    await nav(/^Back a move/);
    expect(curPly()).toBe(String(k));
    await nav(/^Next move/);
    expect(curPly()).toBe(String(k + 1));
    // Back into the side line from the move list; a different move from its first position starts a side line
    // inside it, listed after the move it's an alternative to.
    await act(async () => { fireEvent.click(within(line).getByRole("button", { name: first })); });
    const c = otherMove(afterA, uciOf(b));
    await tapMove(c);
    const inner = within(line).getByRole("group", { name: /^Side line / });
    expect(within(inner).getByRole("button", { current: "step" })).toBeTruthy();
    await nav(/^Back a move/);
    expect(within(line).getByRole("button", { current: "step" }).textContent).toBe(first);
    await nav(/^Forward along this side line/);
    expect(within(line).getByRole("button", { current: "step" }).textContent).toBe(b.san);
    // Removing the side line takes its inner one with it and puts the board back on the game.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: `Remove the side line ${first}` })); });
    expect(document.querySelector(".moves .var")).toBeNull();
    expect(curPly()).toBe(String(k));
  });
}, 20_000);

// Phase 5: drills. Moves are played by tapping squares, as on a phone.
const tap = async (boardId: string, square: string) => {
  await act(async () => { fireEvent.click(document.getElementById(`${boardId}-square-${square}`)!); });
};
const progress = () => JSON.parse(localStorage.getItem("coach-progress-v1") ?? "{}");

test("a leak's drill starts with my newest puzzle of that kind, and solving it schedules a review", async () => {
  localStorage.clear();
  const mine = data<PuzzleSet>("puzzles/mine.json").puzzles.filter((z) => z.tags.includes("hung_piece"))
    .sort((a, b) => Number(b.game) - Number(a.game) || (a.ply ?? 0) - (b.ply ?? 0));
  const z = mine[0];
  await open("/puzzles?drill=hung_piece");
  expect(await screen.findByRole("heading", { name: "Drill: Hung a piece" }, SLOW)).toBeTruthy();
  await screen.findByText(/Find the best move/, {}, SLOW);
  const board = `pz-${z.id}`;
  // A wrong move first (any legal move that isn't the solution), then the solution.
  const legal = new Chess(z.fen).moves({ verbose: true }).find((m) => m.from + m.to !== z.solution[0].slice(0, 4))!;
  await tap(board, legal.from);
  await tap(board, legal.to);
  expect(await screen.findByText(/isn't it/)).toBeTruthy();
  for (let i = 0; i < z.solution.length; i += 2) {
    await tap(board, z.solution[i].slice(0, 2));
    await tap(board, z.solution[i].slice(2, 4));
    if (i + 2 < z.solution.length) await screen.findByText("Good. Keep going.", {}, { timeout: 3000 });
  }
  expect(await screen.findByText("Solved, with help.", {}, { timeout: 5000 })).toBeTruthy();
  // Once it's over, what the solution does on the board.
  expect(screen.getByText(para(z.why))).toBeTruthy();
  const p = progress();
  expect(p.items[z.id].kind).toBe("puzzle");
  expect(p.attempts[0].grade).toBe(2);   // one wrong move: Hard
  expect(p.items[z.id].card.due).toBeGreaterThan(Date.now());
}, 30_000);

test("a new leak line is shown first: the arrow, Stockfish's move and why, then the whole line", async () => {
  localStorage.clear();
  const line = data<Repertoire>("repertoire.json").lines.find((l) => l.source === "leak")!;
  await open("/trainer");
  const row = await screen.findByRole("button", { name: new RegExp(`^${line.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }, SLOW);
  await act(async () => { fireEvent.click(row); });
  expect(await screen.findByText(/the arrow shows it/, {}, SLOW)).toBeTruthy();
  const step = line.steps[line.start];
  expect(screen.getByText(`Why ${step.san}`)).toBeTruthy();
  if (step.reason) expect(screen.getAllByText(para(step.reason)).length).toBeGreaterThan(0);
  const board = `line-${line.id}`;
  const expected = line.moves[line.start];
  await tap(board, expected.slice(0, 2));
  await tap(board, expected.slice(2, 4));
  expect(await screen.findByText("Line learned.", {}, { timeout: 5000 })).toBeTruthy();
  expect(screen.getByRole("list", { name: "The whole line, move by move" }).children).toHaveLength(line.moves.length);
  expect(progress().items[`r-${line.id}`].kind).toBe("line");
}, 30_000);

test("from memory, a slip shows Stockfish's stored score for it and what happens along its line", async () => {
  localStorage.clear();
  const rep = data<Repertoire>("repertoire.json");
  const line = rep.lines.find((l) => l.source === "leak")!;
  const step = line.steps[line.start];
  const alt = rep.positions[step.key!].find((a) => a.uci !== line.moves[line.start] && a.uci.length === 4 && a.why && a.eval && a.win != null)!;
  grade(`r-${line.id}`, "line", Rating.Good);   // drilled before, so it's asked from memory
  await open("/trainer");
  const row = await screen.findByRole("button", { name: new RegExp(`^${line.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`) }, SLOW);
  await act(async () => { fireEvent.click(row); });
  expect(await screen.findByText("You've gone wrong here before. Stockfish's move?", {}, SLOW)).toBeTruthy();
  const board = `line-${line.id}`;
  await tap(board, alt.uci.slice(0, 2));
  await tap(board, alt.uci.slice(2, 4));
  expect(await screen.findByText(/isn't the line's move/)).toBeTruthy();
  expect(screen.getByText(para(alt.why))).toBeTruthy();
  const miss = document.querySelector(".puzzle-miss")!;
  expect(miss.textContent).toContain(evalFor(alt.eval, line.colour));
}, 30_000);

test("settings show the progress counts and that sync is off in this build", async () => {
  localStorage.clear();
  await open("/settings");
  expect(await screen.findByRole("heading", { name: "Settings" }, SLOW)).toBeTruthy();
  expect(screen.getByText(/This build has no sync set up/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Export as JSON" })).toBeTruthy();
}, 20_000);

test("Drill this line adds the tree's line to the trainer", async () => {
  localStorage.clear();
  await open("/openings/white?line=d2d4,d7d5,c2c4");
  const add = await screen.findByRole("button", { name: "Drill this line" }, SLOW);
  await act(async () => { fireEvent.click(add); });
  expect(screen.getByRole("link", { name: "In the trainer" })).toBeTruthy();
  const lines = Object.values(progress().lines) as { moves: string[]; colour: string }[];
  expect(lines).toEqual([expect.objectContaining({ moves: ["d2d4", "d7d5", "c2c4"], colour: "white" })]);
  await open("/trainer");
  expect(await screen.findByRole("button", { name: /^1\. d4 d5 2\. c4/ }, SLOW)).toBeTruthy();
}, 30_000);

test("play it out lists stored winning and given-up positions, and ?play opens one with the stored Win%", async () => {
  const thrown = losses.thrown.filter((t) => t.fen && t.ply && t.win_before != null && t.win_before >= 80);
  const gaveUp = losses.losses.filter((l) => l.cause === "gave_up");
  await open("/play");
  expect(await screen.findByText(`0 of ${thrown.length} positions won again`, {}, SLOW)).toBeTruthy();
  expect(screen.getByText(`0 of ${gaveUp.length} positions saved`)).toBeTruthy();
  const t = [...thrown].sort((a, b) => b.ts - a.ts)[0];
  cleanup();
  await open(`/play?play=thrown-${t.game}-${t.ply}`);
  const side = (await screen.findAllByText(/Stockfish had you at/, {}, SLOW))[0].closest(".puzzle-side") as HTMLElement;
  expect(within(side).getByText(`${t.win_before!.toFixed(1)}%`)).toBeTruthy();
  expect(within(side).getByText(new RegExp(`You're ${t.colour === "white" ? "White" : "Black"}, to move`))).toBeTruthy();
}, 20_000);

test("play it out lists spoiled endgames before the spoiling move, each with its goal", async () => {
  const starts = endgameStarts(data<Endgames>("endgames.json").endgames, losses.thrown);
  await open("/play");
  expect(await screen.findByText(`0 of ${starts.length} positions redone`, {}, SLOW)).toBeTruthy();
  for (const need of ["win", "draw"] as const) {
    const s = starts.find((x) => x.need === need && x.id.startsWith("endgame-"));   // the rest are also thrown wins, opened as those
    if (!s) continue;
    cleanup();
    await open(`/play?play=${s.id}`);
    const side = (await screen.findAllByText(/Stockfish had you at/, {}, SLOW))[0].closest(".puzzle-side") as HTMLElement;
    expect(within(side).getByText(`${s.win!.toFixed(1)}%`)).toBeTruthy();
    expect(within(side).getByText(need === "win" ? /Checkmate Stockfish to win it/ : /a draw or a win saves it/)).toBeTruthy();
    expect(within(side).getByText(/just before the move that spoiled the endgame/)).toBeTruthy();
  }
}, 30_000);

test("the dashboard's last game is the newest one, and ?game retries its puzzles in order", async () => {
  const g = data<GamesIndex>("games/index.json").games.find((x) => x.puzzles > 0)!;
  const newest = data<GamesIndex>("games/index.json").games[0];
  await open("/");
  const card = (await screen.findByRole("region", { name: "Last game" }, SLOW));
  expect(within(card).getByText(newest.opponent, { exact: false })).toBeTruthy();
  cleanup();
  await open(`/puzzles?game=${g.id}`);
  expect(await screen.findByText(`Puzzle 1 of ${g.puzzles}`, {}, SLOW)).toBeTruthy();
  expect(screen.getByText("This game's mistakes")).toBeTruthy();
}, 20_000);

test("Settings → Board: square names on every square and rings on hanging pieces, kept on this device", async () => {
  localStorage.clear();
  await open("/settings");
  const names = await screen.findByRole("checkbox", { name: /Square names on every square/ }, SLOW);
  expect(document.querySelector("#settings-preview-board")?.parentElement?.querySelector(".square-names")).toBeNull();
  await act(async () => { fireEvent.click(names); });
  const grid = document.querySelector(".square-names")!;
  expect(grid.children).toHaveLength(64);
  expect(grid.children[0].textContent).toBe("a8");   // White at the bottom: a8 is the top-left square
  await act(async () => { fireEvent.click(screen.getByRole("checkbox", { name: /Mark hanging pieces/ })); });
  // The preview: 1. e4 d5 2. Nc3 Bg4 3. Bc4, where both bishops hang.
  const ring = (sq: string) => document.getElementById(`settings-preview-square-${sq}`)!.innerHTML;
  expect(ring("c4")).toContain("var(--bad)");
  expect(ring("g4")).toContain("var(--good)");
  expect(ring("d5")).not.toContain("inset");
  expect(JSON.parse(localStorage.getItem("coach-settings")!)).toMatchObject({ squareNames: true, hanging: true, sounds: false });
}, 20_000);

test("tapping a move in an explanation shows the position before it on the board, until it's tapped again", async () => {
  const id = "164948678288";
  const g = data<Game>(`games/${id}.json`);
  const r = g.records[0];
  await open(`/games/${id}?ply=${r.ply}`);
  await screen.findByText(para(r.explanation), {}, SLOW);
  const best = screen.getAllByRole("button", { name: `Show ${r.best_san} on the board` })[0];
  // My move's piece is back on the square it left: the board shows the position before my move.
  const from = r.uci.slice(0, 2), piece = (r.colour === "white" ? "w" : "b") + (/^[KQRBN]/.test(r.san) ? r.san[0] : "P");
  const onFrom = () => document.getElementById(`game-${id}-piece-${piece}-${from}`);
  expect(onFrom()).toBeNull();
  await act(async () => { fireEvent.click(best); });
  expect(best.getAttribute("aria-pressed")).toBe("true");
  expect(onFrom()).not.toBeNull();
  await act(async () => { fireEvent.click(best); });
  expect(onFrom()).toBeNull();

  // Shown, then a step away and back: the board shows the game again, not the move from before.
  await act(async () => { fireEvent.click(best); });
  expect(onFrom()).not.toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Next move (→)" })); });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Previous move (←)" })); });
  expect(onFrom()).toBeNull();
  expect(screen.getAllByRole("button", { name: `Show ${r.best_san} on the board` })[0].getAttribute("aria-pressed")).toBe("false");
}, 20_000);

test("a puzzle from my game, once over, steps through my move's line as well as Stockfish's", async () => {
  localStorage.clear();
  const z = data<PuzzleSet>("puzzles/mine.json").puzzles.find((x) => x.played_line.length >= 3)!;
  await open(`/puzzles?tab=missed&id=${z.id}`);
  grade(z.id, "puzzle", Rating.Again, z.tags);   // so it's on the missed list; the session plays it either way
  const reveal = await screen.findByRole("button", { name: "Show the solution" }, SLOW);
  await act(async () => { fireEvent.click(reveal); });
  const yours = await screen.findByRole("group", { name: "Your move in the game, then Stockfish's line" }, { timeout: 5000 });
  const chips = within(yours).getAllByRole("button");
  expect(chips.map((c) => c.textContent)).toEqual(numberedLine(z.fen, z.played_line_san));
  await act(async () => { fireEvent.click(chips[0]); });
  // After my move, its piece stands on the square it went to.
  const to = z.played_line[0].slice(2, 4);
  expect(document.getElementById(`pz-${z.id}-square-${to}`)!.querySelector("[data-piece]")).not.toBeNull();
  expect(chips[0].getAttribute("aria-pressed")).toBe("true");
}, 20_000);

test("missed puzzles are listed latest first, and each one plays again", async () => {
  localStorage.clear();
  setProgress(normalise({}));
  const [a, b] = data<PuzzleSet>("puzzles/mine.json").puzzles;
  grade(a.id, "puzzle", Rating.Again, a.tags, new Date(Date.now() - 60_000));
  grade(b.id, "puzzle", Rating.Hard, b.tags);
  await open("/puzzles?tab=missed");
  expect(await screen.findByRole("heading", { name: "Missed puzzles" }, SLOW)).toBeTruthy();
  const rows = screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/puzzles?tab=missed&id="));
  expect(rows.map((l) => l.getAttribute("href"))).toEqual([b.id, a.id].map((x) => `/puzzles?tab=missed&id=${x}`));
  expect(within(rows[0]).getByText(/with help/)).toBeTruthy();
  await act(async () => { fireEvent.click(rows[1]); });
  expect(await screen.findByText("Puzzle 1 of 1", {}, SLOW)).toBeTruthy();
  expect(document.getElementById(`pz-${a.id}-board`)).not.toBeNull();
}, 20_000);

test("the coordinates drill counts the squares tapped in time", async () => {
  localStorage.clear();
  await open("/coordinates");
  const start = await screen.findByRole("button", { name: "Start" }, SLOW);
  await act(async () => { fireEvent.click(start); });
  const target = () => document.querySelector(".coord-target b")!.textContent!;
  const first = target();
  const tally = () => document.querySelector(".puzzle-side p.num")!.textContent;
  await tap("coords", first);
  expect(tally()).toContain("1 found");
  expect(target()).not.toBe(first);
  await tap("coords", target() === "a1" ? "h8" : "a1");
  expect(tally()).toContain("1 missed");
}, 20_000);
