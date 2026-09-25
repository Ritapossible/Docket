#!/usr/bin/env node
/**
 * The scheduled agent. Keeps the showcase mandate alive and accruing a conduct record.
 *
 * DCS-1's age term saturates at 180 days and cannot be accelerated at any price, so the only
 * way to have an aged mandate at judging is to have deployed early and kept it working. This
 * is the thing that does the working: a few small payments to the allowlisted counterparty,
 * on a schedule, indefinitely.
 *
 * It is deliberately boring. An agent that occasionally attempted a breach would build a more
 * dramatic record and a worse one - the point of the showcase mandate is clean conduct, with
 * the refusal supplied live during the demo.
 *
 *   MANDATE=0x… AGENT_PRIVATE_KEY=0x… node script/agent.mjs [acts]
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  parseEventLogs,
} from "viem";
import {privateKeyToAccount} from "viem/accounts";

import {mandateAbi} from "../sdk/src/abi.ts";

const RPC = process.env.MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
const MANDATE = process.env.MANDATE;
const KEY = process.env.AGENT_PRIVATE_KEY;
const COUNTERPARTY = process.env.COUNTERPARTY ?? "0x000000000000000000000000000000000000c0DE";
const ACTS = Number(process.argv[2] ?? 1);
const AMOUNT = 500_000_000_000_000n; // 0.0005 MON

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

const balance = await publicClient.getBalance({address: MANDATE});
const gas = await publicClient.getBalance({address: account.address});
console.log(`mandate ${MANDATE}  balance ${formatEther(balance)} MON`);
console.log(`agent   ${account.address}  gas ${formatEther(gas)} MON`);

// Go red while there is still time to act, not once the mandate is already dry. At three acts
// a day the reserve below is roughly two months of warning - a scheduled job that fails loudly
// beats one that silently stops working weeks before anyone looks.
const RESERVE = AMOUNT * 200n; // 0.1 MON
if (balance < RESERVE) {
  console.error(`mandate balance is below the ${formatEther(RESERVE)} MON reserve - top it up`);
  process.exitCode = 1;
}
if (gas < 10n ** 16n) {
  console.error(`agent gas is low - top it up`);
  process.exitCode = 1;
}

let allowed = 0;
for (let i = 0; i < ACTS; i++) {
  const action = {
    target: COUNTERPARTY,
    value: AMOUNT,
    declared: [],
    data: "0x",
    deadline: 0n,
  };

  // Estimate against the state this act will actually see, then pad. viem would estimate
  // against the pending block, which on a fast chain is often the state from before the
  // previous act landed - and that state has a warm spend bucket the next act may have to
  // open cold. The first run of this script lost an act to exactly that: a gas limit equal
  // to gasUsed, to the wei. Unused gas is refunded, so the pad is free.
  const estimate = await publicClient.estimateContractGas({
    account,
    address: MANDATE,
    abi: mandateAbi,
    functionName: "act",
    args: [action],
  });

  const hash = await wallet.writeContract({
    address: MANDATE,
    abi: mandateAbi,
    functionName: "act",
    args: [action],
    gas: (estimate * 3n) / 2n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({hash, pollingInterval: 100});

  // A refusal does not revert (I2), so a reverted act is never a policy decision - it is the
  // transaction dying, and the act was never recorded at all. Check it before reading events,
  // or an out-of-gas act reads as a mandate that inexplicably emitted nothing.
  if (receipt.status !== "success") {
    console.error(`  act ${i + 1}/${ACTS}  REVERTED  gas ${receipt.gasUsed}/${(estimate * 3n) / 2n}`);
    process.exitCode = 1;
    continue;
  }

  // A refused act still succeeds as a transaction, so the receipt status says nothing about
  // the outcome. That is invariant I2, and it is why this reads the event rather than the
  // status - the same trap the SDK's DeniedError exists to keep callers out of.
  const events = parseEventLogs({
    abi: mandateAbi,
    logs: receipt.logs,
    eventName: ["Allowed", "Denied", "WouldDeny", "Failed"],
  });
  const verdict = events.length === 0 ? "NO EVENT" : events.map((e) => e.eventName).join("+");
  if (events.some((e) => e.eventName === "Allowed")) allowed++;

  console.log(`  act ${i + 1}/${ACTS}  block ${receipt.blockNumber}  gas ${receipt.gasUsed}  ${verdict}`);

  // Either of these means the showcase is not building the record it claims to build, so the
  // scheduled run should go red rather than log a cheerful line and exit 0.
  if (events.length === 0) {
    console.error("  an act emitted nothing - the record was lost");
    process.exitCode = 1;
  } else if (!events.some((e) => e.eventName === "Allowed")) {
    console.error(`  an act was not allowed (${verdict}) - the policy or the counterparty changed`);
    process.exitCode = 1;
  }
}

console.log(`\n${allowed}/${ACTS} acts allowed on chain`);
