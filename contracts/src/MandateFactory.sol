// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Mandate} from "./Mandate.sol";
import {Policy} from "./libraries/Types.sol";

/// @title MandateFactory
/// @notice Deterministic deployment and discovery for mandates.
/// @dev Holds no funds and no privileges. Its only jobs are to make mandates discoverable to
///      the indexer and address-predictable to the SDK. Deliberately has no registry mapping
///      and no counter: a shared slot written by every deployment would be exactly the kind of
///      global mutable state invariant I4 exists to keep off the hot path.
contract MandateFactory {
    event MandateDeployed(
        address indexed mandate, address indexed owner, address indexed agent, bytes32 policyHash
    );

    function deploy(
        address owner,
        address agent,
        address guardian,
        uint64 loosenDelay,
        Policy calldata policy,
        bytes32 salt
    ) external returns (Mandate mandate) {
        mandate = new Mandate{salt: _scope(salt, owner)}(owner, agent, guardian, loosenDelay, policy);
        emit MandateDeployed(address(mandate), owner, agent, keccak256(abi.encode(policy)));
    }

    function predict(
        address owner,
        address agent,
        address guardian,
        uint64 loosenDelay,
        Policy calldata policy,
        bytes32 salt
    ) external view returns (address) {
        bytes32 initHash = keccak256(
            abi.encodePacked(
                type(Mandate).creationCode, abi.encode(owner, agent, guardian, loosenDelay, policy)
            )
        );
        return address(
            uint160(
                uint256(
                    keccak256(abi.encodePacked(bytes1(0xff), address(this), _scope(salt, owner), initHash))
                )
            )
        );
    }

    /// @dev Scoping the salt to the owner stops one owner front-running another's address.
    function _scope(bytes32 salt, address owner) private pure returns (bytes32) {
        return keccak256(abi.encode(owner, salt));
    }
}
