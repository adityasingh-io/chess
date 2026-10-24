// Copy the Stockfish 19 lite builds (multi- and single-threaded) from node_modules into public/engine,
// where the browser loads them as Web Workers. Runs before dev and build; public/engine is gitignored.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(web, "node_modules/stockfish/bin");
const to = join(web, "public/engine");
mkdirSync(to, { recursive: true });
for (const name of ["stockfish-19-lite", "stockfish-19-lite-single"])
  for (const ext of [".js", ".wasm"]) copyFileSync(join(from, name + ext), join(to, name + ext));
copyFileSync(join(web, "node_modules/stockfish/Copying.txt"), join(to, "COPYING.txt"));
console.log("engine: copied Stockfish 19 lite builds to public/engine");
