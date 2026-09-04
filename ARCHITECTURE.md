# Docket — Architecture

*Status: design, pre-implementation. Last revised 2026-09-04.*

Docket gives an AI agent an on-chain spending mandate it cannot exceed, and turns the
enforced record — every action allowed, every action refused — into a reputation anyone can
recompute.

This document is the technical contract for the project. Where it disagrees with the code,
one of the two is wrong and the disagreement is a bug to be filed, not a discrepancy to be
tolerated.

---

## 0. The one-paragraph version

An owner deploys a **Mandate**: a contract that holds funds and a policy. The agent gets a key
that can call exactly one function, `act()`. The contract evaluates the policy inside that same
transaction and refuses anything outside it. Both outcomes are logged — a refusal is a
permanent public artifact, not an error message. An open, versioned scoring function reduces
that event history to a number, published to the ERC-8004 registries, which any third party can
recompute from chain data alone.

---

## 1. Design invariants

These six define the project. Everything below them is implementation detail and may change
freely; these may not change without an explicit decision recorded in this file.

| # | Invariant | Why it exists |
| --- | --- | --- |
| **I1** | The agent holds no key that can move funds by any path except `Mandate.act()`. | Without this there is no guarantee, only a suggestion. |
| **I2** | A policy violation **never reverts**. It emits `Denied` and returns `false`. | A revert erases its own logs. Denial-as-public-artifact is the product; it cannot be built on reverts. |
| **I3** | Tightening a policy is immediate; loosening is timelocked. There is no admin key. | Closes the "compromise the console, raise the limit, drain" path, and makes the fast direction the safe one. |
| **I4** | No global mutable state on the hot path. Mandate state is partitioned per mandate. | Monad executes non-conflicting transactions in parallel. A shared counter would serialize every agent in the system. |
| **I5** | Every number Docket publishes is recomputable by a third party from chain events alone. | A reputation you have to trust the publisher for is not a reputation. |
| **I6** | The model never judges. It only translates prose into a policy struct a human approves before it binds. | Natural language in, structured spec out, deterministic engine decides. |

### I2 in detail — the decision that shapes everything

The obvious implementation of a spending guard is `require(withinPolicy, "denied")`. That
implementation cannot produce Docket, because a revert rolls back state *including logs*. The
refused attempt — the single most valuable record the system produces — would vanish.

So `act()` is written to succeed on refusal:

1. The policy is evaluated **before** any external call, over storage only.
2. On violation: emit `Denied(rule, target, selector, declared, calldataHash)` and `return
   (false, "")`. No external call is made, no funds move, the transaction succeeds, the agent
   pays the gas for its own refusal.
3. On pass: perform the call inside a low-level `call` whose failure is caught, so a reverting
   *target* emits `Failed` rather than destroying the record too.

Three consequences to hold in mind:

- **The SDK must check the return value.** A successful transaction does not mean the action
  executed. `docket.act()` throws `DeniedError` on a `false` return; integrators who bypass the
  SDK and read only the receipt status will get this wrong, and the docs must say so loudly.
- **Denial spam is self-limiting but not free.** The agent pays gas for each refusal. A
  compromised key can deliberately pollute its own record; see T10.
- **`act()` is not batchable.** Batching would make one transaction carry several independent
  policy outcomes, and there is no honest way to log that. This is a deliberate refusal of a
  performance optimization.

---

## 2. Why this needs Monad

The removal test from `patterns/winning-patterns.md` P1: take the sponsor technology away and
see whether the project still stands. It does not.

| Requirement | On Monad | Elsewhere |
| --- | --- | --- |
| Policy check sits **inside** the agent's action loop | 300ms blocks, 600ms finality — the agent asks and proceeds synchronously | 12s blocks force batching, which destroys per-action enforcement, or push the check into a TEE / ZK circuit / trusted operator |
| Every **refused** attempt is stored on-chain | a denial moves no value and costs ordinary gas | paying L1 gas to record something that did *not* happen is indefensible |
| Rolling-window accounting writes storage on **every** action | ring-buffer writes are affordable | per-action storage writes dominate the cost of the action itself |
| Thousands of mandates act concurrently | I4 keeps state per-mandate, which is the ideal shape for optimistic parallel execution | sequential execution makes the partitioning pointless |
| Console renders denials sub-second | Execution Events firehose | RPC polling, with the latency the demo is built on |

The comparison that matters for the writeup: the strongest prior enforcement mechanism in the
reference vault is a ZK circuit gate at 30–75 seconds of proving per spend. Docket targets a p99
gate latency under one second, with the policy public rather than hidden. That trade — public
policy, no trusted hardware, real-time — is the whole argument, and **§4.6 exists to measure it
rather than assert it.**

---

## 3. On-chain

Solidity `0.8.26`, Foundry, no proxies. Mandates are immutable once deployed; upgrading means
deploying a new mandate and migrating funds, which is a deliberate constraint — an upgradeable
guard is not a guard.

### 3.1 Deployment and discovery — no factory

There is no factory contract, and this is a measured decision rather than a preference. A
factory that instantiates with `new` must embed the whole of `Mandate`'s initcode; at 24,032 B
that puts any such factory over the EIP-170 runtime limit, where it deploys fine in tests and
reverts on a real chain. See `bench/RESULTS.md` for the measurement and the three options
considered.

Instead `Mandate` emits `MandateDeployed(owner, agent, guardian, policyHash)` from its own
constructor, and the indexer discovers mandates by filtering that topic across all addresses.
CREATE2 determinism, where it is wanted, comes from the standard deployer. This also removes a
registry slot that every deployment would have written — the kind of shared state I4 exists to
keep out of the system.

### 3.2 `Mandate`

Roles, and nothing else:

| Role | Can do | Cannot do |
| --- | --- | --- |
| `owner` | deposit, withdraw, tighten (instant), queue a loosening, rotate the agent key, appoint a guardian | act; bypass the loosening timelock; move funds faster than a withdrawal |
| `agent` | call `act()` | anything else, including reading its own remaining allowance off a privileged path |
| `guardian` | `pause()` only | unpause, or change any policy value |

`pause()` is unrestricted-direction safe (it is a maximal tightening), so it is instant and can
be delegated to a monitoring bot or a co-signer without expanding trust. Unpausing is a
loosening and is timelocked like any other.

Owner withdrawal is instant: removing the owner's own funds reduces what the agent can spend,
which is a tightening under §3.4. Deposits are instant for the same reason in reverse — caps
still bind, so more balance does not mean more authority.

### 3.3 `act()` — the hot path

```
act(Action calldata a) returns (bool ok, bytes memory ret)

struct Action {
    address   target;
    uint256   value;        // native outflow the agent declares
    Outflow[] declared;     // ERC20 outflows the agent declares
    bytes     data;
    uint64    deadline;
}
struct Outflow { address asset; uint256 amount; }
```

The **declaration** is load-bearing. The agent states what it intends to spend; the policy is
checked against the declaration; the post-call assertion then enforces that the declaration was
truthful. This fuses intent-binding with the gate: lying about the outflow is not a policy
violation the agent can profit from, because §3.6 catches it after the fact and reverts.

Ordered steps:

1. `nonReentrant`; `whenNotPaused`; `msg.sender == agent`; `block.timestamp <= a.deadline`.
2. **Policy evaluation, storage-only, no external calls.** In order, cheapest first:
   expiry → target/selector allowlist → per-action cap → declared-outflow caps →
   rate window → spend window. First failure wins and names the rule.
3. If violated and `mode == Enforce`: emit `Denied`, return `(false, "")`. **No revert.**
   If violated and `mode == Observe`: emit `WouldDeny` and continue to step 4.
4. Snapshot balances of every tracked asset.
5. Debit the windows optimistically by the declared amounts (effects before interaction).
6. Grant an exact-amount allowance if the action requires one, perform the low-level call,
   then zero the allowance — all inside this transaction (§3.7).
7. **Balance assertion** (§3.6). Failure here *does* revert: an untruthful declaration is not a
   policy outcome to be recorded, it is a broken transaction.
8. Refund the window debit by any declared-but-unspent amount.
9. Emit `Allowed` on success, `Failed` if the target call reverted.

### 3.4 The policy, and the tightening partial order

```solidity
struct Policy {
    uint64  expiry;          // 0 = never
    uint128 perActionCap;    // native, per act()
    uint128 windowCap;       // native, per spendWindow
    uint32  spendWindow;     // seconds
    uint32  rateCap;         // max acts per rateWindow
    uint32  rateWindow;      // blocks
    uint16  slippageBps;     // tolerance on the balance assertion
    Mode    mode;            // Observe | Enforce
}
```

Allowlists live in mappings alongside the struct — `allowed[target][selector]`,
`assetCap[asset]`, and the `trackedAssets` set — rather than in a merkle root. A root would be
cheaper to store, but you cannot tell from two roots whether one is a subset of the other, which
would force *every* allowlist change through the timelock and make routine removals slow. Under
I3, removals must be instant. Cheap storage on Monad makes the mapping affordable; the merkle
variant is rejected for this reason and not for cost.

I3 needs a decidable predicate `isTightening(old, new)`, which is a partial order:

| Field | Tightening means |
| --- | --- |
| `expiry` | earlier (with 0 treated as +∞) |
| `perActionCap`, `windowCap`, `rateCap`, `assetCap[*]` | smaller |
| `spendWindow`, `rateWindow` | **larger** (the same cap over a longer window is stricter) |
| `slippageBps` | smaller |
| `mode` | `Observe → Enforce` only |
| `allowed[*][*]`, `assetCap` keys | entries removed only |
| `trackedAssets` | entries added only (more coverage is stricter) |
| `paused` | `false → true` only |

Every field must be non-loosening and at least one strictly tightening. Anything else is a
loosening: `queueLoosen(newPolicy)` emits `LoosenQueued` with the full diff, and
`executeLoosen()` becomes callable after `loosenDelay` (default 1 hour, itself only lengthenable
instantly and shortenable through the timelock). The public queue event is half the value — an
owner-key compromise becomes something the guardian can see coming and pause.

### 3.5 Window accounting

Both windows are fixed ring buffers with an incrementally maintained total, so reads are O(1)
and writes cost only the buckets actually crossed:

```solidity
struct Window {
    uint32     bucketDuration;   // seconds, or blocks for the rate window
    uint16     bucketCount;      // <= 64
    uint32     cursorStart;      // start of the bucket at `cursor`
    uint16     cursor;
    uint128    total;
    uint128[64] buckets;
}
```

Advancing zeroes stale buckets and subtracts them from `total`. Worst case is `bucketCount`
clears in one action — bounded, and measured in §4.6 rather than assumed.

Spend windows key on `block.timestamp`; **rate windows key on `block.number`.** At 300ms blocks,
timestamps have too coarse a resolution to express "at most 30 actions per second", which is
exactly the regime Docket exists to police.

### 3.6 The balance assertion

The allowlist is a heuristic; this is the guarantee. Everything else in the policy constrains
what the agent may *ask for*, and a sufficiently clever calldata payload — an aggregator route,
a nested multicall, a callback — can ask for one thing and do another. The assertion measures
the outcome instead of predicting it:

```
for each asset in trackedAssets:
    outflow = balanceBefore[asset] - balanceAfter[asset]
    require(outflow <= declared[asset] * (10_000 + slippageBps) / 10_000)
```

Native value is asset zero. This is why `trackedAssets` grows through a tightening and shrinks
through the timelock, and it is the reason T3 is a covered attack rather than an accepted risk.
Its limit is precise and stated in §6: it covers what it tracks, and nothing else.

### 3.7 No standing allowances

`approve`, `increaseAllowance` and `permit` are permanently excluded from the selector
allowlist — the mandate will not sign an approval as a normal action. Where an action needs one,
the mandate sets the exact allowance, performs the call, and zeroes the allowance in the same
transaction. Docket never leaves an allowance outstanding between transactions, so a
counterparty that is allowlisted today cannot drain a mandate tomorrow.

### 3.8 Modes

`Observe` evaluates the identical policy and emits `WouldDeny`, then executes anyway. `Enforce`
refuses. Arming is `Observe → Enforce`, a tightening, so it is instant; going back is
timelocked. The point is to measure the false-denial rate on real traffic **before** the guard
can hurt anyone, which is how intrusion detection graduates to intrusion prevention and how any
guard product avoids the failure mode that actually kills it: the owner gets blocked doing
legitimate work and switches it off.

### 3.9 Events — the public API

The event set is the product. Changing it is a breaking change to every downstream consumer,
including DCS-1.

| Event | Emitted when | Carries |
| --- | --- | --- |
| `Allowed` | action passed and executed | target, selector, declared outflows, actual outflows, calldata hash |
| `Denied` | policy refused it (Enforce) | **the rule that fired**, target, selector, declared outflows, calldata hash |
| `WouldDeny` | policy would have refused it (Observe) | same as `Denied` |
| `Failed` | passed the policy, target reverted | target, selector, revert data |
| `LoosenQueued` / `LoosenExecuted` / `Tightened` | policy changes | full before/after diff |
| `Paused` / `Unpaused` | guardian or owner | actor |
| `KeyRotated` | agent key changed | old, new, epoch |

`Denied` naming the specific rule is what makes the console legible and the score defensible.
"Refused" is a fact; "refused by the per-action cap at 4.2 MON against a 2.0 MON limit" is
evidence.

---

## 4. Off-chain

### 4.1 Indexer

Deterministic replay of the event set into a per-mandate action history. Consumes Monad
Execution Events for the live console stream and falls back to log queries for backfill and for
anyone reproducing a score from scratch. Holds no privileged data: **anything the indexer knows,
it learned from a public log**, which is what makes I5 true rather than aspirational.

### 4.2 DCS-1 — the Docket Conduct Score

A named, versioned, published spec (`spec/DCS-1.md`) with a reference implementation. It is a
pure function of a mandate's event log up to a stated block height. No model judgement appears
anywhere in it, and the weights are constants in the spec — changing them produces DCS-2, never
a silently different DCS-1.

```
S = clamp(0, 1000, round(1000 * (0.35*E + 0.25*A + 0.20*K + 0.20) * (1 - D)))

E  experience  = min(1, log10(1 + allowedActions) / 6)
A  age         = min(1, daysSinceFirstAction / 180)
K  capital     = min(1, log10(1 + timeWeightedBalanceUsd) / 5)
D  breach      = min(1, Σ over denials of w(class) * 0.5^(ageDays/30))
                 w(hard) = 0.34   caps, allowlist, declaration mismatch
                 w(soft) = 0.05   rate limit, expiry, deadline
```

Three hard breaches take the score to zero; they decay over months rather than washing out in a
week. The shape encodes the sybil answer: `E`, `A` and `K` are all *expensive to fabricate and
impossible to accelerate* — you cannot buy 180 days of clean history, and you cannot fake a
time-weighted balance without actually posting the capital.

Every published score ships `(score, specVersion, blockHeight, inputHash)` where `inputHash` is
the keccak of the ordered event set consumed. `docket score --verify <mandate>` re-syncs from
chain and reproduces the number byte-identically or fails loudly. This is the whole of I5.

### 4.3 ERC-8004 publication

Identity registry: one entry per mandate, binding `agentId ↔ mandate address ↔ owner`.
Reputation registry: the DCS-1 tuple above. The standard is a draft; `spec/ERC8004.md` pins the
exact revision implemented and records where Docket deviates.

What Docket contributes that the standard leaves open is the *provenance* of the reputation.
ERC-8004's reputation entries are typically client feedback — subjective, solicitable, and worth
what any review is worth. A DCS-1 entry is a deterministic function of enforced behaviour, and
the enforcement is the same contract that produced the evidence.

### 4.4 Differential evaluation

The policy evaluator exists twice: in Solidity, on the hot path, and in TypeScript, for the
console's dry-run and replay. Two implementations of the same predicate is normally a liability.
Here it is deliberately turned into an oracle: a Foundry fuzz harness generates random
`(Policy, Action, history)` triples and asserts the two evaluators return the identical
`(outcome, rule)` pair. Divergence is a bug in one of them and the fuzzer says which inputs
expose it.

This is the reason the replay in §4.5 can be trusted. A dry-run that disagrees with the chain is
worse than no dry-run.

### 4.5 Replay and policy authoring

The owner writes a policy in prose. A model compiles it to a `Policy` struct plus allowlist
diffs — **and then stops**, per I6. The struct is replayed against the mandate's real action
history and the console shows exactly which past actions the candidate policy would have
refused, and why. The owner reads that list and approves the struct, not the sentence.

The model is a translator whose output is checkable before it binds. It never decides anything.

### 4.6 Benchmarks

`bench/` is a deliverable, not a convenience. It publishes, on Monad testnet, at real
concurrency:

- p50 / p95 / p99 latency from `act()` submission to finality
- sustained `act()` per second per mandate, and across N mandates in parallel (the I4 claim)
- gas per allowed action, per denied action, and worst-case with a full window advance
- the same numbers with 1, 4 and 16 tracked assets, which is where §3.6 gets expensive

These numbers are the evidence for §2. Publishing them with a reproduction script is the
difference between claiming the design needs Monad and showing it.

---

## 5. Surfaces

**SDK** (`sdk/`, TypeScript + viem). `docket.act()` with the `DeniedError` semantics from I2,
policy authoring helpers, and a tool-shim so an agent framework can call it as a tool. The shim
is the integration point that matters: the agent's own harness sees a normal tool that sometimes
returns "refused, by this rule".

**Console** (`console/`, Next.js). Live allowed/denied stream over Execution Events; limit
controls that take effect in one block; denial rows carrying the rule, the decoded calldata, and
a persistent **"what this mandate does not protect you from"** panel rendered directly from
`spec/THREAT-MODEL.md`'s uncovered rows. Shipping the limits in the product, not only the docs,
is the point.

**Agent-native onboarding.** Machine-readable service description, registration by wallet
signature, a trial allowance, and self-serve top-up — so an agent can discover Docket, register,
and operate without a human at any step.

---

## 6. Threat model

The full version with a linked test per row lives in `spec/THREAT-MODEL.md`. **A row may not be
marked covered until a test references it by ID.** Summary:

| # | Attack | Defense | Status |
| --- | --- | --- | --- |
| T1 | Prompt injection drives the agent to overspend | policy gate; `Denied` record | covered |
| T2 | Agent session key stolen | attacker is bound by the same policy; guardian pause; key rotation | covered |
| T3 | Calldata smuggling via aggregator, multicall or callback | selector allowlist + declared outflows + balance assertion (§3.6) | covered |
| T4 | Drain via a standing allowance | no standing allowances; set-call-zero (§3.7) | covered |
| T5 | Allowlisted counterparty turns malicious | loss bounded to the declared outflow | **partial** — it can take exactly what was declared |
| T6 | Console compromised, limits raised | loosening timelock + public `LoosenQueued` (§3.4) | covered |
| T7 | Owner key fully compromised | timelock creates a detection window; guardian pauses | **partial** |
| T8 | Untracked asset drained — an NFT, or a token received mid-call | tracked-asset list is finite | **not covered** |
| T9 | Reentrancy into `act()` | `nonReentrant` | covered |
| T10 | Compromised key spams denials to tank the score | agent pays gas; hard/soft classes; per-mandate scoring | **partial** |
| T11 | Sybil — abandon a tarnished mandate, deploy a fresh one | economic only: age and time-weighted capital in DCS-1 | **partial, by design** |
| T12 | Oracle manipulation against price-band rules | price bands are out of scope in v1 | n/a in v1 |
| T13 | Indexer publishes a false score | anyone recomputes from events; `inputHash` published | covered |
| T14 | The public denial log leaks the agent's strategy | none in v1 | **not covered** |

---

## 7. What Docket does not do

Stated here so it is stated somewhere other than a judge's question.

- **It bounds money, not harm.** A perfectly mandated agent can still say something ruinous,
  sign something worthless, or make a legal commitment. The claim is scoped to funds.
- **It covers tracked assets only** (T8). An asset the mandate never listed is outside the
  balance assertion.
- **It publishes intent, including refused intent** (T14). A competitor reading the log learns
  what your agent tried to do. Commit-then-reveal calldata fixes this and is future work.
- **It does not solve identity** (T11). Sybil resistance here is economic, not cryptographic,
  and a fresh mandate genuinely does start clean.
- **It is not upgradeable.** Migration means a new mandate.
- **Reputation has no consumers on day one.** The counterparty check is a demonstration that the
  mechanism works end to end. It is not traction and must never be presented as traction.

---

## 8. Repository layout

```
contracts/   Foundry. Mandate, policy library, window library.
sdk/         TypeScript + viem. act(), DeniedError, policy authoring, agent tool-shim.
indexer/     Deterministic replay, DCS-1 reference implementation, verify CLI.
console/     Next.js. Live stream, limits, replay, "not protected from" panel.
spec/        DCS-1.md, THREAT-MODEL.md, POLICY.md, ERC8004.md.
bench/       Load harness and published results.
```

---

## 9. Open design questions

Resolve by the date given; a decision recorded here beats a decision rediscovered in week five.

- **Gas ceiling on policy expressiveness** (by end of week 2). §3.6 costs a balance read per
  tracked asset per action. There is a real limit on how many assets a mandate can track before
  the guard costs more than the action. Measure it; publish it; cap `trackedAssets` accordingly.
- **Should the guardian role be permissionless with a bond?** (by end of week 3). Anyone may
  pause, forfeiting a bond if the pause was unjustified. Strictly more robust, and introduces a
  griefing surface and a second market to design.
- **Relayed and sponsored `act()`** (deferred to v2). v1 requires the agent to hold gas and call
  directly. EIP-712 signatures plus a nonce would allow relaying, and add replay surface.
- **ERC-8004 revision drift.** The standard is a draft. Pin it, and re-check before submission.
- **`Mandate` size headroom.** 2,340 B under EIP-170 as of week 1. Week 3 adds ERC-8004
  publication to this contract; if that headroom runs out, the owner-facing policy mutators
  split into a module before anything else is cut.
