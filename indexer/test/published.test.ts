/**
 * T13 - "the indexer publishes a false score".
 *
 * The defence Docket claims is that anyone can recompute a published score from the mandate's
 * own event log and catch a publisher who lies. That claim is only worth something if somebody
 * actually does it, against a score that is really on chain, from a cold start with nothing
 * cached. That is what this test is.
 *
 * It reads the DCS-1 entry the publisher posted to the ERC-8004 Reputation Registry, takes the
 * block height out of `tag2`, replays the mandate to exactly that height, and asserts the
 * recomputed score matches the published value. A publisher who posted a flattering number
 * fails here, and so does an indexer that has drifted from the spec.
 *
 * **It replays through the manifest when one is published, and the manifest is not trusted.**
 * A full replay costs one request per 100 blocks of chain and grows without bound; a manifest
 * replay costs one per act. `verifyManifest` proves the manifest complete against the
 * mandate's own `nonce` before any of its blocks are believed, so the cheap path and the
 * expensive path prove the same thing. `--full` forces the expensive one, which is what makes
 * the cheap one checkable rather than merely faster.
 *
 * Needs network: `npm run test:published`. DOCKET_SKIP_NETWORK_TESTS=1 skips it.
 */
import {strict as assert} from "node:assert";
import {test} from "node:test";

import {createPublicClient, http} from "viem";

import {DCS1_TAG, REPUTATION_REGISTRY, reputationRegistryAbi} from "../../sdk/src/erc8004.ts";
import {score as computeScore} from "../src/dcs1.ts";
import {type ActManifest, verifyManifest} from "../src/manifest.ts";
import {replay} from "../src/replay.ts";

const RPC = process.env.MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
const AGENT_ID = BigInt(process.env.AGENT_ID ?? 1930);
const MANDATE = (process.env.MANDATE ?? "0x2EC195646731F274c0e500f3B671C04189446Ae9") as `0x${string}`;
const DEPLOY_BLOCK = BigInt(process.env.DEPLOY_BLOCK ?? 65577709);
const MANIFEST_URL =
  process.env.MANIFEST_URL ??
  "https://raw.githubusercontent.com/Ritapossible/docket/main/console/public/dcs1-manifest.json";

/** Force the full walk. Slow by design: it is the control the cheap path is checked against. */
const FULL = process.argv.includes("--full") || process.env.DOCKET_FULL_REPLAY === "1";
const skip = process.env.DOCKET_SKIP_NETWORK_TESTS === "1";

async function loadManifest(asOfBlock: bigint): Promise<ActManifest | null> {
  if (FULL) return null;
  try {
    const response = await fetch(MANIFEST_URL);
    if (!response.ok) return null;
    const manifest = (await response.json()) as ActManifest;

    // A manifest for a different mandate, or one that stops short of the height being
    // verified, cannot answer this question. Fall back rather than half-trust it.
    if (manifest.mandate?.toLowerCase() !== MANDATE.toLowerCase()) return null;
    if (BigInt(manifest.asOfBlock) < asOfBlock) return null;
    return manifest;
  } catch {
    return null;
  }
}

test("_T13_ a published DCS-1 score recomputes from a cold sync", {skip}, async () => {
  // cacheTime: 0 for the same reason replay() sets it - a cached head can silently score a
  // stale view, and two indexers that disagree by cache timing would defeat the whole point.
  const client = createPublicClient({transport: http(RPC), cacheTime: 0});

  const clients = await client.readContract({
    address: REPUTATION_REGISTRY,
    abi: reputationRegistryAbi,
    functionName: "getClients",
    args: [AGENT_ID],
  });
  assert.ok(clients.length > 0, "no one has published a score for this agent");

  // Check every publisher, not just the one we know about. If a second party has posted a
  // DCS-1 entry and it does not recompute, that is exactly the disagreement this test is for.
  let checked = 0;

  for (const publisher of clients) {
    const lastIndex = await client.readContract({
      address: REPUTATION_REGISTRY,
      abi: reputationRegistryAbi,
      functionName: "getLastIndex",
      args: [AGENT_ID, publisher],
    });

    for (let i = 1n; i <= lastIndex; i++) {
      const [value, decimals, tag1, tag2, revoked] = await client.readContract({
        address: REPUTATION_REGISTRY,
        abi: reputationRegistryAbi,
        functionName: "readFeedback",
        args: [AGENT_ID, publisher, i],
      });

      // Ordinary client reviews live in this same slot and are not DCS-1 claims. Averaging the
      // two together is a category error; so is trying to recompute a review.
      if (tag1 !== DCS1_TAG || revoked) continue;

      assert.equal(decimals, 0, "a DCS-1 score is an integer out of 1000, not fixed point");

      const asOfBlock = BigInt(tag2);
      assert.ok(asOfBlock >= DEPLOY_BLOCK, `tag2 ${tag2} predates the mandate`);

      // feedbackHash lives on the NewFeedback event, not in readFeedback's return. It is what
      // ties a manifest to the entry it claims to explain.
      const events = await client.getContractEvents({
        address: REPUTATION_REGISTRY,
        abi: reputationRegistryAbi,
        eventName: "NewFeedback",
        args: {agentId: AGENT_ID, clientAddress: publisher},
        fromBlock: asOfBlock,
        toBlock: "latest",
      });
      const feedbackHash = events.find((e) => e.args.feedbackIndex === i)?.args.feedbackHash;

      const manifest = await loadManifest(asOfBlock);
      const atBlocks = manifest?.blocks.map((b) => BigInt(b));

      const result = await replay(client, MANDATE, {
        fromBlock: DEPLOY_BLOCK,
        asOfBlock,
        atBlocks,
      });
      assert.ok(result.coversFullHistory, "replay did not cover the full history");

      // Prove the shortcut before relying on what it produced. If the manifest omitted an act
      // the ids have a hole in them, or there are fewer of them than the chain's own nonce.
      if (manifest) {
        await verifyManifest(
          client,
          manifest,
          result.acts.map((a) => a.id),
          result.inputHash,
          feedbackHash,
        );
      }

      const recomputed = computeScore(result.history);
      assert.equal(
        recomputed.score,
        Number(value),
        `published ${value} at block ${tag2} by ${publisher}, recomputed ${recomputed.score}` +
          `${manifest ? " (via manifest; re-run with --full to walk every block)" : ""}`,
      );
      checked++;
    }
  }

  assert.ok(checked > 0, "found no unrevoked DCS-1 entries to verify");
});
