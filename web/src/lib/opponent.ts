// The sparring engine for "Win it again": the in-browser Stockfish plays the other side of a position.
// Its moves are only played on the board; nothing it computes is shown as analysis or stored. Skill Level
// is Stockfish's own UCI option (0 to 20, 20 being full strength).
import { useEffect, useRef, useState } from "react";
import { engineBuild } from "./engine";

export const THINK_MS = 700;

class Opponent {
  private worker: Worker;
  private ready: Promise<void>;
  private waiting: ((uci: string | null) => void) | null = null;

  constructor(skill: number, onError: () => void) {
    const build = engineBuild();
    this.worker = new Worker(build.file);
    let started: () => void;
    this.ready = new Promise((resolve) => { started = resolve; });
    this.worker.onerror = onError;
    this.worker.onmessage = (e) => {
      const line = String(e.data);
      if (line === "uciok") {
        this.worker.postMessage(`setoption name Skill Level value ${skill}`);
        if (build.threads > 1) this.worker.postMessage(`setoption name Threads value ${build.threads}`);
        this.worker.postMessage("setoption name Hash value 32");
        this.worker.postMessage("ucinewgame");
        this.worker.postMessage("isready");
      } else if (line === "readyok") {
        started();
      } else if (line.startsWith("bestmove")) {
        const uci = line.split(/\s+/)[1];
        const done = this.waiting;
        this.waiting = null;
        done?.(uci && uci !== "(none)" ? uci : null);
      }
    };
    this.worker.postMessage("uci");
  }

  /** Stockfish's move in `fen`, or null if it has none. */
  async move(fen: string, ms = THINK_MS): Promise<string | null> {
    await this.ready;
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go movetime ${ms}`);
    });
  }

  destroy() {
    this.waiting = null;
    this.worker.terminate();
  }
}

/** A sparring engine at `skill`, started on first use and shut down on unmount or when the skill changes. */
export function useOpponent(skill: number) {
  const ref = useRef<Opponent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => { ref.current?.destroy(); ref.current = null; }, [skill]);
  return {
    failed,
    move: (fen: string) => {
      ref.current ??= new Opponent(skill, () => setFailed(true));
      return ref.current.move(fen);
    },
  };
}
