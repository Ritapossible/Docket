// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title WindowLib
/// @notice A fixed-size ring buffer that accumulates a total over a sliding window.
///
/// @dev Reads are O(1) because `total` is maintained incrementally; writes cost only the
///      buckets actually crossed since the last write, bounded by `bucketCount`. That bound
///      is the worst case measured in `bench/` — an agent that has been idle for a whole
///      window pays to clear it, and no action can ever cost more than that.
///
///      Ticks are unitless. The spend window is ticked in seconds (`block.timestamp`); the
///      rate window is ticked in **blocks** (`block.number`), because at 300ms block times a
///      one-second timestamp resolution cannot express "at most 30 acts per second", which is
///      exactly the regime this contract exists to police.
library WindowLib {
    uint16 internal constant MAX_BUCKETS = 64;

    struct Window {
        uint32 bucketDuration; // ticks per bucket
        uint16 bucketCount; // <= MAX_BUCKETS
        uint16 cursor; // index of the bucket currently being filled
        uint32 cursorStart; // tick at which the bucket under `cursor` began
        uint128 total; // sum of live buckets
        uint128[64] buckets;
    }

    error BadWindowConfig();
    error WindowOverflow();

    /// @notice (Re)configure a window, clearing any accumulated state.
    /// @dev Clearing is bounded by the previous `bucketCount`. Only reachable from owner
    ///      policy changes, never from the hot path.
    function configure(Window storage w, uint32 bucketDuration, uint16 bucketCount, uint32 tick) internal {
        if (bucketDuration == 0 || bucketCount == 0 || bucketCount > MAX_BUCKETS) {
            revert BadWindowConfig();
        }
        uint16 prev = w.bucketCount;
        for (uint16 i = 0; i < prev; i++) {
            if (w.buckets[i] != 0) w.buckets[i] = 0;
        }
        w.bucketDuration = bucketDuration;
        w.bucketCount = bucketCount;
        w.cursor = 0;
        w.cursorStart = tick - (tick % bucketDuration);
        w.total = 0;
    }

    /// @notice The window total as of `tick`, without writing storage.
    /// @dev Used on the check path so that a denied act never pays to roll the window.
    function peek(Window storage w, uint32 tick) internal view returns (uint128) {
        uint32 elapsed = _elapsed(w, tick);
        if (elapsed == 0) return w.total;

        uint16 n = w.bucketCount;
        if (elapsed >= n) return 0;

        uint128 total = w.total;
        uint16 cursor = w.cursor;
        for (uint32 i = 0; i < elapsed; i++) {
            cursor = uint16((cursor + 1) % n);
            total -= w.buckets[cursor];
        }
        return total;
    }

    /// @notice Advance the window to `tick`, evicting buckets that have fallen out of it.
    function roll(Window storage w, uint32 tick) internal {
        uint32 elapsed = _elapsed(w, tick);
        if (elapsed == 0) return;

        uint16 n = w.bucketCount;
        uint32 steps = elapsed >= n ? n : elapsed;

        uint128 total = w.total;
        uint16 cursor = w.cursor;
        for (uint32 i = 0; i < steps; i++) {
            cursor = uint16((cursor + 1) % n);
            uint128 b = w.buckets[cursor];
            if (b != 0) {
                total -= b;
                w.buckets[cursor] = 0;
            }
        }

        w.cursor = cursor;
        w.total = total;
        // Advance by the full elapsed count, not the capped step count, so bucket
        // boundaries stay aligned to `bucketDuration` across long idle periods.
        w.cursorStart = w.cursorStart + elapsed * w.bucketDuration;
    }

    /// @notice Add `amount` to the current bucket. Caller must have rolled to `tick` first.
    function add(Window storage w, uint128 amount) internal {
        if (amount == 0) return;
        uint128 total = w.total + amount;
        if (total < w.total) revert WindowOverflow();
        w.buckets[w.cursor] += amount;
        w.total = total;
    }

    /// @notice Return `amount` to the window — used to refund a declared-but-unspent outflow.
    /// @dev Saturates at zero rather than reverting: an over-refund is a bug in the caller,
    ///      but reverting here would strand funds mid-action.
    function refund(Window storage w, uint128 amount) internal {
        if (amount == 0) return;
        uint16 cursor = w.cursor;
        uint128 bucket = w.buckets[cursor];
        uint128 take = amount > bucket ? bucket : amount;
        unchecked {
            w.buckets[cursor] = bucket - take;
            w.total = w.total >= take ? w.total - take : 0;
        }
    }

    function _elapsed(Window storage w, uint32 tick) private view returns (uint32) {
        uint32 start = w.cursorStart;
        if (tick <= start) return 0;
        return (tick - start) / w.bucketDuration;
    }
}
