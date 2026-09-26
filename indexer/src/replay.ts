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
import {
  RULES,
  type ActRecord,
  type CapSegment,
  type Denial,
  type MandateHistory,
  type Rule,
} from "./types.ts";

export interface ReplayResult {
  history: MandateHistory;
  /** Decoded acts, newest last. The score does not use these; the console does. */
  acts: ActRecord[];
  inputHash: Hex;
  logCount: number;
  asOfBlock: bigint;
  /** First block actually scanned. */
  fromBlock: bigint;
  /**
   * True only when the scan started at the mandate's deployment, so the history is complete.
   *
   * DCS-1 counts acts, dates the first one and accumulates every denial, so a windowed scan
   * produces a number that is confidently wrong. Callers must not present a score derived from
   * a replay where this is false - showing no score is better than showing a plausible one.
   */
  coversFullHistory: boolean;
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
  options: {
    fromBlock: bigint;
    asOfBlock?: bigint;
    chunkSize?: bigint;
    /** Set when `fromBlock` is a window start rather than the mandate's deploy block. */
    windowed?: boolean;
    /** Requests a second. Monad's public RPC rejects above 25; the default leaves headroom. */
    requestsPerSecond?: number;
    /** Called every 100 chunks so a long scan does not look like a hang. */
    onProgress?: (chunk: number, total: number, logs: number) => void;
  } = {fromBlock: 0n},
): Promise<ReplayResult> {
  // cacheTime: 0 is load-bearing. viem caches getBlockNumber for its polling interval by
  // default, so a replay run moments after a transaction lands can silently score a stale view
  // of the chain and omit the newest block. That would make two honest indexers publish
  // different scores for the same mandate depending on cache timing - the exact failure DCS-1
  // exists to rule out.
  const asOfBlock = options.asOfBlock ?? (await client.getBlockNumber({cacheTime: 0}));
  const fromBlock = options.fromBlock;

  // Public RPCs cap eth_getLogs by block range - Monad's testnet endpoint allows 100 - so the
  // scan is chunked. This is why a verifier needs the mandate's deployment block: scanning
  // from genesis at 100 blocks a request is not a thing anyone will do, which would make
  // "anyone can recompute this" false in practice. The block is published as ERC-8004
  // metadata for exactly that reason (spec/ERC8004.md).
  const chunkSize = options.chunkSize ?? 100n;

  // Monad's public RPC allows 25 requests a second and rejects the rest outright. A scan of a
  // mandate's whole history is thousands of requests, so an unpaced loop does not slow down -
  // it fails, several hundred requests in, with the score half computed. Verified against all
  // three public endpoints: the 100-block cap is real on each of them and none accepts 1,000.
  const requestsPerSecond = options.requestsPerSecond ?? 20;
  const minIntervalMs = 1000 / requestsPerSecond;
  let nextSlot = 0;

  const paced = async <T>(fn: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const wait = Math.max(0, nextSlot - now);
    nextSlot = Math.max(now, nextSlot) + minIntervalMs;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    // Back off and retry rather than abandoning a scan that is most of the way done. A public
    // endpoint can rate-limit for reasons that have nothing to do with us.
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        const rateLimited = /limited|429|too many/i.test(message);
        if (!rateLimited || attempt >= 5) throw e;
        await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
      }
    }
  };

  const totalChunks = Number((asOfBlock - fromBlock) / chunkSize) + 1;
  const logs = [];
  let done = 0;
  for (let start = fromBlock; start <= asOfBlock; start += chunkSize) {
    let end = start + chunkSize - 1n;
    if (end > asOfBlock) end = asOfBlock;
    const chunk = await paced(() => client.getLogs({address: mandate, fromBlock: start, toBlock: end}));
    logs.push(...chunk);

    // A scan of an aged mandate takes minutes. Silence for minutes reads as a hang, and a judge
    // who kills it has not verified anything.
    done++;
    if (options.onProgress && (done % 100 === 0 || start + chunkSize > asOfBlock)) {
      options.onProgress(done, totalChunks, logs.length);
    }
  }

  // One getBlock per distinct block, not per log.
  const blockNumbers = [...new Set(logs.map((l) => l.blockNumber!))];
  const timestamps = new Map<bigint, bigint>();
  for (const blockNumber of blockNumbers) {
    const block = await paced(() => client.getBlock({blockNumber}));
    timestamps.set(blockNumber, block.timestamp);
  }
  const asOfTime = (await paced(() => client.getBlock({blockNumber: asOfBlock}))).timestamp;

  let allowedActs = 0n;
  let firstActTime: bigint | null = null;
  const denials: Denial[] = [];
  const acts: ActRecord[] = [];

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
        acts.push(toActRecord("Allowed", decoded.args, log, at));
        break;
      }
      case "Denied": {
        const args = decoded.args as unknown as {rule: number};
        const rule = toRule(args.rule);
        denials.push({rule, timestamp: at});
        if (firstActTime === null) firstActTime = at;
        acts.push({...toActRecord("Denied", decoded.args, log, at), rule});
        break;
      }
      case "WouldDeny": {
        const args = decoded.args as unknown as {rule: number};
        acts.push({
          ...toActRecord("WouldDeny", decoded.args, log, at),
          rule: toRule(args.rule),
        });
        break;
      }
      case "Failed": {
        acts.push(toActRecord("Failed", decoded.args, log, at));
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
    acts,
    fromBlock,
    coversFullHistory: options.windowed !== true,
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

function toActRecord(
  kind: ActRecord["kind"],
  args: unknown,
  log: {blockNumber: bigint | null; transactionHash: Hex | null},
  timestamp: bigint,
): ActRecord {
  const a = args as {id?: bigint; target?: string; selector?: string; value?: bigint};
  return {
    kind,
    id: a.id ?? 0n,
    blockNumber: log.blockNumber ?? 0n,
    timestamp,
    txHash: log.transactionHash ?? "0x",
    target: a.target ?? "0x",
    selector: a.selector ?? "0x00000000",
    value: a.value ?? 0n,
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
