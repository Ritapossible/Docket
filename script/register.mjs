#!/usr/bin/env node
/**
 * Registers the showcase mandate as an ERC-8004 identity, once.
 *
 * Three keys, three jobs, and the split is the point rather than an accident of setup:
 *
 *   owner      owns the identity NFT and the mandate's policy. Not in CI.
 *   agent      calls act() and nothing else. Lives in a GitHub Actions secret.
 *   publisher  posts DCS-1 scores. Owns nothing; anyone could do its job.
 *
 * The registry forces most of this on us and is right to. `giveFeedback` refuses a caller who
 * is the agent's owner or operator - "Self-feedback not allowed" - so the account that owns the
 * identity cannot score it. Docket's claim is that the score is a deterministic function of
 * enforced behaviour that anyone can recompute, so being unable to self-publish costs nothing
 * and proves something.
 *
 * The agent wallet is bound after minting, via setAgentWallet, which needs an EIP-712 signature
 * from the agent itself. So the identity ends up owned by the cold key and pointing at the hot
 * one, which is the same shape as the mandate: the key that acts cannot change what it may do.
 *
 *   DEPLOYER_PRIVATE_KEY=0x… AGENT_PRIVATE_KEY=0x… node script/register.mjs [--execute]
 *
 * Without --execute it simulates everything and writes nothing.
 */
import {createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http, toHex} from "viem";
import {privateKeyToAccount} from "viem/accounts";

import {
  agentWalletSetTypes,
  IDENTITY_REGISTRY,
  identityEip712Domain,
  identityRegistryAbi,
  MONAD_TESTNET_CHAIN_ID,
} from "../sdk/src/erc8004.ts";

const RPC = process.env.MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
const OWNER_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const AGENT_KEY = process.env.AGENT_PRIVATE_KEY;
const EXECUTE = process.argv.includes("--execute");

const MANDATE = process.env.MANDATE ?? "0x2EC195646731F274c0e500f3B671C04189446Ae9";
const DEPLOY_BLOCK = BigInt(process.env.DEPLOY_BLOCK ?? 65577709);
const AGENT_URI =
  process.env.AGENT_URI ??
  "https://raw.githubusercontent.com/Ritapossible/docket/main/console/public/agent-card.json";

if (!OWNER_KEY || !AGENT_KEY) {
  console.error("DEPLOYER_PRIVATE_KEY and AGENT_PRIVATE_KEY are required");
  process.exit(1);
}

const monadTestnet = defineChain({
  id: MONAD_TESTNET_CHAIN_ID,
  name: "Monad Testnet",
  nativeCurrency: {name: "MON", symbol: "MON", decimals: 18},
  rpcUrls: {default: {http: [RPC]}},
});

const owner = privateKeyToAccount(OWNER_KEY);
const agent = privateKeyToAccount(AGENT_KEY);
const publicClient = createPublicClient({chain: monadTestnet, transport: http(RPC), cacheTime: 0});
const wallet = createWalletClient({account: owner, chain: monadTestnet, transport: http(RPC)});

// The addresses in sdk/src/erc8004.ts are chain-specific and a wrong-chain RPC would let every
// call sail through against an unrelated contract, or against nothing at all.
const chainId = await publicClient.getChainId();
if (chainId !== MONAD_TESTNET_CHAIN_ID) {
  console.error(`RPC is chain ${chainId}, expected ${MONAD_TESTNET_CHAIN_ID}`);
  process.exit(1);
}

// A call to an address with no code succeeds and returns empty rather than reverting, so a
// stale registry address is silent. Monad's own docs list two that are dead. Check first.
const code = await publicClient.getCode({address: IDENTITY_REGISTRY});
if (!code || code === "0x") {
  console.error(`no code at ${IDENTITY_REGISTRY} - the registry address is wrong or stale`);
  process.exit(1);
}

const string_ = (s) => toHex(s);
const uint256_ = (n) => encodeAbiParameters([{type: "uint256"}], [n]);

const metadata = [
  {metadataKey: "docket:mandate", metadataValue: encodeAbiParameters([{type: "address"}], [MANDATE])},
  {metadataKey: "docket:chainId", metadataValue: uint256_(BigInt(MONAD_TESTNET_CHAIN_ID))},
  {metadataKey: "docket:specVersion", metadataValue: string_("DCS-1")},
  {metadataKey: "docket:deployBlock", metadataValue: uint256_(DEPLOY_BLOCK)},
];

console.log(`registry  ${IDENTITY_REGISTRY}`);
console.log(`owner     ${owner.address}`);
console.log(`agent     ${agent.address}`);
console.log(`mandate   ${MANDATE}  deployBlock ${DEPLOY_BLOCK}`);
console.log(`agentURI  ${AGENT_URI}`);
for (const m of metadata) console.log(`  ${m.metadataKey.padEnd(20)} ${m.metadataValue}`);

const {result: simulatedId} = await publicClient.simulateContract({
  account: owner,
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  functionName: "register",
  args: [AGENT_URI, metadata],
});
console.log(`\nsimulated agentId ${simulatedId}`);

if (!EXECUTE) {
  console.log("\ndry run - nothing written. Re-run with --execute to register.");
  process.exit(0);
}

const registerHash = await wallet.writeContract({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  functionName: "register",
  args: [AGENT_URI, metadata],
});
const registerReceipt = await publicClient.waitForTransactionReceipt({hash: registerHash, pollingInterval: 100});
if (registerReceipt.status !== "success") {
  console.error(`register reverted: ${registerHash}`);
  process.exit(1);
}

// The id the registry actually assigned, read back rather than assumed - another registration
// can land between the simulation and the send, and then every later call would address
// someone else's agent.
const registered = await publicClient.getContractEvents({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  eventName: "Registered",
  blockHash: registerReceipt.blockHash,
});
const mine = registered.find((e) => e.transactionHash === registerHash);
if (!mine) {
  console.error("register succeeded but emitted no Registered event for this transaction");
  process.exit(1);
}
const agentId = mine.args.agentId;
console.log(`\nregistered agentId ${agentId}  block ${registerReceipt.blockNumber}  tx ${registerHash}`);

// Bind the agent wallet. The registry set it to msg.sender (the owner) at mint; it should point
// at the key that actually acts. Deadline must be within five minutes - MAX_DEADLINE_DELAY.
const deadline = BigInt(Math.floor(Date.now() / 1000) + 240);
const signature = await agent.signTypedData({
  domain: identityEip712Domain(MONAD_TESTNET_CHAIN_ID),
  types: agentWalletSetTypes,
  primaryType: "AgentWalletSet",
  message: {agentId, newWallet: agent.address, owner: owner.address, deadline},
});

const bindHash = await wallet.writeContract({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  functionName: "setAgentWallet",
  args: [agentId, agent.address, deadline, signature],
});
const bindReceipt = await publicClient.waitForTransactionReceipt({hash: bindHash, pollingInterval: 100});
if (bindReceipt.status !== "success") {
  console.error(`setAgentWallet reverted: ${bindHash}`);
  process.exit(1);
}

const boundWallet = await publicClient.readContract({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  functionName: "getAgentWallet",
  args: [agentId],
});
const nftOwner = await publicClient.readContract({
  address: IDENTITY_REGISTRY,
  abi: identityRegistryAbi,
  functionName: "ownerOf",
  args: [agentId],
});

console.log(`bound agentWallet  ${boundWallet}  tx ${bindHash}`);
console.log(`identity owner     ${nftOwner}`);

if (boundWallet.toLowerCase() !== agent.address.toLowerCase()) {
  console.error("agentWallet did not bind to the agent key");
  process.exitCode = 1;
}
if (nftOwner.toLowerCase() !== owner.address.toLowerCase()) {
  console.error("identity is not owned by the owner key");
  process.exitCode = 1;
}

console.log(`\nagentId ${agentId} - record it in deployments/monad-testnet.json`);
