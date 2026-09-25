import {useEffect, useState} from "react";
import {createPublicClient, http, type Address, type PublicClient} from "viem";

import {
  DCS1_TAG,
  REPUTATION_REGISTRY,
  reputationRegistryAbi,
} from "../../../sdk/src/erc8004.ts";

/**
 * The published DCS-1 score, read from the ERC-8004 Reputation Registry.
 *
 * This is the path the console was always meant to have. Computing the score in the browser
 * means walking the mandate's entire history, which grows without bound - a week-old mandate is
 * already tens of thousands of blocks at Monad's 100-block getLogs cap. Reading a published
 * score is three calls regardless of how old the mandate gets, because DCS-1 pins a score to a
 * block height and the registry stores that pin.
 *
 * The local replay does not go away. It is what lets a reader disbelieve this number: the panel
 * shows the recompute command next to the published value, and `npm run test:published` is the
 * same check run in CI.
 */
export interface PublishedScore {
  score: number;
  /** The block the score was pinned to, from the entry's `tag2`. */
  atBlock: bigint;
  /** Who posted it. Never the agent's owner - the registry forbids self-feedback. */
  publisher: Address;
  index: bigint;
}

export interface PublishedState {
  loading: boolean;
  /** Every unrevoked DCS-1 entry, newest height first. More than one publisher is good news. */
  entries: PublishedScore[];
  error: string | null;
}

export async function readPublishedScores(
  client: PublicClient,
  agentId: bigint,
): Promise<PublishedScore[]> {
  const clients = await client.readContract({
    address: REPUTATION_REGISTRY,
    abi: reputationRegistryAbi,
    functionName: "getClients",
    args: [agentId],
  });

  const entries: PublishedScore[] = [];

  for (const publisher of clients) {
    const lastIndex = await client.readContract({
      address: REPUTATION_REGISTRY,
      abi: reputationRegistryAbi,
      functionName: "getLastIndex",
      args: [agentId, publisher],
    });

    for (let i = 1n; i <= lastIndex; i++) {
      const [value, , tag1, tag2, revoked] = await client.readContract({
        address: REPUTATION_REGISTRY,
        abi: reputationRegistryAbi,
        functionName: "readFeedback",
        args: [agentId, publisher, i],
      });

      // Ordinary client reviews share this slot. They are a different kind of claim and
      // averaging them with a DCS-1 score would be a category error, so filter by tag.
      if (tag1 !== DCS1_TAG || revoked) continue;

      entries.push({score: Number(value), atBlock: BigInt(tag2), publisher, index: i});
    }
  }

  entries.sort((a, b) => (b.atBlock > a.atBlock ? 1 : b.atBlock < a.atBlock ? -1 : 0));
  return entries;
}

export function usePublishedScore(rpc: string, agentId: bigint | null): PublishedState {
  const [state, setState] = useState<PublishedState>({loading: true, entries: [], error: null});

  useEffect(() => {
    if (agentId === null) {
      setState({loading: false, entries: [], error: null});
      return;
    }

    let cancelled = false;
    const client = createPublicClient({transport: http(rpc), cacheTime: 0});

    readPublishedScores(client, agentId)
      .then((entries) => {
        if (!cancelled) setState({loading: false, entries, error: null});
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            loading: false,
            entries: [],
            error: e instanceof Error ? e.message : String(e),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [rpc, agentId]);

  return state;
}
