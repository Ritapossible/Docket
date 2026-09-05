import {useCallback, useEffect, useRef, useState} from "react";
import {createPublicClient, http, isAddress, type Address, type PublicClient} from "viem";

import {score} from "../../../indexer/src/dcs1.ts";
import {replay} from "../../../indexer/src/replay.ts";
import type {ActRecord, ScoreBreakdown} from "../../../indexer/src/types.ts";
import {mandateAbi} from "../../../sdk/src/abi.ts";

export interface MandateView {
  acts: ActRecord[];
  score: ScoreBreakdown;
  inputHash: string;
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
  fromBlock: bigint;
}

type State =
  | {status: "idle"}
  | {status: "loading"}
  | {status: "error"; message: string}
  | {status: "ready"; view: MandateView};

/**
 * Polls the chain for a mandate's state.
 *
 * cacheTime: 0 is deliberate and load-bearing — see spec/DCS-1.md §7. viem caches the head
 * block number for its polling interval, and a console that scored a stale view would show a
 * refusal on screen while reporting a score that predates it.
 */
export function useMandate(connection: Connection | null, intervalMs = 2000): State {
  const [state, setState] = useState<State>({status: "idle"});
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

      const result = await replay(client, mandate, {
        fromBlock: connection.fromBlock,
        chunkSize: 100n,
      });

      // Literal function names rather than a generic helper: viem derives the return type
      // from the ABI, and erasing that with a cast would let a renamed getter compile.
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
          acts: result.acts,
          score: score(result.history),
          inputHash: result.inputHash,
          asOfBlock: result.asOfBlock,
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
    if (!connection) {
      setState({status: "idle"});
      return;
    }
    setState({status: "loading"});
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
  };
}
