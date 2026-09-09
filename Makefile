.PHONY: bootstrap build test fmt fmt-check gas snapshot clean bench deploy-testnet

bootstrap:
	@command -v forge >/dev/null || { echo "forge not found: https://getfoundry.sh"; exit 1; }
	forge --version
	forge build

build:
	forge build

test:
	forge test -vv

# Threat-model rows are only "covered" when a test names their ID (CLAUDE.md).
test-threats:
	forge test --match-test "_T[0-9]" -vv

fmt:
	forge fmt

fmt-check:
	forge fmt --check

lint:
	npm run lint

gas:
	forge test --gas-report

snapshot:
	forge snapshot --snap bench/gas.snapshot

sdk-abi:
	@python3 -c "import json,pathlib; a=json.load(open('contracts/out/Mandate.sol/Mandate.json'))['abi']; \
pathlib.Path('sdk/src/abi.ts').write_text('// Generated from contracts/out/Mandate.sol/Mandate.json - regenerate with \`make sdk-abi\`.\n' \
'// The event set is the product public API (ARCHITECTURE.md 3.9); regenerating after an\n' \
'// event signature change is what keeps the SDK, the indexer and DCS-1 in step.\n\n' \
'export const mandateAbi = ' + json.dumps(a, indent=2) + ' as const;\n')"
	@cp sdk/src/abi.ts indexer/src/abi.ts
	@echo "wrote sdk/src/abi.ts and indexer/src/abi.ts"

sdk-check:
	cd sdk && npm install --silent --no-audit --no-fund && npx tsc -p tsconfig.json --noEmit

indexer-check:
	cd indexer && npm install --silent --no-audit --no-fund && npx tsc -p tsconfig.json --noEmit
	cd indexer && node --experimental-strip-types --test test/*.test.ts

score:
	cd indexer && node --experimental-strip-types src/cli.ts score $(MANDATE) --from $(FROM)

blockrate:
	./bench/blockrate.sh

console:
	npm --prefix console run build

console-e2e:
	./console/scripts/e2e.sh

# Serves the build with the production headers from vercel.json, so the CSP can be tested
# before it ships instead of debugged on a live URL.
console-serve:
	node console/scripts/serve-static.mjs

demo:
	./demo/run.sh

demo-twice:
	RUNS=2 ./demo/run.sh

clean:
	forge clean
