#!/usr/bin/env bash
# Observed block production rate on a Monad RPC.
#
# This measures what the chain actually does, which is the first half of the claim in
# ARCHITECTURE.md §2. It does NOT measure act() latency - submission to finality for a real
# transaction needs a funded key and lands with the rest of the week-2 harness.
#
#   ./bench/blockrate.sh [rpc-url] [seconds]
set -euo pipefail

RPC="${1:-https://testnet-rpc.monad.xyz}"
DURATION="${2:-30}"

blocknum() {
  curl -sS -m 10 -X POST -H 'content-type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' "$RPC" \
    | sed -n 's/.*"result":"\(0x[0-9a-f]*\)".*/\1/p'
}

start_hex=$(blocknum)
start_ns=$(date +%s%N)
sleep "$DURATION"
end_hex=$(blocknum)
end_ns=$(date +%s%N)

start=$((start_hex))
end=$((end_hex))
blocks=$((end - start))
elapsed_ms=$(((end_ns - start_ns) / 1000000))

echo "rpc            $RPC"
echo "window         ${elapsed_ms} ms"
echo "blocks         ${blocks}  (${start} -> ${end})"
if [ "$blocks" -gt 0 ]; then
  echo "mean block time $((elapsed_ms / blocks)) ms"
  echo "blocks/sec      $(awk "BEGIN{printf \"%.2f\", $blocks*1000/$elapsed_ms}")"
fi
