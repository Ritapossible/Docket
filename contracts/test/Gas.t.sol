// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {Mandate} from "../src/Mandate.sol";
import {Action, AssetPolicy, Mode, Outflow, Policy} from "../src/libraries/Types.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Resolves the open question in ARCHITECTURE.md §9 with a measurement.
///
/// @dev The balance assertion reads every tracked asset's balance twice per act — once for the
///      snapshot, once to settle. That is the cost of the guarantee, and it scales linearly
///      with `trackedAssets`. Somewhere on that line the guard costs more than the action it
///      guards, and `MAX_TRACKED_ASSETS` belongs at that point rather than at a round number
///      someone liked. Run with `forge test --match-contract GasTest -vv`.
contract GasTest is Test {
    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal counterparty = makeAddr("counterparty");

    uint64 internal constant LOOSEN_DELAY = 1 hours;

    function setUp() public {
        vm.warp(1_800_000_000);
        vm.roll(1_000_000);
    }

    function test_gasScalesLinearlyWithTrackedAssets() public {
        console.log("tracked | gas per act | marginal");
        console.log("--------+-------------+---------");

        uint256 previous;
        for (uint256 n = 1; n <= 16; n = n * 2) {
            uint256 used = _measureAct(n);
            uint256 marginal = previous == 0 ? 0 : (used - previous) / (n / 2);
            console.log(n, used, marginal);
            previous = used;
        }
    }

    /// @dev A budget, not a curiosity. If a change makes a fully-tracked act cost more than
    ///      this, the balance assertion has stopped being affordable and the cap must move.
    function test_fullyTrackedActStaysUnderBudget() public {
        uint256 used = _measureAct(16);
        assertLt(used, 250_000, "16 tracked assets must stay under the act budget");
    }

    /// @dev The worst case in WindowLib: an agent idle for longer than a whole window pays to
    ///      clear every bucket in it. Bounded by `bucketCount`, and this is what that bound
    ///      actually costs.
    function test_worstCaseWindowAdvance() public {
        Mandate m = _mandate(1);

        Action memory a = _action(counterparty, 0.1 ether);
        vm.prank(agent);
        m.act(a);

        // Idle past the full 16-bucket window, then act again: every bucket must be evicted.
        vm.warp(block.timestamp + 16 * 60 + 1);
        vm.roll(block.number + 1);

        uint256 g0 = gasleft();
        vm.prank(agent);
        m.act(a);
        uint256 used = g0 - gasleft();

        console.log("worst-case window advance, gas per act:", used);
        assertLt(used, 250_000, "a full window clear must stay bounded");
    }

    /// @dev The true worst case, and the one that matters for sizing a block: an act that
    ///      declares several assets whose windows have all gone stale, on a mandate tracking
    ///      the maximum. Note the asymmetry that keeps this bounded — `_settle` touches every
    ///      tracked asset, but only *declared* assets have their windows rolled, so the
    ///      expensive term scales with declarations per act rather than with the tracked set.
    function test_compoundWorstCase() public {
        (Mandate m, address[] memory tokens) = _mandateWithSortedTokens(16);

        Action memory a = _multiAssetAction(counterparty, tokens, 15);

        vm.prank(agent);
        m.act(a);

        // Idle past a full window so every declared asset must clear all 64 buckets.
        vm.warp(block.timestamp + 16 * 60 + 1);
        vm.roll(block.number + 1);

        uint256 g0 = gasleft();
        vm.prank(agent);
        m.act(a);
        uint256 used = g0 - gasleft();

        console.log("16 tracked, 15 declared, all windows stale, gas per act:", used);
        console.log("  marginal per declared stale asset:", (used - 95_053) / 15);

        // A regression guard set from the measurement, not from a number that sounded tidy.
        // 1.29M measured; the headroom catches a change that makes an act materially more
        // expensive without failing on noise. The dominant term is the set-call-zero allowance
        // pair on a cold token, not the window eviction — see bench/RESULTS.md.
        assertLt(used, 1_400_000, "compound worst case regressed");
    }

    // ------------------------------------------------------------------------------

    function _mandateWithSortedTokens(uint256 trackedCount)
        internal
        returns (Mandate m, address[] memory tokens)
    {
        m = _mandate(1);
        tokens = new address[](trackedCount - 1);

        AssetPolicy memory ap = AssetPolicy({
            tracked: true,
            perActionCap: 1000e18,
            windowCap: type(uint128).max,
            windowDuration: 16 * 60,
            windowBuckets: 16
        });

        for (uint256 i = 0; i < tokens.length; i++) {
            MockERC20 t = new MockERC20();
            t.mint(address(m), 1_000_000e18);
            tokens[i] = address(t);
            vm.prank(owner);
            m.tightenAsset(address(t), ap);
        }

        // `declared` must be sorted strictly ascending by address.
        for (uint256 i = 1; i < tokens.length; i++) {
            address key = tokens[i];
            uint256 j = i;
            while (j > 0 && tokens[j - 1] > key) {
                tokens[j] = tokens[j - 1];
                j--;
            }
            tokens[j] = key;
        }
    }

    function _multiAssetAction(address target, address[] memory tokens, uint256 count)
        internal
        pure
        returns (Action memory)
    {
        Outflow[] memory outs = new Outflow[](count);
        for (uint256 i = 0; i < count; i++) {
            outs[i] = Outflow({asset: tokens[i], amount: 1e18});
        }
        return Action({target: target, value: 0, declared: outs, data: "", deadline: 0});
    }

    function _measureAct(uint256 trackedCount) internal returns (uint256 used) {
        Mandate m = _mandate(trackedCount);

        Action memory a = _action(counterparty, 0.1 ether);

        // Warm the storage and the balance reads first, so the figure reflects the steady
        // state rather than one-off cold-slot costs.
        vm.prank(agent);
        m.act(a);

        uint256 g0 = gasleft();
        vm.prank(agent);
        m.act(a);
        used = g0 - gasleft();
    }

    function _mandate(uint256 trackedCount) internal returns (Mandate m) {
        Policy memory p = Policy({
            expiry: 0,
            rateCap: 1_000_000,
            rateWindow: 200,
            rateBuckets: 10,
            slippageBps: 0,
            mode: Mode.Enforce
        });

        m = new Mandate(owner, agent, counterparty, LOOSEN_DELAY, p);
        vm.deal(address(m), 100 ether);

        AssetPolicy memory ap = AssetPolicy({
            tracked: true,
            perActionCap: 10 ether,
            windowCap: type(uint128).max,
            windowDuration: 16 * 60,
            windowBuckets: 16
        });

        vm.prank(owner);
        m.tightenAsset(address(0), ap);

        // trackedCount includes native, so add trackedCount - 1 ERC20s.
        for (uint256 i = 1; i < trackedCount; i++) {
            MockERC20 t = new MockERC20();
            t.mint(address(m), 1_000e18);
            vm.prank(owner);
            m.tightenAsset(address(t), ap);
        }

        bytes memory payload = abi.encodeCall(Mandate.allowCall, (counterparty, bytes4(0)));
        vm.prank(owner);
        m.queueLoosen(payload);
        vm.warp(block.timestamp + LOOSEN_DELAY);
        vm.prank(owner);
        m.executeLoosen(payload);
    }

    function _action(address target, uint256 value) internal pure returns (Action memory) {
        return Action({target: target, value: value, declared: new Outflow[](0), data: "", deadline: 0});
    }
}
