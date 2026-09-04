# DCS-1 — Docket Conduct Score, version 1

*Frozen 4 September 2026.*

DCS-1 is a **pure function of a mandate's event log up to a stated block height**. Given the
same events it returns the same integer everywhere, in any language, forever. Changing anything
in this document produces DCS-2; it never produces a different DCS-1.

## 1. What it scores, and what it does not

DCS-1 scores **conduct**: did this mandate stay inside its bounds, across how much activity,
for how long, under how much authority.

It does **not** score:

- **Solvency.** A mandate's balance is a public fact a counterparty can read directly. Folding
  it into a conduct score would require a price oracle, and an oracle would destroy the one
  property that makes this score worth anything — that it can be recomputed from chain events
  alone with no external input.
- **Competence.** An agent that stays inside its mandate while making terrible trades scores
  well. DCS-1 says it did what it was permitted to do, not that it did the right thing.
- **The agent's operator.** The subject is the mandate, not the person.

Anyone consuming a DCS-1 value should read it as *"how reliably has this mandate been kept"*,
and check balance and business terms separately.

## 2. Determinism

Floating point is banned. `log`, `exp` and fractional powers are banned. Every quantity below is
a non-negative integer in **parts per million (ppm)**, every division is **floor division**, and
every table is interpolated linearly in integer arithmetic. This is not fussiness: I5 requires
byte-identical recomputation by a third party, and `0.5 ** (days / 30)` is not byte-identical
across languages.

## 3. Inputs

From the mandate's own events, up to and including block `asOf`:

| Symbol | Meaning | Source |
| --- | --- | --- |
| `allowedActs` | count of `Allowed` events | `Allowed` |
| `firstActBlockTime` | timestamp of the block carrying the first `Allowed` **or** `Denied` | either |
| `asOfTime` | timestamp of block `asOf` | chain |
| `denials` | every `Denied`, with its `rule` and block timestamp | `Denied` |
| `capHistory` | the native `windowCap` over time | `MandateDeployed`, `Tightened`, `LoosenExecuted` |

`Failed` and `WouldDeny` are **ignored**. A `Failed` act passed the policy and the counterparty
reverted, which is not the mandate's conduct. A `WouldDeny` was recorded in observe mode, where
the guard was deliberately not enforcing; scoring it would punish owners for measuring before
arming, which is the opposite of what observe mode is for.

## 4. Terms

### 4.1 Experience `E`

Piecewise-linear in `allowedActs`, interpolated between these breakpoints:

| `allowedActs` | `E` (ppm) |
| --- | --- |
| 0 | 0 |
| 1 | 50,000 |
| 10 | 200,000 |
| 100 | 400,000 |
| 1,000 | 600,000 |
| 10,000 | 800,000 |
| 100,000 | 950,000 |
| 1,000,000 and above | 1,000,000 |

Interpolation between breakpoints `(x0,y0)` and `(x1,y1)`:
`E = y0 + (n - x0) * (y1 - y0) / (x1 - x0)`, floor division.

Acts are not free — the floor is 47k gas each — so experience cannot be manufactured cheaply.

### 4.2 Age `A`

```
ageDays = (asOfTime - firstActBlockTime) / 86400          # floor
A       = min(1_000_000, ageDays * 1_000_000 / 180)       # floor
```

Saturates at 180 days. This is the term that cannot be accelerated at any price.

### 4.3 Authority `U`

Time-weighted native `windowCap` carried over the mandate's life, interpolated on the same
scheme as `E`:

| TWA `windowCap` (wei) | `U` (ppm) |
| --- | --- |
| 0 | 0 |
| 1e15 | 100,000 |
| 1e17 | 300,000 |
| 1e18 | 500,000 |
| 1e20 | 750,000 |
| 1e22 and above | 1,000,000 |

```
twaCap = Σ (cap_i * durationSeconds_i) / Σ durationSeconds_i      # floor
```

`U` measures **granted authority**, not funds held. An owner can set a large cap over an empty
mandate, so `U` alone is not a solvency signal — see §1. What it does capture is that a mandate
trusted with more, for longer, and kept clean, is a stronger record than one trusted with
nothing.

### 4.4 Breach `D`

Each `Denied` contributes a weight that halves every 30 days, stepwise:

```
class(rule):
  hard = TargetNotAllowed, SelectorNotAllowed, SelectorForbidden,
         AssetNotTracked, PerActionCap, SpendWindowCap
  soft = Paused, Expired, DeadlinePassed, RateCap, DeclarationUnsorted

w(hard) = 340_000 ppm
w(soft) =  50_000 ppm

ageDays_i = (asOfTime - denialTime_i) / 86400              # floor
halvings  = ageDays_i / 30                                 # floor
weight_i  = w(class_i) >> min(halvings, 63)                # integer shift

D = min(1_000_000, Σ weight_i)
```

The split is the substance of the score. A **hard** breach is an attempt to exceed the mandate's
authority — to pay someone not on the list, to move more than the cap allows. A **soft** breach
is an attempt that was merely mistimed: too fast, too late, while paused. Three hard breaches
inside a month take the score to zero; soft ones accumulate slowly and fade.

Stepwise decay rather than continuous is deliberate. A score that changes only on known dates is
one a counterparty can reason about, and one an integer implementation reproduces exactly.

## 5. The score

```
base = 200_000                                                     # ppm
raw  = base + (350_000 * E + 250_000 * A + 200_000 * U) / 1_000_000
S    = raw * (1_000_000 - D) / 1_000_000                           # floor
score = S * 1000 / 1_000_000                                       # floor, 0..1000
```

A mandate with no history scores 200. A perfect long-lived one approaches 1000. Any mandate with
three recent hard breaches scores 0, whatever else it has done — which is the intended shape:
conduct is a veto, not a contribution.

## 6. `inputHash`

Every published score ships `(score, specVersion, asOf, inputHash)`. The hash commits to the
exact event set consumed, so a reader can re-derive the number instead of trusting the
publisher.

Events are ordered by `(blockNumber, logIndex)` ascending, and:

```
inputHash = keccak256( concat over events of (
    uint64be(blockNumber) ||
    uint32be(logIndex)    ||
    bytes32(topic0)       ||
    bytes32(keccak256(data))
) )
```

The empty event set hashes to `keccak256("")`.

## 7. Verification

`docket score <mandate> --from <deployBlock> --at <block> --verify <score>` performs a cold sync
from chain, recomputes, and
either reproduces the published number byte-identically or fails loudly. A DCS-1 value that
cannot be reproduced is not a low score; it is a broken publisher, and it should be treated as
such.

A verifier must also read the chain **uncached**. Clients commonly cache the head block number
for their polling interval, and a replay run moments after a transaction lands will then score
the chain as it was before it — producing a different, honestly-derived, wrong answer. The
reference implementation passes `cacheTime: 0`; any other implementation must do the equivalent.

`--from` is required rather than defaulted to genesis. Public RPCs cap `eth_getLogs` by block
range, so a verifier needs the mandate's deployment block to start from; it is published as
ERC-8004 metadata under `docket:deployBlock`.

## 8. Known limitations

Stated here rather than discovered by a reader.

- **`U` is gameable in isolation.** A large cap over an empty mandate costs nothing. It is
  weighted lowest of the three positive terms for that reason, and §1 tells consumers to check
  the balance themselves.
- **Denial spam degrades a mandate's own score** (threat-model T10). An attacker holding the
  agent key can attempt hard breaches deliberately. The record is per-mandate and rotating the
  key does not launder it — correct for honesty, unhelpful here.
- **A fresh mandate starts clean** (T11). This is the design, not a gap: what is expensive is an
  *aged* clean record, and `A` is where that lives.
- **No cross-mandate identity.** One owner running ten mandates has ten independent scores.
  Aggregating them would need an identity claim DCS-1 deliberately does not make.
