export function shortAddress(address: string): string {
  if (address.length < 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatEth(wei: bigint, decimals = 4): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, decimals).replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

export function ppm(value: bigint): string {
  return `${(Number(value) / 10_000).toFixed(1)}%`;
}

/** Rules are the product's own vocabulary; the UI spells them out rather than shouting enums. */
export function ruleSentence(rule: string): string {
  const sentences: Record<string, string> = {
    Paused: "the mandate is paused",
    Expired: "the mandate has expired",
    DeadlinePassed: "the action's own deadline had passed",
    TargetNotAllowed: "that address is not on the allowlist",
    SelectorNotAllowed: "that function is not allowlisted for this target",
    SelectorForbidden: "approvals can never be signed as an ordinary action",
    AssetNotTracked: "that asset is not tracked by this mandate",
    PerActionCap: "it exceeds the per-action cap",
    SpendWindowCap: "it would exceed the spend window",
    RateCap: "it exceeds the rate limit",
    DeclarationUnsorted: "the declared outflows were malformed",
  };
  return sentences[rule] ?? rule;
}
