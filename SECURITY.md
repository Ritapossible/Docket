# Security Policy

Docket is a contract that holds funds and refuses payments outside a policy. A flaw in it is a
flaw in someone's spending limit, so this document is not a formality.

## Status

**Unaudited, and deployed only to testnet.** Nothing here has been reviewed by a third party.
Do not put funds you care about behind a Docket mandate on mainnet.

## Reporting a vulnerability

Do **not** open a public issue for a security flaw in the contracts.

Open a private security advisory through GitHub:
<https://github.com/Ritapossible/Docket/security/advisories/new>

Include what you have: the affected file and function, the conditions required, the impact, and
a proof of concept if you have one. A Foundry test that fails is the most useful possible
report. Expect an acknowledgement within 72 hours.

## Scope

**In scope**

- `contracts/src/` - the mandate, the policy library, the window library
- `indexer/src/` - anything that would let a published DCS-1 score be irreproducible or forged
- `sdk/src/` - anything that would cause a caller to treat a refused act as a successful one

**Out of scope**

- The threat-model rows already documented as `partial` or `not covered` in
  `spec/THREAT-MODEL.md`. Those are known and stated. A report that a documented limitation
  exists is not a vulnerability report; a report that a documented *covered* row does not hold
  is one, and a valuable one.
- The console's dependence on a viewer-supplied RPC URL. It is read-only, holds no key and never
  signs.
- Anvil's well-known development keys in `demo/`. They are public by design and must never be
  used on a funded network.

## What we consider a vulnerability

Anything that breaks one of the six invariants in `ARCHITECTURE.md` §1. Concretely:

- Value leaving a mandate other than through `act()` within policy, or `withdraw()` by the owner
- A policy violation that reverts instead of recording a `Denied` event (invariant I2 - a revert
  destroys the record the whole system rests on)
- Any loosening of a policy that takes effect without passing through the timelock (I3)
- A published DCS-1 score that cannot be reproduced from chain events (I5)
