#!/usr/bin/env bash
# The demo beat, from nothing, in one command.
#
# Starts a local chain, deploys a fresh mandate, runs the injection scenario, and tears down.
# Exits non-zero if the guarantee fails, so this doubles as an integration test rather than a
# performance - PLAN.md week 4 asks for a beat that runs unattended, twice in a row.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-8545}"
RUNS="${RUNS:-1}"

command -v anvil >/dev/null || { echo "anvil not found: https://getfoundry.sh"; exit 1; }
[ -f contracts/out/Mandate.sol/Mandate.json ] || forge build

anvil --silent --port "$PORT" &
ANVIL_PID=$!
trap 'kill "$ANVIL_PID" 2>/dev/null || true' EXIT

for _ in $(seq 1 20); do
  if cast block-number --rpc-url "http://127.0.0.1:$PORT" >/dev/null 2>&1; then break; fi
  sleep 0.25
done

for run in $(seq 1 "$RUNS"); do
  [ "$RUNS" -gt 1 ] && echo "════════ run $run of $RUNS ════════"
  RPC_URL="http://127.0.0.1:$PORT" node --experimental-strip-types demo/beat.ts
done
