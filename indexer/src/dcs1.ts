import {HARD_RULES, type CapSegment, type MandateHistory, type ScoreBreakdown} from "./types.ts";

/**
 * DCS-1 — the reference implementation of spec/DCS-1.md.
 *
 * Every value here is a non-negative BigInt in parts per million and every division is floor
 * division. There is no floating point anywhere, and there must not be: invariant I5 requires
 * that a third party recompute this byte-identically, and `0.5 ** (days / 30)` does not
 * reproduce across languages. BigInt division truncates toward zero, which equals floor for
 * the non-negative values this file deals in.
 */

export const SPEC_VERSION = "DCS-1";

const PPM = 1_000_000n;

const WEIGHT_EXPERIENCE = 350_000n;
const WEIGHT_AGE = 250_000n;
const WEIGHT_AUTHORITY = 200_000n;
const BASE = 200_000n;

const AGE_SATURATION_DAYS = 180n;
const SECONDS_PER_DAY = 86_400n;

const BREACH_WEIGHT_HARD = 340_000n;
const BREACH_WEIGHT_SOFT = 50_000n;
const BREACH_HALVING_DAYS = 30n;

/** spec/DCS-1.md §4.1 */
const EXPERIENCE_TABLE: ReadonlyArray<readonly [bigint, bigint]> = [
  [0n, 0n],
  [1n, 50_000n],
  [10n, 200_000n],
  [100n, 400_000n],
  [1_000n, 600_000n],
  [10_000n, 800_000n],
  [100_000n, 950_000n],
  [1_000_000n, 1_000_000n],
];

/** spec/DCS-1.md §4.3 */
const AUTHORITY_TABLE: ReadonlyArray<readonly [bigint, bigint]> = [
  [0n, 0n],
  [10n ** 15n, 100_000n],
  [10n ** 17n, 300_000n],
  [10n ** 18n, 500_000n],
  [10n ** 20n, 750_000n],
  [10n ** 22n, 1_000_000n],
];

/** Linear interpolation between log-spaced breakpoints, in integer arithmetic. */
export function interpolate(table: ReadonlyArray<readonly [bigint, bigint]>, x: bigint): bigint {
  const first = table[0]!;
  const last = table[table.length - 1]!;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];

  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]!;
    if (x <= x1) {
      const [x0, y0] = table[i - 1]!;
      return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
    }
  }
  return last[1];
}

/** spec/DCS-1.md §4.3 — time-weighted native windowCap. */
export function timeWeightedCap(segments: readonly CapSegment[]): bigint {
  let weighted = 0n;
  let total = 0n;
  for (const s of segments) {
    if (s.durationSeconds <= 0n) continue;
    weighted += s.cap * s.durationSeconds;
    total += s.durationSeconds;
  }
  return total === 0n ? 0n : weighted / total;
}

export function score(history: MandateHistory): ScoreBreakdown {
  const experiencePpm = interpolate(EXPERIENCE_TABLE, history.allowedActs);

  let agePpm = 0n;
  if (history.firstActTime !== null && history.asOfTime > history.firstActTime) {
    const ageDays = (history.asOfTime - history.firstActTime) / SECONDS_PER_DAY;
    const raw = (ageDays * PPM) / AGE_SATURATION_DAYS;
    agePpm = raw > PPM ? PPM : raw;
  }

  const twaCapWei = timeWeightedCap(history.capSegments);
  const authorityPpm = interpolate(AUTHORITY_TABLE, twaCapWei);

  let breachPpm = 0n;
  for (const denial of history.denials) {
    const base = HARD_RULES.has(denial.rule) ? BREACH_WEIGHT_HARD : BREACH_WEIGHT_SOFT;
    const ageDays =
      history.asOfTime > denial.timestamp
        ? (history.asOfTime - denial.timestamp) / SECONDS_PER_DAY
        : 0n;
    let halvings = ageDays / BREACH_HALVING_DAYS;
    if (halvings > 63n) halvings = 63n;
    breachPpm += base >> halvings;
  }
  if (breachPpm > PPM) breachPpm = PPM;

  const raw =
    BASE +
    (WEIGHT_EXPERIENCE * experiencePpm +
      WEIGHT_AGE * agePpm +
      WEIGHT_AUTHORITY * authorityPpm) /
      PPM;

  const settled = (raw * (PPM - breachPpm)) / PPM;
  const finalScore = (settled * 1000n) / PPM;

  return {
    score: Number(finalScore),
    experiencePpm,
    agePpm,
    authorityPpm,
    breachPpm,
    twaCapWei,
  };
}
