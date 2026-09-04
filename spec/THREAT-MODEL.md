# Docket — Threat Model

*Applies to `contracts/src/Mandate.sol`. Revised 2026-09-04.*

A row may be marked **covered** only when a test in `contracts/test/` names its ID (`_T3_`).
`script/check-threat-coverage.sh` enforces this in CI, so this table cannot drift into
optimism. Rows marked **partial** or **not covered** are real and are rendered in the console's
"what this mandate does not protect you from" panel, not only here.

| ID | Attack | Defense | Status |
| --- | --- | --- | --- |
| T1 | Prompt injection drives the agent to overspend or pay an attacker | policy gate; the attempt is recorded as `Denied` | covered |
| T2 | The agent's session key is stolen | the thief is bound by the same policy; rotation is instant; the guardian can pause | covered |
| T3 | Calldata smuggling — an aggregator route, nested multicall or callback asks for one thing and does another | selector allowlist, declared outflows, and the post-execution balance assertion | covered |
| T4 | Drain through a standing allowance | `approve`/`permit`/`setApprovalForAll` are never allowlistable; allowances are set and zeroed inside one transaction | covered |
| T5 | An allowlisted counterparty turns malicious | loss is bounded to the declared outflow | partial |
| T6 | The owner's console is compromised and limits are raised | loosening is timelocked and publicly queued; there is no admin key | covered |
| T7 | The owner's key is fully compromised | the timelock creates a detection window; the guardian can pause within it | partial |
| T8 | An untracked asset is drained — an NFT, or a token received during the call | the balance assertion covers `trackedAssets` and nothing else | not covered |
| T9 | Reentrancy into `act()` | `nonReentrant`, plus the agent-only check as a second layer | covered |
| T10 | A compromised key spams denials to tank the mandate's score | the agent pays gas for its own refusals; DCS-1 separates hard from soft breaches | partial |
| T11 | Sybil — abandon a tarnished mandate and deploy a fresh one | economic only: DCS-1 weights age and time-weighted capital, neither of which can be accelerated | partial, by design |
| T12 | Oracle manipulation against price-band rules | price bands are out of scope in v1 | n/a in v1 |
| T13 | The indexer publishes a false score | anyone recomputes from events; `inputHash` is published with every score | not yet — week 3 |
| T14 | The public denial log leaks the agent's strategy | none in v1; commit-then-reveal calldata is future work | not covered |

## Notes on the partial rows

**T13.** The mechanism is designed (`ARCHITECTURE.md` §4.2) but the indexer does not exist yet,
so the row cannot be marked covered. It becomes covered when `docket score --verify` reproduces
a published score from a cold sync and a test asserts it.

**T5.** The balance assertion caps what a counterparty can take at the declared outflow plus
slippage. It cannot make a counterparty honest — if the agent declares 100 and the counterparty
takes exactly 100 while delivering nothing, that is a bad trade, not a policy breach. Docket
bounds the loss; it does not price the deal.

**T7.** With the owner key an attacker can queue any loosening, but not execute it before the
delay, and the `LoosenQueued` event is public. The guardian exists precisely for this window and
can pause instantly. If the owner key and the guardian key are both lost, the timelock is the
only remaining protection and it expires.

**T10.** Denial spam is self-limiting because the agent pays gas, and DCS-1 weights hard
breaches far above soft ones so noise cannot be manufactured cheaply. But a determined attacker
holding the agent key can degrade the mandate's score. The record is per-mandate and rotation
does not launder it, which is correct for honesty and unhelpful here.

**T11.** A fresh mandate genuinely starts clean. This is not a gap to be closed with an identity
system; it is the design. What is expensive to fabricate is a mandate that is *old* and *funded*
— you cannot buy 180 days of clean history, and a time-weighted balance requires actually
posting the capital. Sybil resistance here is economic, and saying so plainly is stronger than
implying a cryptographic guarantee that does not exist.
