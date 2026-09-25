#!/usr/bin/env node
/**
 * Measures act-to-finality latency against a live mandate.
 *
 * This is the half of ARCHITECTURE.md §2 that gas figures cannot support. The claim is that a
 * policy check can sit inside an agent's action loop; that is a latency claim, and until it is
 * measured on a real chain it is prose.
 *
 * Each sample is a refused act - a payment to an address that is not on the allowlist. Nothing
 * moves, so the run is repeatable and cheap, and every sample leaves a real Denied event on
 * chain, which is what the record is supposed to look like.
 *
 *   MANDATE=0x… AGENT_PRIVATE_KEY=0x… node bench/latency.mjs [samples]
 */
import {createPublicClient, createWalletClient, defineChain, http} from "viem";
import {privateKeyToAccount} from "viem/accounts";

import {mandateAbi} from "../sdk/src/abi.ts";

const RPC = process.env.MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
const MANDATE = process.env.MANDATE;
const KEY = process.env.AGENT_PRIVATE_KEY;
const SAMPLES = Number(process.argv[2] ?? 20);

if (!MANDATE || !KEY) {
  console.error("MANDATE and AGENT_PRIVATE_KEY are required");
  process.exit(1);
}

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: {name: "MON", symbol: "MON", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});

const account = privateKeyToAccount(KEY);
const publicClient = createPublicClient({chain: monadTestnet, transport: http(RPC), cacheTime: 0});
const wallet = createWalletClient({account, chain: monadTestnet, transport: http(RPC)});

// Not on the allowlist, so every sample is refused at the first rule. The point is the round
// trip, not the outcome.
const TARGET = "0x000000000000000000000000000000000000dEaD";

const submitToHash = [];
const submitToReceipt = [];
let denied = 0;

console.log(`mandate ${MANDATE}`);
console.log(`agent   ${account.address}`);
console.log(`samples ${SAMPLES}\n`);

for (let i = 0; i < SAMPLES; i++) {
  const action = {target: TARGET, value: 0n, declared: [], data: "0x", deadline: 0n};

  const t0 = performance.now();
  const hash = await wallet.writeContract({
    address: MANDATE,
    abi: mandateAbi,
    functionName: "act",
    args: [action],
  });
  const t1 = performance.now();
  const receipt = await publicClient.waitForTransactionReceipt({hash, pollingInterval: 50});
  const t2 = performance.now();

  submitToHash.push(t1 - t0);
  submitToReceipt.push(t2 - t0);

  // A refused act still succeeds as a transaction and still emits - that is invariant I2.
  // An act that emitted nothing would mean the record was lost, which is the one outcome
  // this benchmark must not quietly tolerate.
  if (receipt.logs.length === 0) {
    console.error(`  sample ${i + 1} emitted no event - the refusal was not recorded`);
    process.exitCode = 1;
  } else {
    denied += 1;
  }

  process.stdout.write(
    `  ${String(i + 1).padStart(3)}  ${(t2 - t0).toFixed(0).padStart(5)} ms  block ${receipt.blockNumber}  gas ${receipt.gasUsed}\n`,
  );
}

function pct(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

console.log(`\nrefusals recorded on chain: ${denied}/${SAMPLES}`);
console.log("\nsubmission -> tx hash");
console.log(`  p50 ${pct(submitToHash, 50).toFixed(0)} ms   p95 ${pct(submitToHash, 95).toFixed(0)} ms   p99 ${pct(submitToHash, 99).toFixed(0)} ms`);
console.log("submission -> receipt (act to finality)");
console.log(`  p50 ${pct(submitToReceipt, 50).toFixed(0)} ms   p95 ${pct(submitToReceipt, 95).toFixed(0)} ms   p99 ${pct(submitToReceipt, 99).toFixed(0)} ms`);
console.log(`  min ${Math.min(...submitToReceipt).toFixed(0)} ms   max ${Math.max(...submitToReceipt).toFixed(0)} ms`);
