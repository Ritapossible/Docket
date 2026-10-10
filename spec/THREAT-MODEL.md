# Docket - Threat Model

*Applies to `contracts/src/Mandate.sol`. Revised 2026-09-04.*

A row may be marked **covered** only when a test in `contracts/test/` names its ID (`_T3_`).
`script/check-threat-coverage.sh` enforces this in CI, so this table cannot drift into
optimism. Rows marked **partial** or **not covered** are real and are rendered in the console's
"what this mandate does not protect you from" panel, not only here.

| ID | Attack | Defense | Status |
| --- | --- | --- | --- |
| T1 | Prompt injection drives the agent to overspend or pay an attacker | policy gate; the attempt is recorded as `Denied` | covered |
| T2 | The agent's session key is stolen | the thief is bound by the same policy; rotation is instant; the guardian can pause | covered |
| T3 | Calldata smuggling - an aggregator route, nested multicall or callback asks for one thing and does another | selector allowlist, declared outflows, and the post-execution balance assertion | covered |
| T4 | Drain through a standing allowance | `approve`/`permit`/`setApprovalForAll` are never allowlistable; allowances are set and zeroed inside one transaction | covered |
| T5 | An allowlisted counterparty turns malicious | loss is bounded to the declared outflow | partial |
| T6 | The owner's console is compromised and limits are raised | loosening is timelocked and publicly queued; there is no admin key | covered |
| T7 | The owner's key is fully compromised | the timelock creates a detection window. **On the deployed mandate the guardian is the owner, so the guardian half of this does not hold** | partial |
| T8 | An untracked asset is drained - an NFT, or a token received during the call | the balance assertion covers `trackedAssets` and nothing else | not covered |
| T9 | Reentrancy into `act()` | `nonReentrant`, plus the agent-only check as a second layer | covered |
| T10 | A compromised key spams denials to tank the mandate's score | the agent pays gas for its own refusals; DCS-1 separates hard from soft breaches | partial |
| T11 | Sybil - abandon a tarnished mandate and deploy a fresh one | economic only: DCS-1 weights age and time-weighted capital, neither of which can be accelerated | partial, by design |
| T12 | Oracle manipulation against price-band rules | price bands are out of scope in v1 | n/a in v1 |
| T13 | The indexer publishes a false score | anyone recomputes from events; `inputHash` is published with every score | covered |
| T14 | The public denial log leaks the agent's strategy | none in v1; commit-then-reveal calldata is future work | not covered |

## T13, and what discharged it

T13 was **partial** for most of this project's life, for one specific reason: nothing had been
published to the ERC-8004 registry, so there was no published score for a third party to
disagree with. Recomputation was real but hypothetical.

It is now covered. `indexer/test/published.test.ts` reads every unrevoked DCS-1 entry on the
Reputation Registry for the agent, takes the block height out of each entry's `tag2`, replays
the mandate from its deploy block to exactly that height with nothing cached, and asserts the
recomputed score equals the published value. A publisher who posted a flattering number fails
it; so does an indexer that has drifted from the spec.

The test was checked against a wrong answer before being believed. Replaying from a later start
block recomputes 200 where 372 is published, and the assertion names both numbers and the
publisher. A verification test that has never been seen to fail is decoration.

Two structural facts back the row up, neither of which is a test:

- **The publisher owns nothing.** The registry rejects feedback from the identity's owner or
  operators - `Self-feedback not allowed` - which is enforced on chain, not by convention. The
  owner key literally cannot post a score for its own agent; the attempt reverts.
- **Anyone may post a competing entry**, and the test checks all of them, not only ours. Two
  honest indexers should agree; a disagreement means one has a bug, and `inputHash` says which
  logs to look at.

### The manifest, and the part of T13 it does not reach

"Anyone can recompute this" was true in principle and getting less true every day. A full
replay costs one `eth_getLogs` per 100 blocks, because 100 is the largest range Monad's public
RPC will answer - checked against all three public endpoints. The cost tracks how long the
mandate has existed, not how much it did: about 2,810 requests per day of age whether the agent
acted three times or not at all. By mid-October a cold verification was a 42-minute walk, which
is the kind of number that makes a defence theoretical.

So the publisher, which has to walk the history anyway, also publishes the list of blocks that
carried a log (`console/public/dcs1-manifest.json`). A verifier fetches only those - one request
per act instead of one per 100 blocks of chain. Verification went from 42 minutes to 20 seconds
and stopped growing with the calendar.

The obvious objection is that this trusts the publisher to list every act, and it does not:

- Every act event carries `id`, the mandate's `nonce` after `++`, so the ids recovered from a
  manifest must be exactly 1..N with no gaps. Dropping one from the middle leaves a hole.
- Dropping acts from the *end* leaves no hole, so N is checked against `nonce()` read from the
  chain at the score's pinned height - a number the publisher cannot influence.
- The recomputed `inputHash` is checked against the `feedbackHash` on the registry entry, so a
  manifest cannot be edited after publication to point at a different set of logs than the
  score was computed from.

**What it does not prove, stated precisely.** `nonce` counts acts. It does not count policy
changes, and `Tightened` events feed DCS-1's authority term. A publisher who omits a
policy-change block from the manifest *and* computes the published score and `feedbackHash` from
that same incomplete set produces a self-consistent lie that all three checks above pass.
Catching it needs a walk of every block, which `DOCKET_FULL_REPLAY=1` does and which
`.github/workflows/verify-full.yml` runs weekly.

That is not a regression in T13: a lying publisher was only ever catchable by an independent
full replay, and DCS-1 §1 has always said the spec is the authority, not the publisher. What the
manifest adds is that the cheap path cannot be made to *disagree* with the expensive one by
tampering alone. A manifest is a hint about where to look, never a claim about what happened.

All three checks are canaried, because a check that has never been seen to fail is decoration.
Dropping a block that is alone in its 100-block window trips the act count; dropping a
deployment-era block that carries no act trips the `inputHash`; and stubbing out the
`feedbackHash` comparison fails the cold-sync test on exactly that assertion. The isolation
condition is load-bearing - an earlier version of the first canary dropped a block that shared a
window with three others, the window was fetched regardless, the logs came back, and the test
proved nothing while passing.

## Notes on the partial rows

**T5.** The balance assertion caps what a counterparty can take at the declared outflow plus
slippage. It cannot make a counterparty honest - if the agent declares 100 and the counterparty
takes exactly 100 while delivering nothing, that is a bad trade, not a policy breach. Docket
bounds the loss; it does not price the deal.

**T7, and a configuration that undercuts it.** On the deployed showcase mandate the guardian
and the owner are the same address, `0x2602…2579`. The contract supports a distinct guardian -
`setGuardian` is a live function and the constructor takes the two separately - but this
deployment was never given one.

That matters because the guardian exists for exactly the case where the owner key is gone. An
attacker holding the owner key on this mandate holds the guardian key too, so "the guardian can
pause inside the timelock window" is not a defence here; it is the attacker pausing, if they
feel like it. What survives is the timelock itself and the public `LoosenQueued` event, which
are real and which do not depend on a second key.

It is stated here rather than quietly fixed because fixing it properly means a guardian key
held by someone other than the owner, and a second key the same person holds in the same place
is theatre. The honest version of T7 on this deployment is: the timelock buys an hour and makes
the attempt public, and nothing stops a determined owner-key holder after that.

With the owner key an attacker can queue any loosening, but not execute it before the
delay, and the `LoosenQueued` event is public. The guardian exists precisely for this window and
can pause instantly. If the owner key and the guardian key are both lost, the timelock is the
only remaining protection and it expires.

**T10.** Denial spam is self-limiting because the agent pays gas, and DCS-1 weights hard
breaches far above soft ones so noise cannot be manufactured cheaply. But a determined attacker
holding the agent key can degrade the mandate's score. The record is per-mandate and rotation
does not launder it, which is correct for honesty and unhelpful here.

**T11.** A fresh mandate genuinely starts clean. This is not a gap to be closed with an identity
system; it is the design. What is expensive to fabricate is a mandate that is *old* and *funded*
- you cannot buy 180 days of clean history, and a time-weighted balance requires actually
posting the capital. Sybil resistance here is economic, and saying so plainly is stronger than
implying a cryptographic guarantee that does not exist.
