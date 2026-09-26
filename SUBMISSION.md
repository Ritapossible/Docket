# Docket

**An AI agent's reputation, computed from what a contract actually let it do.**

Monad *Metropolis* hackathon, **Trust, Identity & AI Infrastructure**.

| | |
| --- | --- |
| Repository | https://github.com/Ritapossible/docket |
| Network | Monad testnet, chain id 10143 |
| Showcase mandate | [`0x2EC195646731F274c0e500f3B671C04189446Ae9`](https://testnet.monadexplorer.com/address/0x2EC195646731F274c0e500f3B671C04189446Ae9) |
| ERC-8004 identity | agentId **1930** on [`0x8004A818…D9e`](https://testnet.monadexplorer.com/address/0x8004A818BFB912233c491871b3d84c89A494BD9e) |
| Published score | [`0x8004B663…713`](https://testnet.monadexplorer.com/address/0x8004B663056A597Dffe9eCcC1965A193B7388713), tagged `docket:dcs-1` |
| Verify it yourself | `npm run test:published` |

---

## 1. The problem

Give an agent money and you have a problem with three parts: it can be prompt-injected, its key
can leak, and its judgement is not yours.

Every existing answer buys safety with a trusted component. An attested enclave asks you to
trust hardware. A ZK circuit spends 30 to 75 seconds proving. A signed mandate with a published
trace catches an operator after the fact. All of them stop the bad action. **None of them leave
a record that it was attempted.**

That absence is the actual gap. You cannot build a reputation for an agent out of the things it
was permitted to do, because permission is not evidence of restraint. What would be evidence is
the set of things it *tried* and was refused.

## 2. What Docket does

The agent is granted permission to call exactly one function, `act()`, on a `Mandate` contract.
It holds neither the funds nor the policy. The policy check runs as a plain contract, inside the
agent's action loop, in the same transaction.

**A refusal never reverts.** It emits `Denied` carrying the rule that fired, the target, the
selector, the value and the calldata hash, and returns `false`. This is invariant I2 and it is
the load-bearing one: `require()` in the policy path looks correct and destroys the product,
because a revert erases its own logs and the denial record is the entire point.

**DCS-1** then turns that enforced record into an integer score out of 1000 - experience, age,
authority, breach - computed with no floating point, pinned to a block height, and committed to
by an `inputHash` over the exact event set consumed. Anyone can recompute it from the mandate's
own logs and catch a publisher who lies.

## 3. The enforcement ladder, and where this sits

| | Approach | What it costs |
| --- | --- | --- |
| 01 | Client-side caps | answers accidents, not adversaries |
| 02 | Intent-hash binding | per-operation only |
| 03 | Signed mandate + published trace | operator can still misbehave |
| 04 | Attested enclave gate | denials are invisible |
| 05 | ZK circuit gate | 30-75s proving, no trace at all |
| **06** | **In-loop on-chain gate** | **needs sub-second finality** |

Docket is rung 06. The cost of that rung is the one thing Monad removes.

## 4. "Isn't this a permission system?"

The first question anyone asks, and it deserves answering before anything else.

Bounded agent authority is crowded and some of it is very good. MetaMask's Agent Wallet grants
narrow revocable permissions through ERC-7715 and ERC-7710. Safe allowance modules, ERC-4337
session keys and Rhinestone's smart sessions all bound what an agent may spend.

**The difference is not the bound. It is the record.**

A permission grant says what an agent *may* do and has no notion of a refusal. An agent that
exceeds an ERC-7715 permission gets a reverted transaction, and a revert destroys its own logs:
nothing durable survives saying what was attempted. A permission system tells you what an agent
was allowed to do. Docket tells you what it tried.

These are complementary. A smart account can hold the mandate and grant the agent its scope;
Docket is the layer underneath that keeps the evidence.

## 5. Why it needs Monad

At 300ms blocks a policy check can sit synchronously inside an agent's loop, and recording every
*refused* attempt on chain is affordable. Remove Monad and the design does not degrade - it
inverts back into something you have to trust.

Measured, not quoted:

| | |
| --- | --- |
| Mean block time, 99 blocks sampled | **307 ms** |
| Act to receipt, p50 (20 live refused acts) | **568 ms** |
| Act to receipt, p95 | 1,359 ms |
| Act to receipt, min | 308 ms |

568ms is a pause in an agent's loop. It is not a job. Against the 30 to 75 seconds a ZK gate
spends proving, that is the difference between a check you can run on every action and a check
you run once a day.

The tail is reported rather than smoothed: p95 is more than twice the median, so an agent on a
hard deadline budgets for 1.36s and not for 568ms.

## 6. Gas, and a correction worth reading

| Case | Gas |
| --- | --- |
| Denied act, on chain, 20 live samples | 76,588 |
| 1 tracked asset | 110,968 |
| 16 tracked assets | 259,043 |
| Marginal per tracked asset | 9,872 |
| 16 tracked, 15 declared, all windows stale | 1,642,206 |
| **A real act on the showcase mandate, end to end** | **181,474** |

**These numbers were wrong until two days before writing this, by about a factor of three, in
our favour.** The correction is in the submission because how it was caught is a better argument
for the project than the numbers are.

`contracts/lib/` was gitignored with no `.gitmodules`, so forge-std existed only on machines
that had installed it. Every contracts job in CI died at parse time on a clean checkout - which
means `forge build`, `forge test`, the demo beat and the console end-to-end check had **never
once run in CI**. Local runs passed. Local green was read as green, for weeks, and the Actions
tab was red the whole time.

When CI finally ran the contract tests, two gas budgets blew. The first diagnosis - that a
`vm.prank` inside the measured region was charging cheatcode overhead to the act - was plausible,
directionally true, and accounted for **446 gas of a 164,436 gas gap**. It was published before
being checked against the size of the discrepancy, and it was wrong.

The real cause: the two forge builds disagree about EIP-2929 warm access state. The older one
carried warm token balances across calls within a test. Every real act is its own transaction and
starts cold. The live chain settles it - 181,474 gas for a real act against a harness that had
been claiming 44,465.

Three things follow, and they are why this section exists:

- **A measurement harness is part of the measurement.** One that only ever runs in a single
  environment has no way to tell you it is lying.
- **The shape finding survived and the absolute numbers did not.** Cost is still linear in
  tracked assets with no cliff, so `MAX_TRACKED_ASSETS = 16` is still a choice about bounding a
  loop rather than a dodge around a limit. The decision was never in question; the figures were.
- **This is the project's own thesis applied to itself.** Docket exists because self-reported
  claims about an agent's behaviour are worth less than an enforced record. A benchmark table
  nobody could contradict is a self-reported claim. CI was the enforced record.

`bench/RESULTS.md` §2 and §3 carry the full account and the reproduction commands.

## 7. Three keys, and the chain enforces the split

| Key | Can | Cannot |
| --- | --- | --- |
| **owner** | policy, pause, the ERC-8004 identity | call `act()`; post a score |
| **agent** | `act()` on the mandate, nothing else | change policy or identity |
| **publisher** | post a recomputable DCS-1 score | anything else at all |

The third key was not a design choice we made and then justified. ERC-8004's Reputation Registry
**refuses feedback from an identity's owner or operators** - `Self-feedback not allowed` - so the
two-key design physically could not publish. The constraint turned out to be the same argument
Docket makes about agents: a score you can award yourself is a claim, not a measurement.

Verified rather than asserted. The owner's `giveFeedback` reverts; the independent publisher's
succeeds. Anyone can post a competing DCS-1 entry for the same mandate, they should agree, and a
disagreement localises to a specific event set via `inputHash`.

## 8. What a judge can run

```bash
git clone --recurse-submodules https://github.com/Ritapossible/docket && cd docket
npm install

# 1. Watch a prompt injection get refused, end to end, on a local chain. ~30 seconds.
make demo

# 2. Recompute the published score from chain data. This is the whole claim.
#    Minutes, not seconds - see the note below on why, and what it costs.
npm run test:published

# 3. Score the live mandate yourself, with a progress meter.
node --experimental-strip-types indexer/src/cli.ts score \
  0x2EC195646731F274c0e500f3B671C04189446Ae9 --from 65577709
```

`make demo` deploys a mandate, pays a counterparty three times, gets prompt-injected, and shows
the chain refusing the injected payment with the rule that fired. It exits non-zero if the
guarantee fails, so it is an integration test that happens to be readable. Run this one first:
it is fast, it needs no network, and it is the argument in thirty seconds.

**Verification is slow, and getting slower.** Monad's public RPC caps `eth_getLogs` at 100
blocks and 25 requests a second. Measured against all three public endpoints - the official one,
drpc and Ankr - the cap is real on each and none of them accepts a 1,000-block range. A full
replay is therefore one request per 100 blocks of chain, paced, regardless of how few of those
blocks contain acts.

| | Requests | Time at the 25/sec cap |
| --- | --- | --- |
| Today (2,532 chunks, counted) | 2,532 | ~2 minutes |
| Projected at judging, 13 October | ~50,000 | ~35 minutes |

The request counts are measured; the times are derived from those counts and Monad's documented
rate cap rather than timed with a stopwatch, because the machine this was developed on routes
through a proxy slower than the cap and would have flattered nothing.

That is a real limit on the central claim and it is stated here rather than discovered by
whoever runs it. The scan is paced and retries on rate-limit rather than dying half way, and it
prints progress so it does not read as a hang - but pacing does not make it fast, it makes it
finish.

The fix is known and is the next piece of work: the cost is O(chain age) when it should be
O(acts), and roughly 1,100 acts is three orders of magnitude less. Because `Mandate.nonce` is
public and increments once per `act()`, a publisher can ship the list of act-bearing blocks
alongside the score and a verifier can prove that list complete by comparing its length against
`nonce` on chain. An omitted act is detectable; a fabricated one has no logs to back it. That
keeps verification trustless while making it proportional to what the agent actually did.

## 9. Limits, stated here rather than left to be found

**Threat model** (`spec/THREAT-MODEL.md`, 14 rows, 7 covered by tests that name the row's ID -
a CI gate fails the build if a row claims coverage no test backs):

- **T8, not covered.** An untracked asset can be drained - an NFT, or a token received during the
  call. The balance assertion covers `trackedAssets` and nothing else.
- **T14, not covered.** The public denial log leaks the agent's strategy. Commit-then-reveal
  calldata is future work.
- **T5, partial.** Loss is bounded to the declared outflow. Docket cannot make a counterparty
  honest; it bounds the loss, it does not price the deal.
- **T7, partial.** With the owner key an attacker can queue any loosening but not execute it
  before the timelock; the guardian can pause inside that window.
- **T10, partial.** An attacker holding the agent key can spam denials and tank the mandate's own
  score. Correct for honesty, unhelpful here.

**DCS-1** (`spec/DCS-1.md` §8):

- **Authority is gameable in isolation** - a large cap over an empty mandate costs nothing. It is
  weighted lowest of the three positive terms for that reason.
- **A fresh mandate starts clean** (Sybil). This is the design: what is expensive is an *aged*
  clean record, and the age term is where that lives. It saturates at 180 days and cannot be
  accelerated at any price.
- **No cross-mandate identity.** One owner running ten mandates has ten independent scores.

**Not built:** ERC-8004's Validation Registry is deployed nowhere, so it is cut by circumstance
rather than choice. Price-band rules are out of scope in v1. The policy evaluator exists twice,
in Solidity and TypeScript, which is a liability turned into a differential oracle rather than
one eliminated.

## 10. What is running right now

The showcase mandate is not a demo fixture. A scheduled workflow calls `act()` every eight hours
and republishes the DCS-1 score daily, both from GitHub Actions, both on keys that can do nothing
else. The age term saturates at 180 days and cannot be bought, so the only way to hold an aged
mandate at judging is to have deployed early and kept it working - which is what the schedule is
for, and it has been running unattended since 25 September.

CI runs the contract suite, the DCS-1 conformance vectors, the demo beat on a real chain, the
console across five widths and four routes, and a cold-sync recomputation of every published
score, on every push.

---

## Repository map

| | |
| --- | --- |
| `contracts/src/Mandate.sol` | the contract, six invariants in the header |
| `spec/DCS-1.md` | the scoring spec, pinned, with its own known limits |
| `spec/THREAT-MODEL.md` | 14 rows, coverage gated in CI |
| `spec/ERC8004.md` | the pinned standard revision, verified addresses, where Docket deviates |
| `bench/RESULTS.md` | every measurement, with reproduction commands and the correction |
| `indexer/` | the DCS-1 implementation and the cold-sync verifier |
| `console/` | the mandate console |
| `demo/` | the prompt-injection beat |
