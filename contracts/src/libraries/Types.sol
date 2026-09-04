// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Whether the mandate refuses violating acts or merely records that it would have.
/// @dev Observe -> Enforce is a tightening and therefore immediate; the reverse is timelocked.
///      Observe mode exists so the false-denial rate can be measured on real traffic before
///      the guard is able to block anything. A guard that blocks legitimate work gets switched
///      off, which is the failure mode that actually kills products of this kind.
enum Mode {
    Observe,
    Enforce
}

/// @notice The reason an act was refused. Emitted with every `Denied` / `WouldDeny`.
/// @dev "Refused" is a fact; "refused by the per-action cap" is evidence. DCS-1 classifies
///      these into hard and soft breaches, so the ordering here is part of the scoring
///      surface: appending is safe, reordering is a breaking change.
enum Rule {
    None,
    Paused,
    Expired,
    DeadlinePassed,
    TargetNotAllowed,
    SelectorNotAllowed,
    SelectorForbidden,
    AssetNotTracked,
    PerActionCap,
    SpendWindowCap,
    RateCap,
    DeclarationUnsorted
}

/// @notice Mandate-wide policy. Per-asset limits live in `AssetPolicy`.
struct Policy {
    uint64 expiry; // unix seconds; 0 = never
    uint32 rateCap; // max acts per rate window
    uint32 rateWindow; // blocks
    uint16 rateBuckets; // ring size for the rate window
    uint16 slippageBps; // tolerance on the balance assertion
    Mode mode;
}

/// @notice Limits for one asset. `address(0)` is native MON.
struct AssetPolicy {
    bool tracked; // included in the balance assertion
    uint128 perActionCap;
    uint128 windowCap;
    uint32 windowDuration; // seconds
    uint16 windowBuckets;
}

/// @notice An ERC20 outflow the agent declares it intends to make.
struct Outflow {
    address asset;
    uint256 amount;
}

/// @notice One attempted agent action.
/// @dev `declared` is load-bearing and drives four things at once: the per-asset caps, the
///      spend windows, the exact allowance granted for the duration of the call, and the
///      post-execution balance assertion. The agent states what it intends to spend; the
///      policy is checked against the declaration; the assertion then enforces that the
///      declaration was truthful. Lying is not a policy outcome the agent can profit from.
///
///      `declared` covers ERC20s only and must be sorted strictly ascending by asset address
///      (which makes duplicates unrepresentable). Native outflow is `value`.
struct Action {
    address target;
    uint256 value;
    Outflow[] declared;
    bytes data;
    uint64 deadline;
}
