# Docket - project memory

Read this before touching anything. It is the operating manual for working in this repo, and it
is deliberately short. The design lives in `ARCHITECTURE.md`; the schedule lives in `PLAN.md`.

## What this is

Docket gives an AI agent an on-chain spending mandate it cannot exceed, and turns the enforced
record - every action allowed, every action refused - into a reputation anyone can recompute.

Built for the Monad *Metropolis* hackathon, **Trust, Identity & AI Infrastructure** track.
Deadline **13 October 2026**; we submit **12 October**.

## The six invariants

Do not violate these. If a task appears to require violating one, stop and raise it - that is a
design change, not an implementation detail, and it gets recorded in `ARCHITECTURE.md` §1.

1. **I1** - the agent holds no key that moves funds except through `Mandate.act()`.
2. **I2** - a policy violation **never reverts**; it emits `Denied` and returns `false`.
3. **I3** - tightening is immediate, loosening is timelocked, there is no admin key.
4. **I4** - no global mutable state on the hot path; mandate state is partitioned per mandate.
5. **I5** - every published number is recomputable by a third party from chain events alone.
6. **I6** - the model translates prose into a policy struct; a human approves it; the model
   never decides.

**I2 is the one that gets broken by accident.** `require()` in the policy path looks correct and
destroys the product, because a revert erases its own logs and the denial record is the whole
point. Policy failures return; only a broken transaction - a false outflow declaration, a
reentrancy - reverts.

## Vocabulary

Use these words consistently; they appear in the contracts, the events, the console and the
write-up, and drift between them is expensive.

| Term | Means |
| --- | --- |
| **Mandate** | the contract holding funds and policy. One per agent purpose. Never "wallet" or "vault". |
| **Policy** | the struct plus allowlists. Never "rules", "config" or "settings". |
| **Act** | one attempted agent action, `act()`. Never "transaction" - a denied act is also a transaction. |
| **Allowed / Denied / Failed** | passed and executed / refused by policy / passed but the target reverted. Keep these three distinct everywhere. |
| **Tightening / loosening** | the two directions of a policy change, per the partial order in `ARCHITECTURE.md` §3.4. |
| **DCS-1** | the scoring spec. The score is "the DCS", never "the rating" or "the reputation score". |
| **Docket** | the product, and the public record of a mandate's acts. |

## Conventions

- **Solidity 0.8.26, Foundry, no proxies.** Mandates are immutable; migration means a new
  mandate. An upgradeable guard is not a guard.
- **Tests reference threat-model IDs.** A test covering T3 has `T3` in its name. A row in
  `spec/THREAT-MODEL.md` may not be marked covered until a test references it.
- **No claim without a link.** Performance claims cite `bench/RESULTS.md`. Security claims cite a
  test. Standard-conformance claims cite the pinned revision in `spec/ERC8004.md`.
- **Specs precede implementations.** `spec/DCS-1.md` is written before the scorer, not derived
  from it afterwards. A spec reverse-engineered from code is not a spec.
- **Events are the public API.** Changing an event signature is a breaking change to the
  indexer, the console and DCS-1. Treat it as one.
- **Deploy to Monad testnet every week.** Dated on-chain deployments are part of the submission
  evidence, not just a convenience.
- **Commits are small, daily, and describe the why.** The commit history is read by judges.
- **Check `forge build --sizes`, not the gas report's "Deployment Size".** They are different
  numbers, and confusing them once already hid a contract that was over the EIP-170 limit.

## What not to add

Each of these has been considered and rejected. Reopening one requires a reason that has
changed, not a fresh preference.

- **LLM-evaluated policies.** Conditions written in prose and judged by a model at decision
  time. This breaks I6 and destroys the property the project rests on: that a third party can
  recompute every decision and get the same answer. Latch offers this and it is the one part of
  their design not to copy (`ARCHITECTURE.md` §11.5).
- **Cross-chain support.** Portability is a virtue everywhere except a protocol-sponsored track.
  It actively weakens the submission.
- **A token.** Nothing in the design needs one.
- **A general-purpose agent framework.** One claim beats breadth; breadth is how these projects lose.
- **Usage metrics, growth mechanics, a marketplace.** This track is judged on guarantee and
  design. Optimising for signups is optimising for the wrong axis.
- **Batching `act()`.** One transaction carrying several independent policy outcomes cannot be
  logged honestly. Deliberately refused, per I2.
- **Upgradeable mandates.** See above.

## Where things are

```
ARCHITECTURE.md   design contract: invariants, contracts, off-chain, threat model
PLAN.md           week-by-week schedule, definition of done, cut list, risk register
contracts/        Foundry. Mandate, policy and window libraries
sdk/              TypeScript + viem. act(), DeniedError, agent tool-shim
indexer/          deterministic replay, DCS-1 reference implementation, verify CLI
console/          Vite + React. live stream, limits, "not protected from" panel
spec/             DCS-1.md, THREAT-MODEL.md, POLICY.md, ERC8004.md
bench/            load harness and published results
```

## Where to start a new session

`PLAN.md` §9 is the ordered work queue, revised 5 September. Start at the top of it. Items 1 and
2 are blockers and item 1 is time-sensitive in a way nothing else here is: DCS-1's age term
cannot be accelerated, so the mandate has to be live and accruing history as early as possible.

`ARCHITECTURE.md` §10 has the technical detail behind each item, including the console's
full-history re-read, which must be fixed before or alongside the testnet deployment rather than
after it.

## Working rules

- **Consult `PLAN.md` §5 before adding scope.** The cut list is ordered in advance so that
  cutting is a decision already made rather than a panic on 11 October.
- **When a week's exit criterion is unmet, cut - do not roll work forward silently.**
- **Honest limits ship in the product.** The console renders the uncovered threat-model rows.
  Naming a weakness before a judge finds it converts it into evidence of rigour; hiding one
  converts it into the thing they remember.
- **Prefer a measurement to an argument.** The project's central claim is that this design needs
  Monad. Until act-to-finality latency is measured on testnet, that claim is prose, and prose is
  what the vault's clearest matched pair lost on.
- **The demo beat is the priority ordering.** Injection → on-chain refusal → console shows the
  rule → a counterparty refuses the agent. Work that does not serve that beat or the guarantee
  behind it is negotiable, whatever else it has going for it.
