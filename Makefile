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

gas:
	forge test --gas-report

snapshot:
	forge snapshot --snap bench/gas.snapshot

clean:
	forge clean
