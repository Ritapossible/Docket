import {useCallback, useEffect, useRef, useState} from "react";
import {createPublicClient, http, isAddress, type Address, type PublicClient} from "viem";

import {score} from "../../../indexer/src/dcs1.ts";
import {replay} from "../../../indexer/src/replay.ts";
import type {ActRecord, ScoreBreakdown} from "../../../indexer/src/types.ts";
import {mandateAbi} from "../../../sdk/src/abi.ts";

/**
 * Blocks the console will walk before giving up on a full history scan.
 *
 * Monad's eth_getLogs cap is 100 blocks per request, so this is 200 requests - a few seconds.
 * Past it the console runs windowed instead. At the measured 307ms block time a mandate is
 * over this threshold after about two hours, which is why the earlier design (re-walk
 * everything, every two seconds) could never have worked against a real chain: a day-old
 * mandate needed 1,407 requests per second and a week-old one 9,850.
 */
const FULL_SYNC_MAX_BLOCKS = 20_000n;

/** Default live window when a full scan is impractical. ~25 minutes at 307ms blocks. */
const DEFAULT_WINDOW_BLOCKS = 5_000n;

export interface MandateView {
  acts: ActRecord[];
  /**
   * Null when the history was windowed. DCS-1 counts every act and denial since deployment,
   * so a score from a partial scan is not a rough score, it is a wrong one. The panel shows
   * the verification command instead.
   */
  score: ScoreBreakdown | null;
  scoredAtBlock: bigint | null;
  inputHash: string | null;
  coversFullHistory: boolean;
  syncedFrom: bigint;
  asOfBlock: bigint;
  balance: bigint;
  paused: boolean;
  mode: number;
  agent: Address;
  owner: Address;
  loosenDelay: bigint;
}

export interface Connection {
  rpc: string;
  mandate: string;
  /** The mandate's deploy block. Required: public RPCs cap log queries by range. */
  fromBlock: bigint;
  /** Force a full scan even when the range is large. */
  forceFullSync?: boolean;
}

type State =
  | {status: "idle"}
  | {status: "loading"; detail: string}
  | {status: "error"; message: string}
  | {status: "ready"; view: MandateView};

interface SyncState {
  cursor: bigint | null;
  acts: ActRecord[];
  score: ScoreBreakdown | null;
  scoredAtBlock: bigint | null;
  inputHash: string | null;
  coversFullHistory: boolean;
  syncedFrom: bigint;
}

/**
 * Polls a mandate, reading only blocks it has not already read.
 *
 * The first pass either walks the whole history (when that is cheap enough) or opens a window
 * at the head. Every pass after that queries `(cursor, head]` and appends. A score is computed
 * once, on a full first pass, and stays pinned to the block it was computed at - which is how
 * DCS-1 defines a score anyway: a value, a spec version, a block height and an inputHash.
 */
export function useMandate(connection: Connection | null, intervalMs = 2000): State {
  const [state, setState] = useState<State>({status: "idle"});
  const sync = useRef<SyncState | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (!connection || inFlight.current) return;
    if (!isAddress(connection.mandate)) {
      setState({status: "error", message: "That is not a valid address."});
      return;
    }

    inFlight.current = true;
    try {
      const client: PublicClient = createPublicClient({
        transport: http(connection.rpc),
        cacheTime: 0,
      });
      const mandate = connection.mandate as Address;
      const head = await client.getBlockNumber({cacheTime: 0});

      let previous = sync.current;

      if (previous === null) {
        const span = head > connection.fromBlock ? head - connection.fromBlock : 0n;
        const full = connection.forceFullSync === true || span <= FULL_SYNC_MAX_BLOCKS;
        const start = full
          ? connection.fromBlock
          : head > DEFAULT_WINDOW_BLOCKS
            ? head - DEFAULT_WINDOW_BLOCKS
            : 0n;

        setState({
          status: "loading",
          detail: full
            ? `Reading ${span} blocks from deployment.`
            : `History is ${span} blocks. Showing the most recent ${DEFAULT_WINDOW_BLOCKS}.`,
        });

        const first = await replay(client, mandate, {
          fromBlock: start,
          asOfBlock: head,
          chunkSize: 100n,
          windowed: !full,
        });

        previous = {
          cursor: head,
          acts: first.acts,
          score: full ? score(first.history) : null,
          scoredAtBlock: full ? first.asOfBlock : null,
          inputHash: full ? first.inputHash : null,
          coversFullHistory: full,
          syncedFrom: start,
        };
      } else if (head > previous.cursor!) {
        // Only the blocks nobody has read yet.
        const next = await replay(client, mandate, {
          fromBlock: previous.cursor! + 1n,
          asOfBlock: head,
          chunkSize: 100n,
          windowed: true,
        });
        previous = {
          ...previous,
          cursor: head,
          acts: [...previous.acts, ...next.acts],
        };
      }

      sync.current = previous;

      const base = {address: mandate, abi: mandateAbi} as const;
      const [balance, paused, agent, owner, loosenDelay, policy] = await Promise.all([
        client.getBalance({address: mandate}),
        client.readContract({...base, functionName: "paused"}),
        client.readContract({...base, functionName: "agent"}),
        client.readContract({...base, functionName: "owner"}),
        client.readContract({...base, functionName: "loosenDelay"}),
        client.readContract({...base, functionName: "policy"}),
      ]);

      setState({
        status: "ready",
        view: {
          acts: previous.acts,
          score: previous.score,
          scoredAtBlock: previous.scoredAtBlock,
          inputHash: previous.inputHash,
          coversFullHistory: previous.coversFullHistory,
          syncedFrom: previous.syncedFrom,
          asOfBlock: head,
          balance,
          paused,
          mode: Number(policy[5]),
          agent,
          owner,
          loosenDelay,
        },
      });
    } catch (error) {
      setState({status: "error", message: error instanceof Error ? error.message : String(error)});
    } finally {
      inFlight.current = false;
    }
  }, [connection]);

  useEffect(() => {
    sync.current = null;
    if (!connection) {
      setState({status: "idle"});
      return;
    }
    setState({status: "loading", detail: "Connecting."});
    void load();
    const timer = setInterval(() => void load(), intervalMs);
    return () => clearInterval(timer);
  }, [connection, load, intervalMs]);

  return state;
}

/** Reads the connection out of the URL so a demo can be handed over as a link. */
export function connectionFromUrl(): Connection | null {
  const params = new URLSearchParams(window.location.search);
  const mandate = params.get("mandate");
  if (!mandate) return null;
  return {
    rpc: params.get("rpc") ?? "http://127.0.0.1:8545",
    mandate,
    fromBlock: BigInt(params.get("from") ?? "0"),
    forceFullSync: params.get("full") === "1",
  };
}
