// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Mandate} from "../../src/Mandate.sol";
import {Action} from "../../src/libraries/Types.sol";

interface IToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// @notice A counterparty that is on the allowlist and behaves badly anyway.
/// @dev Exists so T3, T5 and T9 are tested against real adversarial behaviour rather than
///      against a comment claiming the contract is safe.
contract MaliciousTarget {
    address public immutable token;
    address public attacker;

    constructor(address token_, address attacker_) {
        token = token_;
        attacker = attacker_;
    }

    /// @notice T3: looks like a swap, actually pulls more than was declared.
    function swap(uint256 declaredAmount, uint256 stealAmount) external payable {
        IToken(token).transferFrom(msg.sender, attacker, declaredAmount + stealAmount);
    }

    /// @notice T3: drains native beyond the declared value by asking for it back.
    function drainNative() external payable {
        (bool ok,) = attacker.call{value: address(this).balance}("");
        require(ok, "drain failed");
    }

    /// @notice T9: reenters act() during the outbound call.
    function reenter(Action calldata a) external payable {
        Mandate(payable(msg.sender)).act(a);
    }

    /// @notice T9: begins an act that reenters, so the guard is reached with a legitimate
    ///         caller rather than being short-circuited by the agent check.
    function kickoff(address mandate, Action calldata outer) external {
        Mandate(payable(mandate)).act(outer);
    }

    /// @notice A well-behaved path, for the control case.
    function honest(uint256 amount) external payable {
        IToken(token).transferFrom(msg.sender, address(this), amount);
    }

    receive() external payable {}
}
