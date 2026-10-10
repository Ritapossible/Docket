import {useCallback, useEffect, useRef, useState} from "react";
import {createPublicClient, http, isAddress, type Address, type PublicClient} from "viem";

import {score} from "../../../indexer/src/dcs1.ts";
import {type ActManifest, verifyManifest} from "../../../indexer/src/manifest.ts";
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

/**
 * The act manifest this console publishes next to itself.
 *
 * It lists every block of the showcase mandate's history that carried a log, so the console can
 * fetch those blocks directly instead of walking the chain. That is the same O(acts) shortcut
 * the indexer uses, and the console needs it for the same reason: a windowed scan shows the
 * last 25 minutes, the agent acts every eight hours, so the stream was empty almost always -
 * a page arguing that every refusal is a permanent public record, displaying none of them.
 *
 * It is never trusted on its word. `verifyManifest` proves the block list complete against the
 * mandate's own `nonce` before a single act from it reaches the screen, and anything that does
 * not verify falls back to the window rather than being shown.
 */
async function loadManifest(mandate: Address): Promise<ActManifest | null> {
  try {
    const response = await fetch(new URL("dcs1-manifest.json", document.baseURI), {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const manifest = (await response.json()) as ActManifest;
    if (manifest.mandate?.toLowerCase() !== mandate.toLowerCase()) return null;
    if (!Array.isArray(manifest.blocks) || manifest.blocks.length === 0) return null;
    return manifest;
  } catch {
    return null;
  }
}

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
  /**
   * The chain's own act count, read from `nonce()`. Authoritative where `acts.length` is not:
   * the stream holds what this browser managed to fetch, and this is how many there really are.
   */
  nonce: bigint;
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
            : `History is ${span} blocks. Reading the published act manifest.`,
        });

        // The cheap complete path, when a verifiable manifest covers this mandate.
        const manifest = full ? null : await loadManifest(mandate);
        let seeded: SyncState | null = null;

        if (manifest) {
          try {
            const manifestAsOf = BigInt(manifest.asOfBlock);
            const walked = await replay(client, mandate, {
              fromBlock: connection.fromBlock,
              asOfBlock: manifestAsOf,
              chunkSize: 100n,
              atBlocks: manifest.blocks.map((b) => BigInt(b)),
            });

            // Before anything from it is shown. A manifest that does not verify is not a
            // lower-confidence manifest, it is evidence someone published something wrong.
            await verifyManifest(
              client,
              manifest,
              manifestAsOf,
              walked.acts.map((a) => a.id),
              walked.inputHash,
            );

            // Then the head, for acts newer than the manifest. Bounded: the manifest is
            // republished daily so the gap is hours, but a stale one must not silently turn
            // into a thousand-request walk on page load.
            const windowFrom = head > DEFAULT_WINDOW_BLOCKS ? head - DEFAULT_WINDOW_BLOCKS : 0n;
            const tailFrom = manifestAsOf + 1n > windowFrom ? manifestAsOf + 1n : windowFrom;
            const tail =
              tailFrom <= head
                ? await replay(client, mandate, {
                    fromBlock: tailFrom,
                    asOfBlock: head,
                    chunkSize: 100n,
                    windowed: true,
                  })
                : null;

            seeded = {
              cursor: head,
              acts: [...walked.acts, ...(tail?.acts ?? [])],
              // Complete at the manifest's height, which is what a DCS-1 score needs: a value,
              // a spec version, a block height and an inputHash. Not complete at `head`, and
              // the panel pins the number to `scoredAtBlock` rather than to now.
              score: score(walked.history),
              scoredAtBlock: manifestAsOf,
              inputHash: walked.inputHash,
              coversFullHistory: true,
              syncedFrom: connection.fromBlock,
            };
          } catch {
            // Fall through to the window. Showing the last 25 minutes is a worse page than
            // showing the whole history; showing a history that failed its proof is worse
            // than either.
            seeded = null;
          }
        }

        if (seeded === null) {
          const first = await replay(client, mandate, {
            fromBlock: start,
            asOfBlock: head,
            chunkSize: 100n,
            windowed: !full,
          });

          seeded = {
            cursor: head,
            acts: first.acts,
            score: full ? score(first.history) : null,
            scoredAtBlock: full ? first.asOfBlock : null,
            inputHash: full ? first.inputHash : null,
            coversFullHistory: full,
            syncedFrom: start,
          };
        }

        previous = seeded;
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
      const [balance, paused, agent, owner, loosenDelay, policy, nonce] = await Promise.all([
        client.getBalance({address: mandate}),
        client.readContract({...base, functionName: "paused"}),
        client.readContract({...base, functionName: "agent"}),
        client.readContract({...base, functionName: "owner"}),
        client.readContract({...base, functionName: "loosenDelay"}),
        client.readContract({...base, functionName: "policy"}),
        client.readContract({...base, functionName: "nonce"}),
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
          nonce,
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
/**
 * The deployed showcase mandate on Monad testnet.
 *
 * Exported so the console has one source of truth for it. The Overview page used to carry its
 * own copy, which is the sort of duplication that is correct until the day it is not.
 */
export const SHOWCASE = {
  mandate: "0x2EC195646731F274c0e500f3B671C04189446Ae9",
  rpc: "https://testnet-rpc.monad.xyz",
  deployBlock: 65577709n,
  /** ERC-8004 identity. Its DCS-1 scores are read from the Reputation Registry. */
  agentId: 1930n,
  explorer: "https://testnet.monadexplorer.com/address/0x2EC195646731F274c0e500f3B671C04189446Ae9",
} as const;

/**
 * What the console should connect to on load.
 *
 * **Defaults to the live showcase mandate**, which it did not until 10 October. Before that a
 * bare URL returned null, so the page opened on an empty form with an RPC field reading
 * `http://127.0.0.1:8545`. Every query-string link we published worked, which is exactly why
 * nobody noticed: the one visitor who matters, someone opening the plain link with no idea
 * what to paste into it, saw a localhost form and no score.
 *
 * `?connect=none` restores the empty form. The route checks use it, because a live connection
 * polls every two seconds and a page that never goes network-idle cannot be waited on.
 */
export function connectionFromUrl(): Connection | null {
  const params = new URLSearchParams(window.location.search);
  if (params.get("connect") === "none") return null;

  const mandate = params.get("mandate");
  if (!mandate) {
    return {
      rpc: SHOWCASE.rpc,
      mandate: SHOWCASE.mandate,
      fromBlock: SHOWCASE.deployBlock,
      forceFullSync: params.get("full") === "1",
    };
  }

  return {
    rpc: params.get("rpc") ?? "http://127.0.0.1:8545",
    mandate,
    fromBlock: BigInt(params.get("from") ?? "0"),
    forceFullSync: params.get("full") === "1",
  };
}
