#!/usr/bin/env node
/**
 * Publishes a DCS-1 score to the ERC-8004 Reputation Registry.
 *
 * The registry's feedback slot is built for client reviews: a counterparty posts a number and a
 * tag. Reviews are subjective, solicitable, and worth roughly what reviews are ever worth. A
 * DCS-1 entry is a different kind of claim in the same slot - a deterministic function of what
 * a contract actually enforced, recomputable by anyone from the mandate's own event log.
 *
 * `feedbackHash` is what makes that checkable rather than merely stated. It commits to the exact
 * set of logs the score was computed from, so a reader can re-derive the number instead of
 * trusting whoever posted it. `tag2` carries the block height, because a DCS-1 score without a
 * height is meaningless - the mandate keeps acting, and the score moves.
 *
 * The publisher owns nothing. The registry will not accept feedback from the identity's owner
 * or operators, and Docket does not want it to: a score you can post about yourself is a claim,
 * not a measurement. Anyone may post a competing entry for the same mandate, and if two honest
 * indexers disagree, one of them has a bug and the inputHash says which logs to look at.
 *
 *   PUBLISHER_PRIVATE_KEY=0x… node script/publish.mjs [--execute]
 */
import {createPublicClient, createWalletClient, defineChain, http} from "viem";
import {privateKeyToAccount} from "viem/accounts";

import {score as computeScore, SPEC_VERSION} from "../indexer/src/dcs1.ts";
import {replay} from "../indexer/src/replay.ts";
import {
  DCS1_TAG,
  MONAD_TESTNET_CHAIN_ID,
  REPUTATION_REGISTRY,
  reputationRegistryAbi,
} from "../sdk/src/erc8004.ts";

const RPC = process.env.MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
const KEY = process.env.PUBLISHER_PRIVATE_KEY;
const EXECUTE = process.argv.includes("--execute");

const AGENT_ID = BigInt(process.env.AGENT_ID ?? 1930);
const MANDATE = process.env.MANDATE ?? "0x2EC195646731F274c0e500f3B671C04189446Ae9";
const DEPLOY_BLOCK = BigInt(process.env.DEPLOY_BLOCK ?? 65577709);
const FEEDBACK_URI =
  process.env.FEEDBACK_URI ??
  "https://raw.githubusercontent.com/Ritapossible/docket/main/spec/DCS-1.md";

if (!KEY) {
  console.error("PUBLISHER_PRIVATE_KEY is required");
  process.exit(1);
}

const monadTestnet = defineChain({
  id: MONAD_TESTNET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: {name: "MON", symbol: "MON", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});

const publisher = privateKeyToAccount(KEY);
const publicClient = createPublicClient({chain: monadTestnet, transport: http(RPC), cacheTime: 0});
const wallet = createWalletClient({account: publisher, chain: monadTestnet, transport: http(RPC)});

const chainId = await publicClient.getChainId();
if (chainId !== MONAD_TESTNET_CHAIN_ID) {
  console.error(`RPC is chain ${chainId}, expected ${MONAD_TESTNET_CHAIN_ID}`);
  process.exit(1);
}

// An address with no code accepts any call and returns empty, so a stale registry address
// publishes into the void without ever reverting. Monad's docs list two that do exactly that.
const code = await publicClient.getCode({address: REPUTATION_REGISTRY});
if (!code || code === "0x") {
  console.error(`no code at ${REPUTATION_REGISTRY} - the registry address is wrong or stale`);
  process.exit(1);
}

const result = await replay(publicClient, MANDATE, {fromBlock: DEPLOY_BLOCK});

// A windowed replay sees part of the history and would produce a confident wrong number. DCS-1
// says withhold rather than guess, and a published wrong score is worse than no score at all.
if (!result.coversFullHistory) {
  console.error("replay does not cover the full history - refusing to publish a partial score");
  process.exit(1);
}

const breakdown = computeScore(result.history);

console.log(`registry   ${REPUTATION_REGISTRY}`);
console.log(`publisher  ${publisher.address}`);
console.log(`agentId    ${AGENT_ID}   mandate ${MANDATE}`);
console.log(`spec       ${SPEC_VERSION}`);
console.log(`as of      block ${result.asOfBlock}   ${result.logCount} logs`);
console.log(`inputHash  ${result.inputHash}`);
console.log(
  `terms      E ${breakdown.experiencePpm}  A ${breakdown.agePpm}  ` +
    `U ${breakdown.authorityPpm}  B ${breakdown.breachPpm}`,
);
console.log(`SCORE      ${breakdown.score} / 1000`);

const args = [
  AGENT_ID,
  BigInt(breakdown.score), // int128, 0-1000
  0, // valueDecimals: the score is an integer out of 1000, not a fixed-point fraction
  DCS1_TAG,
  result.asOfBlock.toString(), // tag2: the height this score is pinned to
  MANDATE, // endpoint: what was scored
  FEEDBACK_URI,
  result.inputHash,
];

await publicClient.simulateContract({
  account: publisher,
  address: REPUTATION_REGISTRY,
  abi: reputationRegistryAbi,
  functionName: "giveFeedback",
  args,
});
console.log("\nsimulation ok");

if (!EXECUTE) {
  console.log("dry run - nothing written. Re-run with --execute to publish.");
  process.exit(0);
}

const estimate = await publicClient.estimateContractGas({
  account: publisher,
  address: REPUTATION_REGISTRY,
  abi: reputationRegistryAbi,
  functionName: "giveFeedback",
  args,
});
const hash = await wallet.writeContract({
  address: REPUTATION_REGISTRY,
  abi: reputationRegistryAbi,
  functionName: "giveFeedback",
  args,
  gas: (estimate * 3n) / 2n,
});
const receipt = await publicClient.waitForTransactionReceipt({hash, pollingInterval: 100});
if (receipt.status !== "success") {
  console.error(`giveFeedback reverted: ${hash}`);
  process.exit(1);
}

// Read it back through the public path a consumer would use, not through the receipt. This is
// the check that would have caught publishing to a dead address.
const index = await publicClient.readContract({
  address: REPUTATION_REGISTRY,
  abi: reputationRegistryAbi,
  functionName: "getLastIndex",
  args: [AGENT_ID, publisher.address],
});
const [value, decimals, tag1, tag2, revoked] = await publicClient.readContract({
  address: REPUTATION_REGISTRY,
  abi: reputationRegistryAbi,
  functionName: "readFeedback",
  args: [AGENT_ID, publisher.address, index],
});

console.log(`\npublished  block ${receipt.blockNumber}  tx ${hash}`);
console.log(`read back  index ${index}  value ${value} (${decimals} dp)  ${tag1} @ ${tag2}  revoked=${revoked}`);

if (Number(value) !== breakdown.score || tag2 !== result.asOfBlock.toString()) {
  console.error("read-back does not match what was published");
  process.exitCode = 1;
}
