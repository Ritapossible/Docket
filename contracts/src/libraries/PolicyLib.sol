// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AssetPolicy, Policy} from "./Types.sol";

/// @title PolicyLib
/// @notice The tightening partial order that invariant I3 rests on.
///
/// @dev I3 says tightening is immediate and loosening is timelocked, which requires a
///      *decidable* predicate over policy changes rather than a judgement call. Two fields
///      are counter-intuitive and worth stating:
///
///      - **Adding** a tracked asset is stricter, because it widens the coverage of the
///        balance assertion.
///      - Changing a window's **shape** is a loosening in either direction, because
///        reconfiguring the ring buffer clears the usage accumulated so far. An owner who
///        could "tighten" a cap while resetting the spend counter would have loosened the
///        mandate, so shape changes are always timelocked.
///
///      Every mutating entry point on the Mandate knows its own direction, so this library
///      only has to compare like with like. Anything that is not provably non-loosening goes
///      through the timelock.
library PolicyLib {
    /// @return True if `next` is no weaker than `prev` in every dimension.
    function isTightening(Policy memory prev, Policy memory next) internal pure returns (bool) {
        // expiry: earlier is stricter, with 0 meaning "never" and therefore weakest.
        uint64 prevExpiry = prev.expiry == 0 ? type(uint64).max : prev.expiry;
        uint64 nextExpiry = next.expiry == 0 ? type(uint64).max : next.expiry;
        if (nextExpiry > prevExpiry) return false;

        // Fewer acts allowed is stricter.
        if (next.rateCap > prev.rateCap) return false;

        // Window SHAPE must be identical on the instant path. A longer window is stricter in
        // principle, but changing the shape necessarily clears the ring buffer's accumulated
        // usage - which lets the agent spend again immediately, and is therefore a loosening
        // however the caps move. Shape changes go through the timelock in both directions.
        if (next.rateWindow != prev.rateWindow) return false;
        if (next.rateBuckets != prev.rateBuckets) return false;

        // Less tolerance on the balance assertion is stricter.
        if (next.slippageBps > prev.slippageBps) return false;

        // Observe -> Enforce only.
        if (uint8(next.mode) < uint8(prev.mode)) return false;

        return true;
    }

    /// @return True if `next` is no weaker than `prev` for a single asset.
    function isAssetTightening(AssetPolicy memory prev, AssetPolicy memory next)
        internal
        pure
        returns (bool)
    {
        // Tracking an asset widens the balance assertion, so untracking is a loosening.
        if (prev.tracked && !next.tracked) return false;

        // An untracked asset has no limits to compare; beginning to track it is a tightening
        // whatever caps it arrives with, because previously it was unconstrained.
        if (!prev.tracked) return true;

        if (next.perActionCap > prev.perActionCap) return false;
        if (next.windowCap > prev.windowCap) return false;

        // Same reasoning as the rate window: a shape change resets accumulated spend, so it
        // is a loosening in disguise and may not take the instant path.
        if (next.windowDuration != prev.windowDuration) return false;
        if (next.windowBuckets != prev.windowBuckets) return false;

        return true;
    }
}
