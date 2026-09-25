# Docket

**An AI agent's reputation, computed from what a contract actually let it do.**

Docket gives an agent an on-chain spending mandate it cannot exceed, and turns the enforced
record - every action allowed, **every action refused** - into a reputation anyone can
recompute from chain data alone.

Built on [Monad](https://monad.xyz) for the *Metropolis* hackathon, Trust, Identity & AI
Infrastructure track.

---

## The idea in one screen

Give an agent money and you have a problem: it can be prompt-injected, its key can leak, and its
judgement is not yours. The existing answers buy safety with a trusted component - an attested
enclave, a ZK circuit with tens of seconds of proving, or an operator you catch after the fact.

Docket makes the check a plain contract that runs **inside the agent's action loop**. The agent
is granted permission to call exactly one function, and holds neither the funds nor the policy.
The check runs in the same transaction and refuses anything outside it.

The part that makes it more than a spending limit: **a refusal never reverts.** It is logged
as a permanent public artifact carrying the rule that fired and the calldata that was attempted.
Every other approach hides the refusal - an enclave denies silently, a ZK gate leaves no trace
by construction. Docket makes being stopped into evidence you can show someone, which is what
makes reputation possible at all.

## "Isn't this a permission system?"

The first question anyone asks, and it deserves an answer before anything else.

Bounded agent authority is crowded and some of it is very good. MetaMask's Agent Wallet grants
an agent narrow, revocable permissions through the Delegation Toolkit - ERC-7715 to request a
scoped permission, ERC-7710 to redeem it. Safe allowance modules, ERC-4337 session keys and
Rhinestone's smart sessions all bound what an agent may spend.

**The difference is not the bound. It is the record.**

A permission grant says what an agent *may* do, and has no notion of a refusal. An agent that
exceeds an ERC-7715 permission gets a reverted transaction, and a revert destroys its own logs:
nothing durable is left behind saying what was attempted. The strongest alternatives are worse
still - an attested enclave denies silently, and a ZK gate leaves no trace by construction.

Docket keeps the refusal. Every attempt outside the policy is a permanent public event carrying
the rule that fired and the calldata that was attempted, and that record is what the reputation
is computed from. A permission system tells you what an agent was allowed to do. Docket tells
you what it tried.

These are complementary rather than competing. A smart account can hold the mandate and grant
the agent its scope; Docket is the layer underneath that keeps the evidence.

## Why it needs Monad

At 300ms blocks and 600ms finality a policy check can sit synchronously in an agent's loop, and
recording every *refused* attempt on-chain is affordable. Remove Monad and the design does not
degrade - it inverts back into something you have to trust. `ARCHITECTURE.md` §2 is the
argument and `bench/` is the measurement.

## "Does the agent hold a private key?"

The question every reviewer asks, and the honest answer is the pitch.

Something has to sign, because an on-chain action needs a transaction. In Docket that signer is
whatever address the owner names as `agent`, and today the demo uses an ordinary EOA. What
matters is not that a key exists, but what holding it is worth.

**Almost nothing.** The agent's signer cannot move funds, only call `act()`. It cannot change a
limit, allowlist a counterparty, unpause, or withdraw. If an attacker steals it outright they
inherit exactly the mandate's own bounds, the owner can rotate the key in one block, and a
guardian can pause instantly. That is threat-model row T2, and there is a test named for it.

Bounded is not zero, and the honest limits are these: a thief can spend up to the caps, to
addresses already on the allowlist, until someone notices; and it can deliberately attempt
breaches to damage the mandate's own score (T10). Docket bounds the loss and makes the attempt
public. It does not pretend the key is harmless.

The wider point is that "do not let agents hold keys" is good advice precisely because, in most
systems, a key *is* authority. Docket separates the two. The signer is a permission slip; the
mandate is the authority, and it stays on chain where the agent cannot reach it.

## Two properties worth stating plainly

- **Limits fall in 600 milliseconds and rise in an hour.** Tightening a policy is immediate;
  loosening is timelocked and publicly queued. There is no admin key. Compromising the owner's
  console does not let anyone raise a limit and drain.
- **Docket never leaves a standing allowance.** Where an action needs one, the mandate sets an
  exact allowance, calls, and zeroes it in the same transaction.

## What it does not do

Stated up front, and rendered in the product itself rather than buried here: it bounds money,
not harm; it covers tracked assets only; it publishes intent, including refused intent; and its
sybil resistance is economic rather than cryptographic. `ARCHITECTURE.md` §7 is the full list.

## Documents

| | |
| --- | --- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | invariants, contracts, off-chain design, threat model, known gaps |
| [`spec/DCS-1.md`](spec/DCS-1.md) | the scoring spec: inputs, terms, `inputHash`, verification |
| [`spec/THREAT-MODEL.md`](spec/THREAT-MODEL.md) | every attack, its defence, and whether a test covers it |
| [`spec/ERC8004.md`](spec/ERC8004.md) | the pinned standard revision and where Docket deviates |
| [`TESTING.md`](TESTING.md) | the six test layers and what each one catches |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | setup, the pre-PR checks, and the house rules |
| [`SECURITY.md`](SECURITY.md) | scope, and how to report a flaw privately |
| [`bench/RESULTS.md`](bench/RESULTS.md) | measurements, and an explicit list of what is not measured |
| [`PLAN.md`](PLAN.md) | schedule, definition of done, cut list, risk register |
| [`console/DESIGN.md`](console/DESIGN.md) | the console's design system and responsive rules |

## Try it

```bash
make demo
```

Starts a local chain, deploys a mandate, and shows an agent being prompt-injected and refused on
chain. Exits non-zero if the guarantee fails.

## Deploying the console

`vercel.json` at the repository root configures the build. Two things matter, and both will
waste an afternoon if you get them wrong:

**Leave the project's Root Directory as the repository root.** Do not set it to `console/`. The
console imports the scorer and the replay from `../../indexer` and the ABI from `../../sdk`, and
its build generates the threat panel from `spec/THREAT-MODEL.md`. Rooted at `console/`, none of
those paths exist and the build fails.

**A hosted console cannot reliably reach a local chain.** The page is served over https; a
browser's mixed-content and private-network protections stand between it and `http://127.0.0.1`,
and `anvil` does not send the headers that would satisfy them. So point a hosted console at a
public https RPC:

```
https://<your-deployment>/?mandate=0x…&rpc=https://testnet-rpc.monad.xyz&from=<deployBlock>
```

and run the console locally (`npm --prefix console run dev`) when demoing against `anvil`. The
`from` block is required because public RPCs cap `eth_getLogs` by range - see `spec/DCS-1.md` §7.

The config also sets a Content-Security-Policy, immutable caching for fingerprinted assets, and
`must-revalidate` on the entry document. `node console/scripts/serve-static.mjs` serves the build
locally with those exact headers, so the policy can be tested before it ships rather than
debugged on a live URL.

## Live on Monad testnet

| | |
| --- | --- |
| Showcase mandate | [`0x2EC195646731F274c0e500f3B671C04189446Ae9`](https://testnet.monadexplorer.com/address/0x2EC195646731F274c0e500f3B671C04189446Ae9) |
| Deploy block | `65577709` |
| Benchmark mandate | [`0x4e211213777c4049416327c6F5ea10cDA93b0DAa`](https://testnet.monadexplorer.com/address/0x4e211213777c4049416327c6F5ea10cDA93b0DAa) |
| Chain | Monad testnet, id `10143` |

Full provenance - transaction hashes, constructor arguments, the commit each was built from -
is in [`deployments/monad-testnet.json`](deployments/monad-testnet.json).

Recompute the score yourself, from chain events only:

```bash
node --experimental-strip-types indexer/src/cli.ts \
  score 0x2EC195646731F274c0e500f3B671C04189446Ae9 --from 65577709
```

**Measured, not claimed:** act-to-finality p50 **568 ms**, min 308 ms, p95 1.36 s, over 20 acts
on testnet. That is a policy check that fits inside an agent's action loop. See
[`bench/RESULTS.md`](bench/RESULTS.md) §4b for the tail and the reproduction command.

## Status

Contracts, indexer, SDK, demo and console are built, tested, and deployed to Monad testnet. The
latency measurement the Monad argument rests on is done and published above.

Outstanding: the ERC-8004 identity and reputation entries, a scheduled agent driving the
showcase mandate continuously, and the demo video.
