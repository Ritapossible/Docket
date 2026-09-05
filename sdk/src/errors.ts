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
