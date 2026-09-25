#!/usr/bin/env bash
# Boots a chain, seeds a mandate with a real denial, builds and serves the console, and
# asserts it rendered live state. The console's only meaningful test - a build that compiles
# proves nothing about a dashboard.
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT_CHAIN="${PORT_CHAIN:-8545}"
PORT_WEB="${PORT_WEB:-4173}"

command -v anvil >/dev/null || { echo "anvil not found: https://getfoundry.sh"; exit 1; }

# Prefer a preinstalled Chromium when the image has one. Playwright refuses to launch a browser
# whose build number does not match the npm package's expectation, and an `npm install` that
# bumps @playwright/test breaks this run with an install prompt rather than a useful error.
# Pinning the path here keeps the e2e self-contained instead of depending on the caller's env.
if [ -z "${PLAYWRIGHT_CHROMIUM_PATH:-}" ]; then
  for candidate in \
    "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}/chromium/chrome-linux/chrome" \
    "${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}/chromium" ; do
    if [ -x "$candidate" ]; then
      export PLAYWRIGHT_CHROMIUM_PATH="$candidate"
      break
    fi
  done
fi
[ -n "${PLAYWRIGHT_CHROMIUM_PATH:-}" ] && echo "chromium: $PLAYWRIGHT_CHROMIUM_PATH"
[ -f contracts/out/Mandate.sol/Mandate.json ] || forge build

anvil --silent --port "$PORT_CHAIN" &
ANVIL_PID=$!
PREVIEW_PID=""
cleanup() {
  [ -n "$PREVIEW_PID" ] && kill "$PREVIEW_PID" 2>/dev/null || true
  kill "$ANVIL_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 40); do
  cast block-number --rpc-url "http://127.0.0.1:$PORT_CHAIN" >/dev/null 2>&1 && break
  sleep 0.25
done

# The demo prints the address it deployed; parse it rather than hard-coding a nonce guess.
OUT=$(RPC_URL="http://127.0.0.1:$PORT_CHAIN" node --experimental-strip-types demo/beat.ts)
MANDATE=$(printf '%s' "$OUT" | sed -n 's/.*mandate deployed at \(0x[0-9a-fA-F]*\).*/\1/p' | head -1)
[ -n "$MANDATE" ] || { echo "could not parse the mandate address from the demo output"; exit 1; }
echo "seeded mandate $MANDATE"

npm --prefix console run build
# `cd`, not `npx --prefix`: npx has no --prefix, so it treats vite as an uninstalled package
# and blocks on an interactive install prompt that never gets an answer in CI.
(cd console && exec npx vite preview --port "$PORT_WEB" --host 127.0.0.1) &
PREVIEW_PID=$!

for _ in $(seq 1 40); do
  curl -sSf -o /dev/null "http://127.0.0.1:$PORT_WEB/" && break
  sleep 0.25
done

RPC_URL="http://127.0.0.1:$PORT_CHAIN" CONSOLE_URL="http://127.0.0.1:$PORT_WEB" \
  node console/scripts/verify-render.mjs "$MANDATE"

RPC_URL="http://127.0.0.1:$PORT_CHAIN" CONSOLE_URL="http://127.0.0.1:$PORT_WEB" \
  node console/scripts/check-responsive.mjs "$MANDATE"

CONSOLE_URL="http://127.0.0.1:$PORT_WEB" node console/scripts/check-routes.mjs
