// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Mandate} from "../src/Mandate.sol";
import {MandateFactory} from "../src/MandateFactory.sol";
import {Action, AssetPolicy, Mode, Outflow, Policy, Rule} from "../src/libraries/Types.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MaliciousTarget} from "./mocks/MaliciousTarget.sol";

/// @dev Shared fixture. Every test below names the threat-model row it covers in its own
///      name (`_T3_`, `_I2_`), because CLAUDE.md forbids marking a row covered until a test
///      references its ID and the CI check greps for exactly that.
abstract contract Base is Test {
    Mandate internal mandate;
    MandateFactory internal factory;
    MockERC20 internal token;
    MaliciousTarget internal evil;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal guardian = makeAddr("guardian");
    address internal attacker = makeAddr("attacker");
    address internal counterparty = makeAddr("counterparty");

    uint64 internal constant LOOSEN_DELAY = 1 hours;
    uint128 internal constant NATIVE_PER_ACTION = 2 ether;
    uint128 internal constant NATIVE_WINDOW = 5 ether;
    uint128 internal constant TOKEN_PER_ACTION = 100e18;
    uint128 internal constant TOKEN_WINDOW = 250e18;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        vm.roll(1_000_000);

        factory = new MandateFactory();
        token = new MockERC20();

        Policy memory p = Policy({
            expiry: 0,
            rateCap: 10,
            rateWindow: 200, // blocks; ~60s at 300ms
            rateBuckets: 20,
            slippageBps: 0,
            mode: Mode.Enforce
        });

        mandate = factory.deploy(owner, agent, guardian, LOOSEN_DELAY, p, bytes32(uint256(1)));
        evil = new MaliciousTarget(address(token), attacker);

        vm.deal(address(mandate), 100 ether);
        token.mint(address(mandate), 10_000e18);

        vm.startPrank(owner);
        mandate.tightenAsset(
            address(0),
            AssetPolicy({
                tracked: true,
                perActionCap: NATIVE_PER_ACTION,
                windowCap: NATIVE_WINDOW,
                windowDuration: 3600,
                windowBuckets: 30
            })
        );
        mandate.tightenAsset(
            address(token),
            AssetPolicy({
                tracked: true,
                perActionCap: TOKEN_PER_ACTION,
                windowCap: TOKEN_WINDOW,
                windowDuration: 3600,
                windowBuckets: 30
            })
        );
        vm.stopPrank();

        _allow(counterparty, bytes4(0));
        _allow(address(evil), MaliciousTarget.swap.selector);
        _allow(address(evil), MaliciousTarget.honest.selector);
        _allow(address(evil), MaliciousTarget.drainNative.selector);
        _allow(address(evil), MaliciousTarget.reenter.selector);
    }

    /// @dev Allowlisting is a loosening, so even the fixture has to go through the timelock.
    ///      That is the point of I3 and it should be visible in the tests, not bypassed.
    function _allow(address target, bytes4 selector) internal {
        bytes memory payload = abi.encodeCall(Mandate.allowCall, (target, selector));
        vm.prank(owner);
        mandate.queueLoosen(payload);
        vm.warp(block.timestamp + LOOSEN_DELAY);
        vm.prank(owner);
        mandate.executeLoosen(payload);
    }

    function _nativeAction(address target, uint256 value) internal pure returns (Action memory) {
        return Action({target: target, value: value, declared: new Outflow[](0), data: "", deadline: 0});
    }

    function _tokenAction(address target, uint256 amount, bytes memory data)
        internal
        view
        returns (Action memory a)
    {
        Outflow[] memory outs = new Outflow[](1);
        outs[0] = Outflow({asset: address(token), amount: amount});
        a = Action({target: target, value: 0, declared: outs, data: data, deadline: 0});
    }

    function _act(Action memory a) internal returns (bool ok, bytes memory ret) {
        vm.prank(agent);
        (ok, ret) = mandate.act(a);
    }
}
