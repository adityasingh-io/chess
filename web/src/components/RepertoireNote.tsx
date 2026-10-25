// Where a game left the trainer's lines (stored with the game by the pipeline, src/coach/book.py): by my
// move, by my opponent's, at a line's end, or not at all before the game ended.
import { Link } from "react-router";
import { moveName, plural } from "../lib/format";
import type { RepertoireCheck } from "../types/export";

/** Full moves the game stayed in the lines before the move that left them. */
export const stayedMoves = (c: RepertoireCheck) => Math.floor((c.ply - 1) / 2);

export function RepertoireNote({ c, opponent, onMove }: { c: RepertoireCheck; opponent: string; onMove?: () => void }) {
  const name = c.san ? moveName(c.ply, c.san) : "";
  const move = onMove
    ? <button type="button" className="linkish san" onClick={onMove} title="Show it on the board">{name}</button>
    : <b className="san">{name}</b>;
  if (c.result === "mine") {
    return (
      <>
        You left your lines with {move}; they play <b className="san">{c.expected.map((s) => moveName(c.ply, s)).join(" or ")}</b> there.{" "}
        <Link to={`/trainer?line=${c.line}`}>Drill the line →</Link>
      </>
    );
  }
  if (c.result === "theirs") return <>{opponent} left your lines with {move}, a reply none of them has yet.</>;
  if (c.result === "end") return <>You stayed in your lines to the end of one, {plural(stayedMoves(c), "move")} in.</>;
  return <>The game ended inside your lines.</>;
}
