// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {console} from "forge-std/console.sol";
import {Mandate} from "../contracts/src/Mandate.sol";
import {MandateFactory} from "../contracts/src/MandateFactory.sol";
import {AssetPolicy, Mode, Policy} from "../contracts/src/libraries/Types.sol";

/// @notice Deploys a factory and one example mandate to Monad testnet.
/// @dev PLAN.md week 0: a contract that has only ever run in `forge test` is not a working
///      product, and the submission requires demonstrably in-window work. Every dated
///      deployment is evidence.
///
///      forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.addr(pk);
        address agent = vm.envAddress("AGENT_ADDRESS");
        address guardian = vm.envOr("GUARDIAN_ADDRESS", owner);

        Policy memory policy = Policy({
            expiry: 0,
            rateCap: 30, // 30 acts per ~60s of blocks
            rateWindow: 200, // blocks; ~60s at 300ms
            rateBuckets: 20,
            slippageBps: 0,
            mode: Mode.Observe // arm it deliberately, per ARCHITECTURE §3.8
        });

        vm.startBroadcast(pk);

        MandateFactory factory = new MandateFactory();
        Mandate mandate = factory.deploy(owner, agent, guardian, 1 hours, policy, bytes32(block.timestamp));

        mandate.tightenAsset(
            address(0),
            AssetPolicy({
                tracked: true,
                perActionCap: 0.5 ether,
                windowCap: 5 ether,
                windowDuration: 3600,
                windowBuckets: 30
            })
        );

        vm.stopBroadcast();

        console.log("factory  ", address(factory));
        console.log("mandate  ", address(mandate));
        console.log("owner    ", owner);
        console.log("agent    ", agent);
        console.log("mode      Observe - arm with tighten() once the false-denial rate is known");
    }
}
