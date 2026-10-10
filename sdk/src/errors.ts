import type {Address, Hex} from "viem";

/**
 * The rules a Mandate can refuse an act with. Mirrors `Rule` in
 * `contracts/src/libraries/Types.sol` - the ordering is part of the on-chain event surface,
 * so entries may be appended but never reordered.
 */
export const RULES = [
  "None",
  "Paused",
  "Expired",
  "DeadlinePassed",
  "TargetNotAllowed",
  "SelectorNotAllowed",
  "SelectorForbidden",
  "AssetNotTracked",
  "PerActionCap",
  "SpendWindowCap",
  "RateCap",
  "DeclarationUnsorted",
] as const;

export type Rule = (typeof RULES)[number];

/**
 * Map an on-chain rule index to its name.
 *
 * Returns `"Unknown"` rather than throwing when the index is out of range. That happens when
 * the mandate is a newer version than this SDK: `Rule` may gain entries (appending is safe;
 * reordering is a breaking change), and an SDK that crashed on an unrecognised refusal would
 * turn a correctly-enforced policy into an outage.
 */
export function toRule(index: number | bigint): Rule | "Unknown" {
  return RULES[Number(index)] ?? "Unknown";
}

/**
 * Breach classes used by DCS-1. A hard breach is an attempt to exceed the mandate's authority;
 * a soft breach is an attempt that was merely mistimed. The scoring spec weights them very
 * differently, so the split lives here next to the rules it partitions.
 */
export const HARD_RULES: ReadonlySet<Rule> = new Set<Rule>([
  "TargetNotAllowed",
  "SelectorNotAllowed",
  "SelectorForbidden",
  "AssetNotTracked",
  "PerActionCap",
  "SpendWindowCap",
]);

/**
 * Thrown when the mandate refused an act.
 *
 * This exists because of invariant I2: a policy violation does not revert, it emits `Denied`
 * and returns `false`. The transaction therefore SUCCEEDS, and any integrator who reads only
 * the receipt status will believe the action executed. The SDK turns that false return into a
 * thrown error so the normal control flow of a caller is correct by default.
 *
 * If you are not using this SDK, check the return value. Do not trust the receipt.
 */
export class DeniedError extends Error {
  readonly rule: Rule | "Unknown";
  readonly target: Address;
  readonly selector: Hex;
  readonly txHash: Hex;

  constructor(args: {rule: Rule | "Unknown"; target: Address; selector: Hex; txHash: Hex}) {
    super(
      `Mandate refused this action: ${args.rule} (target ${args.target}, selector ${args.selector}). ` +
        `The transaction succeeded and no funds moved; the refusal is recorded on chain in tx ${args.txHash}.`,
    );
    this.name = "DeniedError";
    this.rule = args.rule;
    this.target = args.target;
    this.selector = args.selector;
    this.txHash = args.txHash;
  }

  /** True if this refusal is a hard breach under DCS-1 and will weigh on the mandate's score. */
  get isHardBreach(): boolean {
    return this.rule !== "Unknown" && HARD_RULES.has(this.rule);
  }
}

/** Thrown when the policy passed but the target call itself reverted. */
export class TargetFailedError extends Error {
  readonly target: Address;
  readonly txHash: Hex;

  constructor(args: {target: Address; txHash: Hex; returnData: Hex}) {
    super(
      `The mandate allowed this action but the target reverted (target ${args.target}, tx ${args.txHash}). ` +
        `This is not a policy refusal and does not affect the mandate's score.`,
    );
    this.name = "TargetFailedError";
    this.target = args.target;
    this.txHash = args.txHash;
  }
}

/**
 * Thrown when the `act` transaction itself reverted, so nothing was recorded.
 *
 * This is the counterpart to `DeniedError` and the two must not be confused. A refusal does
 * NOT revert (invariant I2), so a revert is never a policy decision - it means the
 * transaction died before the mandate could decide anything, most often by running out of
 * gas. No `Denied` event exists, the nonce did not advance, and the attempt left no trace.
 *
 * It has its own class because the correct response differs: a `DeniedError` means stop and
 * reconsider the action, while this means retry it.
 */
export class ActRevertedError extends Error {
  readonly txHash: Hex;

  constructor(args: {txHash: Hex}) {
    super(
      `The act transaction reverted, so nothing was recorded (tx ${args.txHash}). ` +
        `A policy refusal does not revert, so this is not a refusal - the transaction failed ` +
        `before the mandate decided anything, usually out of gas. Nothing was spent and the ` +
        `attempt is not on the record. Retrying is safe.`,
    );
    this.name = "ActRevertedError";
    this.txHash = args.txHash;
  }
}

/**
 * Thrown when the transaction succeeded but the mandate emitted no act event at all.
 *
 * Every `act` emits exactly one of `Allowed`, `Denied`, `WouldDeny` or `Failed`, so this
 * should be unreachable. It exists because the alternative - returning success - would mean
 * reporting that an action happened when there is no evidence it did, and in a project whose
 * entire claim is that the record is the truth, silently inventing one is the worst available
 * failure mode.
 */
export class NoRecordError extends Error {
  readonly txHash: Hex;

  constructor(args: {txHash: Hex}) {
    super(
      `The act transaction succeeded but the mandate emitted no event (tx ${args.txHash}). ` +
        `Treat the outcome as unknown and read the mandate's state directly; do not assume ` +
        `the action executed.`,
    );
    this.name = "NoRecordError";
    this.txHash = args.txHash;
  }
}
