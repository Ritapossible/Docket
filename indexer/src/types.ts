/** Rule names, in the on-chain enum order. Mirrors `Rule` in Types.sol. */
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

/** DCS-1 §4.4. A hard breach is an attempt to exceed authority; a soft one was mistimed. */
export const HARD_RULES: ReadonlySet<Rule> = new Set<Rule>([
  "TargetNotAllowed",
  "SelectorNotAllowed",
  "SelectorForbidden",
  "AssetNotTracked",
  "PerActionCap",
  "SpendWindowCap",
]);

export interface Denial {
  rule: Rule;
  /** Unix seconds of the block carrying the Denied event. */
  timestamp: bigint;
}

/** One period during which the native windowCap held a constant value. */
export interface CapSegment {
  cap: bigint;
  durationSeconds: bigint;
}

/**
 * Everything DCS-1 consumes, and nothing else.
 *
 * Deliberately a plain data structure with no chain access: the scorer is a pure function so
 * it can be tested against hand-computed vectors and re-run by anyone. `replay.ts` is the only
 * thing that talks to a node.
 */
export interface MandateHistory {
  allowedActs: bigint;
  /** Timestamp of the first Allowed OR Denied event; null if the mandate has never acted. */
  firstActTime: bigint | null;
  /** Timestamp of the block the score is computed at. */
  asOfTime: bigint;
  denials: Denial[];
  capSegments: CapSegment[];
}

export interface ScoreBreakdown {
  score: number;
  /** ppm terms, exposed so a disagreement can be localised rather than argued about. */
  experiencePpm: bigint;
  agePpm: bigint;
  authorityPpm: bigint;
  breachPpm: bigint;
  twaCapWei: bigint;
}
