# Docket - benchmark results

**Reading 2 - 4 September 2026 (week 1/2).**

Reproduce: `make gas`, `forge build --sizes`, `./bench/blockrate.sh`.

---

## 1. Observed Monad block production

The first half of the claim in `ARCHITECTURE.md` §2, measured rather than quoted.

| | |
| --- | --- |
| RPC | `https://testnet-rpc.monad.xyz` |
| Sample window | 30,489 ms |
| Blocks produced | 99 (59,693,566 → 59,693,665) |
| **Mean block time** | **307 ms** |
| Blocks / sec | 3.25 |

This is the chain doing what the design depends on. It is **not** act-to-finality latency -
that needs a funded key and a broadcast transaction, and is the one number still outstanding.

## 2. Gas per act, by tracked-asset count

The balance assertion reads every tracked asset's balance twice per act. That cost is linear,
with no cliff:

| Tracked assets | Gas per act | Marginal |
| --- | --- | --- |
| 1 (native only) | 44,465 | - |
| 2 | 47,838 | 3,373 |
| 4 | 54,582 | 3,372 |
| 8 | 68,072 | 3,372 |
| 16 | 95,053 | 3,372 |

**`MAX_TRACKED_ASSETS` stays at 16, now for a reason.** `ARCHITECTURE.md` §9 asked where the
guard starts costing more than the action it guards. The answer is that it does not, within any
plausible range: the marginal cost is a flat 3,372 gas and a fully-tracked act is 95k. The cap
exists to bound the loop, not to dodge a cliff.

## 3. Gas per act, worst cases

| Case | Gas |
| --- | --- |
| Denied act (floor) | 47,154 |
| Act, median across the suite | 53,708 |
| 16 tracked assets, one declared | 94,607 |
| One asset, full 16-bucket window eviction after an idle period | 74,841 |
| 16 tracked, 15 declared, every window stale | 1,289,395 |
| - marginal per declared stale asset | 79,579 |

*Re-measured 26 September 2026 with the cheatcode moved outside the measured region; see the
note at the end of this section. The figures moved by a few hundred gas, which is why the
conclusions below did not change.*

Two findings here, and the second was not what was expected.

**`MAX_BUCKETS` was reduced from 64 to 16.** At 64 the compound worst case measured 1.33M gas.
Bucket count only controls how smoothly the window slides; 16 buckets over an hour is 3m45s of
resolution, which is ample for a spending cap and not worth a megagas spike. Single-asset
worst-case eviction fell from 101,767 to 75,287.

**The dominant term is the allowance pair, not window eviction.** Of the ~79.7k marginal per
declared stale asset, the set-call-zero allowance on a cold token is the larger share. Reducing
it further would mean letting an action say which of its declared assets actually need an
allowance, rather than approving for all of them - a change to the `Action` struct, and future
work rather than a week-2 fix. One safe case is already skipped: an asset the call is addressed
to (`token.transfer`) spends the mandate's own balance and needs no approval at all.

The compound case is bounded - declarations cannot exceed `MAX_TRACKED_ASSETS` - and the agent
pays for its own gas, so an expensive act costs only the agent. The regression guard in
`test_compoundWorstCase` is set from the measurement rather than from a number that sounded
tidy.

## 4. Contract size

| Contract | Runtime | Initcode | Margin to EIP-170 (24,576) |
| --- | --- | --- | --- |
| `Mandate` | 22,236 B | 24,032 B | 2,340 B |

`MandateFactory` was deleted at this reading: measured at 25,217 B runtime, 641 B **over** the
limit, it would have deployed in tests and reverted on a real chain. The cause is structural -
a factory instantiating with `new` embeds the whole of `Mandate`'s initcode - so no trimming
could fix it. Clones were rejected (an upgradeable guard is not a guard, and a delegatecall
would sit on every act's hot path); shrinking `Mandate` to fit was rejected as fragile. Instead
`Mandate` emits `MandateDeployed` from its own constructor and the indexer discovers mandates
by filtering that topic.

`forge build --sizes` now runs in CI and exits non-zero on an oversized contract, verified
against a deliberately oversized fixture. Note that the gas report's "Deployment Size" column
is *not* the runtime size; reading it as such is how this was briefly recorded wrong.

## 4b. Act-to-finality on Monad testnet - measured 25 September

**The number the whole argument rests on**, and until today it was prose. Measured against a
live mandate (`0x4e21…0DAa`), 20 refused acts, each a real transaction leaving a real `Denied`
event:

| | Submission -> tx hash | Submission -> receipt |
| --- | --- | --- |
| p50 | 119 ms | **568 ms** |
| p95 | 684 ms | 1,359 ms |
| p99 | 684 ms | 1,359 ms |
| min | - | 308 ms |
| max | - | 1,359 ms |

Gas per refused act on chain: **76,588**, consistent across all 20 samples.

Reproduce: `MANDATE=0x… AGENT_PRIVATE_KEY=0x… node bench/latency.mjs 20`

What this supports and what it does not. A median of 568 ms from submitting an act to having it
final is a policy check that fits inside an agent's action loop - it is a pause, not a job. The
tail is worse than the median by more than a factor of two, and that is reported rather than
smoothed: the p95 is 1.36 s, so an agent acting on a hard deadline needs to budget for the tail
and not the median. Against the alternative in `ARCHITECTURE.md` §2 - a ZK gate at 30 to 75
seconds of proving per spend - even the worst sample here is two orders of magnitude cheaper.

All 20 acts emitted their event. A refused act that emitted nothing would mean the record was
lost, so `bench/latency.mjs` fails the run if any sample's receipt carries no logs.

## 5. Console sync cost - measured 25 September

The console used to re-walk all history every two seconds. Measured against a 25,010-block
chain carrying a real mandate, before and after the incremental-sync change:

| | Old (full re-walk each poll) | New (window + cursor) |
| --- | --- | --- |
| Requests on first paint | ~250 | **74** |
| Requests per poll | ~250, growing with age | **7, flat** |
| First paint | grows without bound | **5.1 s** |

The flat number is the point. Per-poll cost no longer depends on how long the mandate has been
alive, which is what made the old design incompatible with the one strategy that cannot be
faked later: DCS-1's age term rewards a mandate that has been running for weeks, and under the
old design every week made the console worse.

The score is **withheld** on a windowed load rather than approximated. DCS-1 counts every act
since deployment, dates the first one and accumulates every denial, so a number computed from
the last few thousand blocks is not roughly right, it is confidently wrong. The panel shows the
`docket score --verify` command instead, and `&full=1` forces a full walk in the browser.

## 5b. Still not measured

- **act-to-finality latency, p50 / p95 / p99, on testnet.** The remaining half of §2, and the
  headline number. Needs a funded key.
- **Sustained acts per second**, for one mandate and across N mandates in parallel - the I4
  claim that per-mandate state partitioning lets independent agents scale.
- **Latency under the compound worst case**, as opposed to its gas cost.

### A note on how these were measured

Each figure brackets one `act()` between two `gasleft()` reads. The original harness put
`vm.prank(agent)` *inside* that bracket, so every number carried the cost of a cheatcode as
well as the act.

That went unnoticed because it did not change much on the forge build these numbers were first
taken with. It surfaced when CI finally ran the contract tests for the first time, on forge
1.8.3, and reported 1,642,652 for the compound case against a 1,400,000 budget that had passed
locally on 1.4.2 for weeks. The contract had not changed; the tooling's cheatcode accounting
had.

The fix is `vm.startPrank` before the measurement rather than `vm.prank` inside it, so nothing
but the act runs between the two reads. The corrected numbers land within ~450 gas of what this
file already claimed, which is the reassuring part: the underlying EVM cost is stable across
forge versions, and only the harness overhead was moving. An agent paying for an act does not
invoke a cheatcode either, so the clean figure was always the honest one to publish.
