/**
 * Act manifests: how a DCS-1 score stays verifiable as the chain grows.
 *
 * A full replay costs one `eth_getLogs` per 100 blocks of chain, because that is the largest
 * range Monad's public RPC will answer (checked against all three public endpoints). The cost
 * therefore scales with how long the mandate has existed, not with how much it did - about
 * 2,810 requests per day of age whether the agent acted three times or not at all. At the
 * measured 16.6 requests a second that is minutes today and roughly fifty of them by mid
 * October, which makes "anyone can recompute this" true in principle and false in practice.
 *
 * A manifest fixes the complexity. The publisher, which has to walk the history anyway, also
 * publishes the list of blocks that carried a log. A verifier fetches only those blocks, which
 * is one request per act rather than one per 100 blocks of chain.
 *
 * The obvious objection is that this trusts the publisher to list every act. It does not, and
 * that is the whole point of the design:
 *
 *   - Every act event carries `id`, which is the mandate's `nonce` after `++`. So the ids
 *     recovered from a manifest must be exactly 1..N with no gaps. A publisher who drops an
 *     act from the middle leaves a hole that is trivially visible.
 *   - Dropping acts from the *end* leaves no hole, so N is checked against `nonce()` read from
 *     the chain at the score's pinned block. Monad's public RPC serves historical state back
 *     to deployment; this was verified before the design was committed to.
 *   - Adding blocks that never held an act costs the verifier one wasted request and changes
 *     nothing, because there are no logs there to find.
 *   - The recomputed `inputHash` is compared against the `feedbackHash` the publisher put on
 *     chain, so a manifest cannot be edited after the fact independently of the entry it
 *     belongs to.
 *
 * **What this does not prove, stated precisely.** `nonce` counts acts. It does not count policy
 * changes, and `Tightened` events feed DCS-1's authority term through the time-weighted cap. A
 * publisher who omits a policy-change block from the manifest *and* computes the published
 * score and `feedbackHash` from the same incomplete set produces a self-consistent lie that
 * these checks pass. Detecting that needs a walk of every block, which is what
 * `DOCKET_FULL_REPLAY=1` does and what the publish workflow runs weekly.
 *
 * That is not a regression: a lying publisher was always only catchable by an independent full
 * replay, and DCS-1 has said since §1 that the spec, not the publisher, is the authority. What
 * the manifest adds is that the cheap path cannot be made to disagree with the expensive one by
 * tampering alone - it can only be wrong if the publisher was wrong about everything
 * consistently, which a second indexer running the full walk will contradict.
 *
 * So: a manifest is a hint about *where to look*, never a claim about *what happened*. Anyone
 * can publish a competing manifest for the same mandate, and it must produce the same score.
 */
import type {Address, Hex, PublicClient} from "viem";

import {mandateAbi} from "../../sdk/src/abi.ts";

export const MANIFEST_VERSION = "docket-manifest-1";

export interface ActManifest {
  version: typeof MANIFEST_VERSION;
  mandate: Address;
  chainId: number;
  /** The mandate's deployment block: where a full replay would have to start. */
  deployBlock: string;
  /** The height this manifest is complete as of. Matches the score's `tag2`. */
  asOfBlock: string;
  /** `nonce` at `asOfBlock`: the number of acts the chain says happened. */
  nonce: string;
  /** Every block carrying a log from this mandate, ascending. */
  blocks: string[];
  /** The `inputHash` the publisher computed, for a fast mismatch check before recomputing. */
  inputHash: Hex;
}

export function buildManifest(input: {
  mandate: Address;
  chainId: number;
  deployBlock: bigint;
  asOfBlock: bigint;
  nonce: bigint;
  actBlocks: readonly bigint[];
  inputHash: Hex;
}): ActManifest {
  return {
    version: MANIFEST_VERSION,
    mandate: input.mandate,
    chainId: input.chainId,
    deployBlock: input.deployBlock.toString(),
    asOfBlock: input.asOfBlock.toString(),
    nonce: input.nonce.toString(),
    blocks: [...input.actBlocks]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((b) => b.toString()),
    inputHash: input.inputHash,
  };
}

export class ManifestError extends Error {}

/**
 * Check a manifest against the chain, then against the acts it led us to.
 *
 * Call this with the ids recovered by replaying the manifest's blocks. It throws rather than
 * returning false: a manifest that does not verify is not a lower-confidence manifest, it is
 * evidence that someone published something wrong, and a caller that can ignore a boolean will.
 */
export async function verifyManifest(
  client: PublicClient,
  manifest: ActManifest,
  recoveredIds: readonly bigint[],
  /** The `inputHash` recomputed from the logs the manifest led to, if the caller has it. */
  recomputedInputHash?: Hex,
  /** The `feedbackHash` from the on-chain entry, which binds the manifest to the score. */
  onChainFeedbackHash?: Hex,
): Promise<void> {
  if (manifest.version !== MANIFEST_VERSION) {
    throw new ManifestError(`unknown manifest version ${manifest.version}`);
  }

  const asOfBlock = BigInt(manifest.asOfBlock);
  const claimed = BigInt(manifest.nonce);

  // The chain's own count, at the height the score is pinned to. This is the number the
  // publisher cannot influence, and it is what makes the rest of the check mean anything.
  const onChain = await client.readContract({
    address: manifest.mandate,
    abi: mandateAbi,
    functionName: "nonce",
    blockNumber: asOfBlock,
  });

  if (BigInt(onChain) !== claimed) {
    throw new ManifestError(
      `manifest claims nonce ${claimed} at block ${asOfBlock}, chain says ${onChain}`,
    );
  }

  // Exactly 1..nonce, each once. A gap means an act was left out of the manifest; a duplicate
  // or an id past the nonce means the replay picked up something that cannot be real.
  const ids = [...recoveredIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (BigInt(ids.length) !== claimed) {
    throw new ManifestError(
      `manifest's blocks yield ${ids.length} acts, chain says ${claimed} happened by block ${asOfBlock}`,
    );
  }
  for (let i = 0; i < ids.length; i++) {
    if (ids[i] !== BigInt(i + 1)) {
      throw new ManifestError(`act ids are not contiguous: expected ${i + 1}, found ${ids[i]}`);
    }
  }

  // Bind the manifest to the entry. Without this a manifest could be edited after publication
  // to point at a different set of logs than the score was computed from - including dropping
  // a Tightened event, which no act count would notice.
  if (recomputedInputHash && recomputedInputHash !== manifest.inputHash) {
    throw new ManifestError(
      `replaying the manifest gives inputHash ${recomputedInputHash}, manifest claims ${manifest.inputHash}`,
    );
  }
  if (onChainFeedbackHash && onChainFeedbackHash !== manifest.inputHash) {
    throw new ManifestError(
      `manifest inputHash ${manifest.inputHash} does not match the on-chain feedbackHash ${onChainFeedbackHash}`,
    );
  }
}
