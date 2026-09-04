# Docket — benchmark results

**Reading 1 — 4 September 2026 (week 1).**

## What these numbers are, and what they are not

These are **local EVM gas figures** from `forge test --gas-report` on a Cancun-target EVM. They
are not Monad measurements. There is no latency here, no concurrency, and no real block
production.

`ARCHITECTURE.md` §2 claims the design needs Monad. Gas alone cannot support that claim — the
argument rests on p99 latency from submission to finality, on sustained acts per second, and on
whether independent mandates actually execute in parallel. **None of that is measured yet.**
`PLAN.md` week 2 delivers it on testnet, and until then §2 is an argument rather than evidence.

Reproduce: `make gas`.

## Gas per act

| Path | Gas | Notes |
| --- | --- | --- |
| Denied act (min) | 47,154 | policy evaluated over storage, `Denied` emitted, no external call |
| Act (median) | 53,717 | across the whole suite |
| Act (mean) | 63,162 | 299 calls |
| Act (max) | 243,321 | first write to a cold spend window plus an ERC20 leg |
| `evaluate` (view, min/max) | 3,012 / 18,459 | the dry-run the console and SDK use |

**The denial floor is the number that matters most.** Recording a refusal costs about 47k gas
and moves no value. That is the cost of invariant I2, and it is the line item that is
indefensible on a chain with L1 gas prices and unremarkable on Monad.

## Contract size — a live constraint

| Contract | Runtime size | Headroom to EIP-170 (24,576) |
| --- | --- | --- |
| `Mandate` | 24,111 B | **465 B** |
| `MandateFactory` | 3,461 B | 21,115 B |

`Mandate` is 98% of the way to the deployment size limit at `optimizer_runs = 20_000`. This is a
hard constraint on everything still to be built, and it was not anticipated in
`ARCHITECTURE.md` §9. Options, cheapest first: lower `optimizer_runs` (trades runtime gas for
size), move `executeLoosen`'s payload dispatch into a library, or split the owner-facing policy
mutators into a separate module the mandate delegates to. **Decide before week 3 adds anything
to this contract.**

## Not yet measured

Everything the Monad argument actually rests on:

- p50 / p95 / p99 latency from `act()` submission to finality, on testnet
- sustained acts per second for one mandate, and across N mandates in parallel (the I4 claim)
- gas and latency with 1, 4 and 16 tracked assets — where the balance assertion gets expensive
  and where `MAX_TRACKED_ASSETS` should actually be set
- worst-case window advance: a full ring-buffer clear after an idle period
