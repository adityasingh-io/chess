#!/usr/bin/env bash
# Installs the pinned Stockfish 19 Linux build (checksum-verified) and exports STOCKFISH_PATH for later steps.
set -euo pipefail
url="https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-x86-64-universal.tar.gz"
sha="9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f"
dir="$RUNNER_TEMP/stockfish"
mkdir -p "$dir"
curl -sSfL -o "$dir/sf.tar.gz" "$url"
echo "$sha  $dir/sf.tar.gz" | sha256sum -c -
tar -xzf "$dir/sf.tar.gz" -C "$dir"
bin="$dir/stockfish/stockfish-linux-x86-64-universal"
chmod +x "$bin"
echo "STOCKFISH_PATH=$bin" >> "$GITHUB_ENV"
