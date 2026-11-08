#!/usr/bin/env bash
# Installs the pinned Stockfish 19 Linux build (checksum-verified) and exports STOCKFISH_PATH for later steps.
# GitHub's download link for this file failed for a long spell on 2026-11-08 (HTTP 504) while the API served the
# same file, so each route is retried, and the API (with GH_TOKEN when set) is the second route.
set -euo pipefail
url="https://github.com/official-stockfish/Stockfish/releases/download/sf_19/stockfish-linux-x86-64-universal.tar.gz"
api="https://api.github.com/repos/official-stockfish/Stockfish/releases/assets/545574859"
sha="9defc0d4e55d49c65a6d042f3e571a39fcea499ade6dbe741b53b8c65e03611f"
dir="$RUNNER_TEMP/stockfish"
mkdir -p "$dir"
fetch() { curl -sSfL --retry 3 --retry-delay 10 --retry-all-errors --connect-timeout 30 -o "$dir/sf.tar.gz" "$@"; }
auth=()
if [ -n "${GH_TOKEN:-}" ]; then auth=(-H "Authorization: Bearer $GH_TOKEN"); fi
fetch "$url" || { echo "download link failed; trying the API"; fetch -H "Accept: application/octet-stream" ${auth[@]+"${auth[@]}"} "$api"; }
echo "$sha  $dir/sf.tar.gz" | sha256sum -c -
tar -xzf "$dir/sf.tar.gz" -C "$dir"
bin="$dir/stockfish/stockfish-linux-x86-64-universal"
chmod +x "$bin"
echo "STOCKFISH_PATH=$bin" >> "$GITHUB_ENV"
