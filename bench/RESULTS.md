# Docket — benchmark results

**Reading 1 — 4 September 2026 (week 1).**

## What these numbers are, and what they are not

These are **local EVM gas and bytecode figures** from `forge test --gas-report` and
`forge build --sizes` on a Cancun-target EVM. They are not Monad measurements. There is no
latency here, no concurrency, and no real block production.

`ARCHITECTURE.md` §2 claims the design needs Monad. Gas alone cannot support that claim — the
argument rests on p99 latency from submission to finality, on sustained acts per second, and on
whether independent mandates really do execute in parallel. **None of that is measured yet.**
`PLAN.md` week 2 delivers it on testnet, and until then §2 is an argument rather than evidence.

Reproduce: `make gas` and `forge build --sizes`.

## Gas per act

| Path | Gas | Notes |
| --- | --- | --- |
| Denied act (min) | 47,154 | policy evaluated over storage, `Denied` emitted, no external call |
| Act (median) | 53,708 | across the whole suite |
| Act (mean) | 63,152 | 299 calls |
| Act (max) | 243,321 | first write to a cold spend window plus an ERC20 leg |
| `evaluate` (view, min / max) | 3,012 / 18,459 | the dry-run the console and SDK use |

**The denial floor is the number that matters most.** Recording a refusal costs about 47k gas
and moves no value. That is the price of invariant I2, and it is the line item that is
indefensible at L1 gas prices and unremarkable on Monad.

## Contract size — and a design decision forced by it

| Contract | Runtime | Initcode | Runtime margin to EIP-170 (24,576) |
| --- | --- | --- | --- |
| `Mandate` | 22,236 B | 24,032 B | 2,340 B |

**`MandateFactory` was deleted here, because it could not exist.** Measured at 25,217 B runtime
— 641 B *over* the EIP-170 limit — it would have deployed in tests and reverted on a real
chain. The cause is structural rather than incidental: a factory that instantiates with `new`
must embed the whole of `Mandate`'s 24,032-byte initcode, so no amount of trimming its own
logic would have brought it under the limit. Removing `predict`'s duplicate copy of the
creation code recovered only 111 B.

The three ways out, and why the third was taken:

1. **EIP-1167 clones.** Rejected. `ARCHITECTURE.md` forbids proxies — an upgradeable guard is
   not a guard — and a delegatecall hop would sit on the hot path of every act.
2. **Shrink `Mandate` until its initcode plus the factory's own logic fits.** Rejected as
   fragile: it leaves roughly 500 B of headroom that the next feature reclaims, turning an
   architectural limit into a recurring surprise.
3. **Delete the factory.** Taken. `Mandate` now emits `MandateDeployed` from its own
   constructor, so the indexer discovers mandates by filtering that topic across all addresses
   with no registry at all. CREATE2 determinism, where wanted, comes from the standard deployer.

This also removes a contract that held a shared slot every deployment would have written —
exactly the global mutable state invariant I4 exists to avoid.

**The lesson for the remaining weeks:** `forge build --sizes` belongs in CI, not in a
retrospective. The gas report's "Deployment Size" column is *not* the runtime size, and reading
it as such is how this was briefly recorded wrong in the first version of this file.

## Not yet measured

Everything the Monad argument actually rests on:

- p50 / p95 / p99 latency from `act()` submission to finality, on testnet
- sustained acts per second for one mandate, and across N mandates in parallel (the I4 claim)
- gas and latency with 1, 4 and 16 tracked assets — where the balance assertion gets expensive
  and where `MAX_TRACKED_ASSETS` should actually be set, per `ARCHITECTURE.md` §9
- worst-case window advance: a full ring-buffer clear after an idle period
