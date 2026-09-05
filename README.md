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
holds a key that can call exactly one function. The policy is evaluated in the same transaction
and refuses anything outside it.

The part that makes it more than a spending limit: **a refusal never reverts.** It is logged
as a permanent public artifact carrying the rule that fired and the calldata that was attempted.
Every other approach hides the refusal - an enclave denies silently, a ZK gate leaves no trace
by construction. Docket makes being stopped into evidence you can show someone, which is what
makes reputation possible at all.

## Why it needs Monad

At 300ms blocks and 600ms finality a policy check can sit synchronously in an agent's loop, and
recording every *refused* attempt on-chain is affordable. Remove Monad and the design does not
degrade - it inverts back into something you have to trust. `ARCHITECTURE.md` §2 is the
argument and `bench/` is the measurement.

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
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | invariants, contracts, off-chain design, threat model |
| [`PLAN.md`](PLAN.md) | schedule, definition of done, cut list, risk register |
| [`CLAUDE.md`](CLAUDE.md) | working rules and conventions for this repo |

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

## Status

Contracts, indexer, SDK, demo and console are built and tested. Nothing is deployed to a public
chain yet, and act-to-finality latency - the measurement the Monad argument rests on - is still
outstanding.
