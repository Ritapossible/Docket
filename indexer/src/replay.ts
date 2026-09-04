import {
  decodeAbiParameters,
  decodeEventLog,
  decodeFunctionData,
  toHex,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";

import {mandateAbi} from "./abi.ts";
import {inputHash, type HashableLog} from "./inputHash.ts";
import {RULES, type CapSegment, type Denial, type MandateHistory, type Rule} from "./types.ts";

export interface ReplayResult {
  history: MandateHistory;
  inputHash: Hex;
  logCount: number;
  asOfBlock: bigint;
}

const ASSET_POLICY_ABI = [
  {
    type: "tuple",
    components: [
      {name: "tracked", type: "bool"},
      {name: "perActionCap", type: "uint128"},
      {name: "windowCap", type: "uint128"},
      {name: "windowDuration", type: "uint32"},
      {name: "windowBuckets", type: "uint16"},
    ],
  },
] as const;

/**
 * Rebuild a mandate's DCS-1 inputs from chain events alone.
 *
 * This function holds no privileged data. Everything it knows it learned from a public log,
 * which is what makes invariant I5 true rather than aspirational: anyone can run it and get
 * the same answer.
 */
export async function replay(
  client: PublicClient,
  mandate: Address,
  options: {fromBlock: bigint; asOfBlock?: bigint; chunkSize?: bigint} = {fromBlock: 0n},
): Promise<ReplayResult> {
  // cacheTime: 0 is load-bearing. viem caches getBlockNumber for its polling interval by
  // default, so a replay run moments after a transaction lands can silently score a stale view
  // of the chain and omit the newest block. That would make two honest indexers publish
  // different scores for the same mandate depending on cache timing — the exact failure DCS-1
  // exists to rule out.
  const asOfBlock = options.asOfBlock ?? (await client.getBlockNumber({cacheTime: 0}));
  const fromBlock = options.fromBlock;

  // Public RPCs cap eth_getLogs by block range — Monad's testnet endpoint allows 100 — so the
  // scan is chunked. This is why a verifier needs the mandate's deployment block: scanning
  // from genesis at 100 blocks a request is not a thing anyone will do, which would make
  // "anyone can recompute this" false in practice. The block is published as ERC-8004
  // metadata for exactly that reason (spec/ERC8004.md).
  const chunkSize = options.chunkSize ?? 100n;
  const logs = [];
  for (let start = fromBlock; start <= asOfBlock; start += chunkSize) {
    let end = start + chunkSize - 1n;
    if (end > asOfBlock) end = asOfBlock;
    const chunk = await client.getLogs({address: mandate, fromBlock: start, toBlock: end});
    logs.push(...chunk);
  }

  // One getBlock per distinct block, not per log.
  const blockNumbers = [...new Set(logs.map((l) => l.blockNumber!))];
  const timestamps = new Map<bigint, bigint>();
  for (const blockNumber of blockNumbers) {
    const block = await client.getBlock({blockNumber});
    timestamps.set(blockNumber, block.timestamp);
  }
  const asOfTime = (await client.getBlock({blockNumber: asOfBlock})).timestamp;

  let allowedActs = 0n;
  let firstActTime: bigint | null = null;
  const denials: Denial[] = [];

  // (timestamp, cap) change points; the mandate starts with no native cap at all.
  const capChanges: Array<{at: bigint; cap: bigint}> = [];
  let deployedAt: bigint | null = null;

  for (const log of logs) {
    const at = timestamps.get(log.blockNumber!)!;

    let decoded;
    try {
      decoded = decodeEventLog({abi: mandateAbi, data: log.data, topics: log.topics});
    } catch {
      continue; // an event from a newer contract than this indexer knows about
    }

    switch (decoded.eventName) {
      case "MandateDeployed": {
        deployedAt = at;
        capChanges.push({at, cap: 0n});
        break;
      }
      case "Allowed": {
        allowedActs += 1n;
        if (firstActTime === null) firstActTime = at;
        break;
      }
      case "Denied": {
        const args = decoded.args as unknown as {rule: number};
        denials.push({rule: toRule(args.rule), timestamp: at});
        if (firstActTime === null) firstActTime = at;
        break;
      }
      case "Tightened": {
        const args = decoded.args as unknown as {what: Hex; payload: Hex};
        if (args.what !== toHex("asset")) break;
        const cap = nativeWindowCapFromTightened(args.payload);
        if (cap !== null) capChanges.push({at, cap});
        break;
      }
      case "LoosenExecuted": {
        const args = decoded.args as unknown as {payload: Hex};
        const cap = nativeWindowCapFromCall(args.payload);
        if (cap !== null) capChanges.push({at, cap});
        break;
      }
      default:
        break;
    }
  }

  return {
    history: {
      allowedActs,
      firstActTime,
      asOfTime,
      denials,
      capSegments: toSegments(capChanges, deployedAt, asOfTime),
    },
    inputHash: inputHash(logs as unknown as HashableLog[]),
    logCount: logs.length,
    asOfBlock,
  };
}

function toRule(index: number | bigint): Rule {
  // An unrecognised rule from a newer contract is scored as a soft breach rather than dropped:
  // ignoring a refusal we do not understand would flatter the mandate, and flattering it is the
  // one direction a conduct score must never fail in.
  return RULES[Number(index)] ?? "RateCap";
}

function nativeWindowCapFromTightened(payload: Hex): bigint | null {
  try {
    const [asset, policy] = decodeAbiParameters(
      [{type: "address"}, ...ASSET_POLICY_ABI],
      payload,
    ) as unknown as [Address, {windowCap: bigint}];
    if (asset.toLowerCase() !== zeroAddress) return null;
    return policy.windowCap;
  } catch {
    return null;
  }
}

function nativeWindowCapFromCall(payload: Hex): bigint | null {
  try {
    const decoded = decodeFunctionData({abi: mandateAbi, data: payload});
    if (decoded.functionName !== "loosenAsset") return null;
    const [asset, policy] = decoded.args as unknown as [Address, {windowCap: bigint}];
    if (asset.toLowerCase() !== zeroAddress) return null;
    return policy.windowCap;
  } catch {
    return null;
  }
}

function toSegments(
  changes: Array<{at: bigint; cap: bigint}>,
  deployedAt: bigint | null,
  asOfTime: bigint,
): CapSegment[] {
  if (changes.length === 0) return [];
  const sorted = [...changes].sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1));
  if (deployedAt !== null && sorted[0]!.at > deployedAt) {
    sorted.unshift({at: deployedAt, cap: 0n});
  }

  const segments: CapSegment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!.at;
    const end = i + 1 < sorted.length ? sorted[i + 1]!.at : asOfTime;
    if (end > start) segments.push({cap: sorted[i]!.cap, durationSeconds: end - start});
  }
  return segments;
}
