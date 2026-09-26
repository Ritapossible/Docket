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
| 1 (native only) | 110,968 | - |
| 2 | 120,828 | 9,860 |
| 4 | 140,572 | 9,872 |
| 8 | 180,062 | 9,872 |
| 16 | 259,043 | 9,872 |

**`MAX_TRACKED_ASSETS` stays at 16, now for a reason.** `ARCHITECTURE.md` §9 asked where the
guard starts costing more than the action it guards. The answer is that it does not, within any
plausible range: the marginal cost is flat at 9,872 gas. The cap exists to bound the loop, not
to dodge a cliff.

*Corrected 26 September 2026, same cause as §3. This table previously read 44,465 to 95,053
with a flat marginal of 3,372, taken on a harness that kept token balances warm between calls.
Each tracked asset costs a cold account access and a cold balance read on every act, which is
most of the real 9,872. The shape finding - linear, no cliff, so the cap is a choice rather
than a dodge - is unchanged, and it is the only thing this section was ever used to decide.*

## 3. Gas per act, worst cases

| Case | Gas |
| --- | --- |
| Denied act, measured on chain across 20 live samples (see §4b) | 76,588 |
| 16 tracked assets, one declared | 259,043 |
| One asset, full 16-bucket window eviction after an idle period | 135,890 |
| 16 tracked, 15 declared, every window stale | 1,642,206 |
| - marginal per declared stale asset | 92,137 |

These are in-test figures and exclude the 21,000 intrinsic transaction cost, which a
`gasleft()` bracket cannot see. The live cross-check: a real act on the showcase mandate,
one tracked asset, costs **181,474 gas** end to end.

*Corrected 26 September 2026. The figures previously in this table were about a third of the
truth; see "how these were measured" below for what went wrong and how it was caught.*

Two findings here, and the second was not what was expected.

**`MAX_BUCKETS` was reduced from 64 to 16.** At 64 the compound worst case was roughly a fifth
worse. Bucket count only controls how smoothly the window slides; 16 buckets over an hour is
3m45s of resolution, which is ample for a spending cap and not worth a megagas spike. The
before-and-after figures for that change were taken on the old harness and are not restated
here, because the comparison was like-for-like at the time and the absolute numbers were not.
The decision stands; the numbers that justified it have been retired rather than rescaled.

**The dominant term is the allowance pair, not window eviction.** Of the marginal cost per
declared stale asset, the set-call-zero allowance on a cold token is the larger share. This is
the finding the correction reinforces rather than undermines: cold-token access is exactly what
the older harness was hiding, so the allowance pair is a bigger share of the total than this
file used to imply. Reducing
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

Each figure brackets one `act()` between two `gasleft()` reads. The numbers in this table were
wrong for weeks, in the project's favour, and the way that happened is worth writing down.

The contract tests had never run in CI at all - `forge-std` was gitignored and untracked, so
every contracts job died at parse time on a clean checkout. The failure was visible in the
Actions tab the whole time and nobody, including me, opened it. Local runs passed, and local
green was read as green.

When CI finally ran them, a fully tracked act measured 259,043 against a 250,000 budget that
had passed locally at 94,607. My first guess was that the `vm.prank` sitting inside the
measured region was charging its cheatcode overhead to the act. That was true, and it was
worth fixing, and it accounted for **446 gas** of a 164,436 gas gap. It was not the answer.

The answer is that the two forge builds disagree about EIP-2929 warm access state. The older
build carries the warm set across calls within a test, so the second `act()` re-reads sixteen
token balances that are already warm; the newer one does not. Every act is its own transaction
and starts cold, so the newer behaviour is the correct one, and the live chain settles it:
181,474 gas for a real act against 135,890 measured here for a comparable case plus intrinsic
cost. The warm figure was never the steady state of anything an agent actually does.

The budgets and this table are now calibrated against the forge version CI pins. A local run on
a build with the old warm-carry behaviour will report roughly a third of these numbers; that
run is not the one to believe.

Two things generalise. A measurement harness is part of the measurement, and one that is only
ever run in one environment has no way to tell you it is lying. And a plausible first
explanation that survives because it is directionally right - the cheatcode really was adding
overhead - is worth checking against the size of the discrepancy before it gets published.

## 6. Verification cost, and why it grows

Measured 26 September 2026, and the least comfortable number in this file.

A DCS-1 recomputation replays every log the mandate has emitted since deployment. Monad's public
RPC caps `eth_getLogs` at 100 blocks and 25 requests a second, so the cost is one request per
100 blocks of *chain*, not per act. At 307ms blocks that is about 2,810 requests per day of
mandate age, whether the agent acted three times that day or not at all.

Verified against all three public endpoints rather than assumed from one:

| Endpoint | Largest range accepted with logs present |
| --- | --- |
| `testnet-rpc.monad.xyz` | 100 blocks |
| `monad-testnet.drpc.org` | 100 blocks (its error names 10,000, but 1,000 is refused) |
| `rpc.ankr.com/monad_testnet` | 100 blocks |

An early reading suggested the official endpoint accepted 10,000-block ranges. It does, for
ranges containing no logs for the address. With logs present it refuses anything over 100. The
first reading was the kind that is true and useless.

| | Requests | Wall clock |
| --- | --- | --- |
| Mandate age today | 2,532 | **152 s**, timed, 16.6 req/s sustained |
| Projected 13 October | ~50,000 | ~50 minutes at the same rate |

The scan is now paced at 20 requests a second with backoff and retry, and prints progress. That
was not a tuning change: before it, a full replay **failed** part way through with
`requests limited to 25/sec`, which is how this was found - the T13 verification test, the one
the whole recomputability claim rests on, had started failing locally.

Pacing makes it finish; it does not make it fast. The cost is O(chain age) where it should be
O(acts), and the gap is three orders of magnitude.

**This has a deadline attached.** The T13 job in CI has a 20 minute timeout, which at the
measured 16.6 requests a second buys roughly 1.8M blocks of chain to scan. The mandate deployed
at block 65,577,709 and Monad produces about 281,000 blocks a day, so that budget runs out
around **1 October** - a week before the submission, and it will fail on a schedule, quietly,
with nobody watching. Verification of the published score is currently 46 seconds because the
test replays to the published height rather than to head, but the publisher republishes daily,
so that height tracks head and the cost grows with it.

**The fix, not yet built.** `Mandate.nonce` is public and increments once per `act()`. A
publisher can ship the list of act-bearing block numbers alongside the score, and a verifier can
prove that list complete by comparing its length against `nonce` read on chain at the pinned
height. An omitted act shows up as a count mismatch; a fabricated one has no logs behind it. So
verification stays trustless while dropping to one request per act - about 1,100 at judging
rather than 50,000. It needs no contract change and no redeployment, which matters, because
redeploying would reset the age term and that is the one input to DCS-1 that cannot be bought.
