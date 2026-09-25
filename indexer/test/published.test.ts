/**
 * T13 - "the indexer publishes a false score".
 *
 * The defence Docket claims is that anyone can recompute a published score from the mandate's
 * own event log and catch a publisher who lies. That claim is only worth something if somebody
 * actually does it, against a score that is really on chain, from a cold start with nothing
 * cached. That is what this test is.
 *
 * It reads the DCS-1 entry the publisher posted to the ERC-8004 Reputation Registry, takes the
 * block height out of `tag2`, replays the mandate from its deploy block to exactly that height,
 * and asserts the recomputed score matches the published value. A publisher who posted a
 * flattering number fails here, and so does an indexer that has drifted from the spec.
 *
 * It needs network, so it is not in the default unit run - `npm run test:published`. Set
 * DOCKET_SKIP_NETWORK_TESTS=1 to skip it where there is no route to Monad.
 */
import {strict as assert} from "node:assert";
import {test} from "node:test";

import {createPublicClient, http} from "viem";

import {REPUTATION_REGISTRY, reputationRegistryAbi, DCS1_TAG} from "../../sdk/src/erc8004.ts";
import {score as computeScore} from "../src/dcs1.ts";
import {replay} from "../src/replay.ts";

const RPC = process.env.MONAD_TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
const AGENT_ID = BigInt(process.env.AGENT_ID ?? 1930);
const MANDATE = (process.env.MANDATE ?? "0x2EC195646731F274c0e500f3B671C04189446Ae9") as `0x${string}`;
const DEPLOY_BLOCK = BigInt(process.env.DEPLOY_BLOCK ?? 65577709);

const skip = process.env.DOCKET_SKIP_NETWORK_TESTS === "1";

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

      const result = await replay(client, MANDATE, {fromBlock: DEPLOY_BLOCK, asOfBlock});
      assert.ok(result.coversFullHistory, "cold replay did not cover the full history");

      const recomputed = computeScore(result.history);
      assert.equal(
        recomputed.score,
        Number(value),
        `published ${value} at block ${tag2} by ${publisher}, recomputed ${recomputed.score}`,
      );
      checked++;
    }
  }

  assert.ok(checked > 0, "found no unrevoked DCS-1 entries to verify");
});
