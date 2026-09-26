# Contributing

## Setup

```bash
git clone --recurse-submodules https://github.com/Ritapossible/Docket && cd Docket
curl -L https://foundry.paradigm.xyz | bash && foundryup --install 1.8.3   # forge, cast, anvil
make bootstrap                                                            # builds the contracts
npm install && npm --prefix console install
```

Two details in there are load-bearing, both learned the hard way.

**`--recurse-submodules`.** `contracts/lib/forge-std` is a submodule. Without it the remapping
does not resolve and `forge build` fails at parse time. The default Foundry `.gitignore`
ignores `contracts/lib/` wholesale, which hid this for weeks: the library existed on the
machine that installed it and nowhere else, so every contracts job in CI failed on a clean
checkout while everything passed locally.

**The pinned Foundry version.** `forge fmt` output changes between releases - 1.4 and 1.8
disagree about one call in `Mandate.sol` - and CI runs `forge fmt --check`. On a different
version the formatter will fight you. If you need to bump it, change `.github/workflows/ci.yml`
and reformat in the same commit.

## The one command that proves it works

```bash
make demo
```

Starts a local chain, deploys a mandate, pays a counterparty three times, gets prompt-injected,
and shows the chain refusing the injected payment with the rule that fired. It exits non-zero if
the guarantee fails, so it is an integration test that happens to be readable.

## Before you open a pull request

```bash
make test           # 32 contract tests
make fmt-check      # solidity formatting
npm run lint        # typescript across sdk, indexer, console, demo
npm run test:dcs1   # 15 hand-computed DCS-1 vectors
make console-e2e    # renders the console against a seeded chain, checks responsiveness
bash script/check-threat-coverage.sh
```

CI runs all of it. `TESTING.md` explains what each layer is for.

## House rules

These are not style preferences. Each one exists because breaking it cost us something.

- **A policy violation must never revert.** `require()` in the decision path looks correct and
  destroys the product: a revert rolls back its own logs, so the refused attempt - the artifact
  the whole system rests on - disappears. This is invariant I2.
- **A threat-model row may not be marked `covered` until a test names its ID.**
  `script/check-threat-coverage.sh` enforces it and has already caught one optimistic claim.
- **No claim without a link.** Performance claims cite `bench/RESULTS.md`. Security claims cite a
  test. Standard-conformance claims cite the pinned revision in `spec/ERC8004.md`.
- **Specs precede implementations.** `spec/DCS-1.md` was written before the scorer, which is why
  its test vectors check the code against the spec rather than against itself.
- **No floating point in DCS-1.** A third party has to recompute a score byte-identically, and
  `0.5 ** (days / 30)` does not reproduce across languages.
- **The model never decides.** It may translate prose into a policy struct that a human approves.
  It may not evaluate a policy at decision time.
- **Never use the `padding` shorthand on an element that also carries `.shell`.** It silently
  resets the inline padding and the damage is invisible on desktop. This shipped twice.

## Commits

Explain why, not what - the diff already says what. Small and frequent beats large and tidy.

## Security

Do not open a public issue for a vulnerability in the contracts. See `SECURITY.md`.
