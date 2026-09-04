// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "./interfaces/IERC20.sol";
import {WindowLib} from "./libraries/WindowLib.sol";
import {PolicyLib} from "./libraries/PolicyLib.sol";
import {Action, AssetPolicy, Mode, Outflow, Policy, Rule} from "./libraries/Types.sol";

/// @title Mandate
/// @notice Holds funds and a policy, and lets an agent act only within that policy.
///
/// @dev The six invariants from ARCHITECTURE.md §1 that this contract exists to uphold:
///
///  I1  The agent holds no key that moves funds by any path except `act()`.
///  I2  A policy violation NEVER reverts. It emits `Denied` and returns false.
///  I3  Tightening is immediate; loosening is timelocked. There is no admin key.
///  I4  No global mutable state. All state here is per-mandate, so Monad's optimistic
///      parallel execution is never serialized by a counter shared between agents.
///  I5  Everything published is recomputable from these events alone.
///  I6  No judgement is made here. Policy is data, supplied by a human.
///
/// I2 is the one that gets broken by accident. `require()` in the policy path looks correct
/// and destroys the product: a revert rolls back state including logs, so the refused attempt
/// — the artifact the whole system rests on — would vanish. Policy failures return; only a
/// broken transaction (an untruthful outflow declaration, reentrancy) reverts.
contract Mandate {
    using WindowLib for WindowLib.Window;
    using PolicyLib for Policy;

    /// @dev Measured, not guessed. The balance assertion costs a flat 3,372 gas per tracked
    ///      asset with no cliff (bench/RESULTS.md §2), so this bounds the loop rather than
    ///      dodging a limit. It also bounds `declared`, since every declared asset must be
    ///      tracked — which is what keeps the multi-asset worst case finite.
    uint256 public constant MAX_TRACKED_ASSETS = 16;

    uint64 public constant MIN_LOOSEN_DELAY = 10 minutes;

    // Selectors the mandate will never sign as an ordinary action. Docket grants an exact
    // allowance for the duration of a call and zeroes it in the same transaction, so a
    // counterparty allowlisted today cannot drain the mandate tomorrow. Computed from the
    // signature rather than hard-coded, so they cannot be silently wrong.
    bytes4 private constant SEL_APPROVE = bytes4(keccak256("approve(address,uint256)"));
    bytes4 private constant SEL_INC_ALLOWANCE = bytes4(keccak256("increaseAllowance(address,uint256)"));
    bytes4 private constant SEL_SET_APPROVAL_ALL = bytes4(keccak256("setApprovalForAll(address,bool)"));
    bytes4 private constant SEL_PERMIT_2612 =
        bytes4(keccak256("permit(address,address,uint256,uint256,uint8,bytes32,bytes32)"));
    bytes4 private constant SEL_PERMIT_DAI =
        bytes4(keccak256("permit(address,address,uint256,uint256,bool,uint8,bytes32,bytes32)"));

    address public immutable owner;

    address public agent;
    address public guardian;
    bool public paused;
    uint32 public keyEpoch;
    uint64 public loosenDelay;
    uint64 public nonce;

    Policy public policy;

    mapping(address => mapping(bytes4 => bool)) public allowedCall;
    mapping(address => uint256) public allowedSelectorCount;
    mapping(address => AssetPolicy) public assetPolicy;
    address[] public trackedAssets;
    mapping(address => uint256) private _trackedIndex; // 1-based; 0 means absent

    /// @dev id => earliest execution timestamp
    mapping(bytes32 => uint64) public queuedAt;

    WindowLib.Window private _rateWindow;
    mapping(address => WindowLib.Window) private _spendWindow;

    uint256 private _entered;

    event Allowed(
        uint64 id,
        address indexed target,
        bytes4 indexed selector,
        uint256 value,
        bytes32 dataHash,
        uint32 keyEpoch
    );
    event Denied(
        uint64 id,
        Rule indexed rule,
        address indexed target,
        bytes4 indexed selector,
        uint256 value,
        bytes32 dataHash,
        uint32 keyEpoch
    );
    event WouldDeny(
        uint64 id,
        Rule indexed rule,
        address indexed target,
        bytes4 indexed selector,
        uint256 value,
        bytes32 dataHash,
        uint32 keyEpoch
    );
    event Failed(uint64 id, address indexed target, bytes4 indexed selector, bytes returnData);

    event Tightened(bytes what, bytes payload);
    event LoosenQueued(bytes32 indexed id, bytes payload, uint64 eta);
    event LoosenExecuted(bytes32 indexed id, bytes payload);
    event LoosenCancelled(bytes32 indexed id);
    event Paused(address indexed by);
    event Unpaused();
    event KeyRotated(address indexed from, address indexed to, uint32 epoch);
    event GuardianSet(address indexed guardian);
    event MandateDeployed(
        address indexed owner, address indexed agent, address indexed guardian, bytes32 policyHash
    );
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed asset, address indexed to, uint256 amount);

    error NotOwner();
    error NotAgent();
    error NotSelf();
    error NotGuardian();
    error Reentrancy();
    error NotTightening();
    error AlreadyQueued();
    error NotQueued();
    error TimelockPending(uint64 eta);
    error DelayTooShort();
    error TooManyTrackedAssets();
    error OutflowExceedsDeclaration(address asset, uint256 actual, uint256 permitted);
    error TransferFailed();
    error ApprovalFailed();
    error BadPolicy();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev Loosenings are reachable only through `executeLoosen`, which calls back into this
    ///      contract after the timelock has elapsed. There is no admin key and no other path.
    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(
        address owner_,
        address agent_,
        address guardian_,
        uint64 loosenDelay_,
        Policy memory policy_
    ) {
        if (loosenDelay_ < MIN_LOOSEN_DELAY) revert DelayTooShort();
        owner = owner_;
        agent = agent_;
        guardian = guardian_;
        loosenDelay = loosenDelay_;
        policy = policy_;
        _configureRateWindow(policy_);
        // Discovery without a registry: the indexer filters this topic across all addresses.
        // A factory that deployed mandates with `new` would have to embed the whole initcode
        // and could never fit under EIP-170 — see bench/RESULTS.md.
        emit MandateDeployed(owner_, agent_, guardian_, keccak256(abi.encode(policy_)));
    }

    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------------------------
    // The hot path
    // ---------------------------------------------------------------------------------

    /// @notice Attempt one agent action.
    /// @return ok True if the action passed the policy AND the target call succeeded.
    /// @dev A successful transaction does NOT mean the action executed. Callers must check
    ///      the return value; the SDK turns a false return into a `DeniedError`. This is the
    ///      cost of I2 and it is documented everywhere it touches.
    function act(Action calldata a) external nonReentrant returns (bool ok, bytes memory ret) {
        if (msg.sender != agent) revert NotAgent();

        uint64 id = ++nonce;
        bytes4 selector = _selectorOf(a.data);
        bytes32 dataHash = keccak256(a.data);

        Rule rule = _evaluate(a, selector);
        if (rule != Rule.None) {
            if (policy.mode == Mode.Enforce) {
                // I2. No revert: the refused attempt is the artifact.
                emit Denied(id, rule, a.target, selector, a.value, dataHash, keyEpoch);
                return (false, "");
            }
            emit WouldDeny(id, rule, a.target, selector, a.value, dataHash, keyEpoch);
        }

        uint256[] memory balancesBefore = _snapshot();

        _debit(a);
        _grantApprovals(a, a.target);

        (ok, ret) = a.target.call{value: a.value}(a.data);

        _revokeApprovals(a, a.target);
        _settle(a, balancesBefore);

        if (ok) {
            emit Allowed(id, a.target, selector, a.value, dataHash, keyEpoch);
        } else {
            emit Failed(id, a.target, selector, ret);
        }
    }

    /// @notice The policy decision, over storage only, with no external calls.
    /// @dev Ordered cheapest-first so a denial costs as little as possible. The first failing
    ///      rule wins and is what gets recorded.
    function _evaluate(Action calldata a, bytes4 selector) private view returns (Rule) {
        if (paused) return Rule.Paused;

        Policy memory p = policy;
        if (p.expiry != 0 && block.timestamp > p.expiry) return Rule.Expired;
        if (a.deadline != 0 && block.timestamp > a.deadline) return Rule.DeadlinePassed;

        if (a.data.length > 0 && a.data.length < 4) return Rule.SelectorNotAllowed;
        if (_isForbidden(selector)) return Rule.SelectorForbidden;
        if (!allowedCall[a.target][selector]) {
            return allowedSelectorCount[a.target] == 0 ? Rule.TargetNotAllowed : Rule.SelectorNotAllowed;
        }

        uint32 nowSec = uint32(block.timestamp);

        if (a.value > 0) {
            AssetPolicy memory nat = assetPolicy[address(0)];
            if (!nat.tracked) return Rule.AssetNotTracked;
            if (a.value > nat.perActionCap) return Rule.PerActionCap;
            if (uint256(_spendWindow[address(0)].peek(nowSec)) + a.value > nat.windowCap) {
                return Rule.SpendWindowCap;
            }
        }

        // Strictly ascending order makes duplicate assets unrepresentable, and starting the
        // comparison at address(0) also rejects native appearing here — it belongs in `value`.
        address prev = address(0);
        for (uint256 i = 0; i < a.declared.length; i++) {
            Outflow calldata o = a.declared[i];
            if (o.asset <= prev) return Rule.DeclarationUnsorted;
            prev = o.asset;

            AssetPolicy memory ap = assetPolicy[o.asset];
            if (!ap.tracked) return Rule.AssetNotTracked;
            if (o.amount > ap.perActionCap) return Rule.PerActionCap;
            if (uint256(_spendWindow[o.asset].peek(nowSec)) + o.amount > ap.windowCap) {
                return Rule.SpendWindowCap;
            }
        }

        if (uint256(_rateWindow.peek(uint32(block.number))) + 1 > p.rateCap) return Rule.RateCap;

        return Rule.None;
    }

    function _debit(Action calldata a) private {
        uint32 nowSec = uint32(block.timestamp);

        _rateWindow.roll(uint32(block.number));
        _rateWindow.add(1);

        if (a.value > 0) {
            WindowLib.Window storage w = _spendWindow[address(0)];
            w.roll(nowSec);
            w.add(uint128(a.value));
        }
        for (uint256 i = 0; i < a.declared.length; i++) {
            WindowLib.Window storage w = _spendWindow[a.declared[i].asset];
            w.roll(nowSec);
            w.add(uint128(a.declared[i].amount));
        }
    }

    /// @notice The guarantee. The allowlist is a heuristic; this is what actually holds.
    /// @dev The allowlist constrains what the agent may *ask for*, and a sufficiently clever
    ///      payload — an aggregator route, a nested multicall, a callback — can ask for one
    ///      thing and do another. This measures the outcome instead of predicting it, and it
    ///      is why T3 is a covered attack rather than an accepted risk.
    function _settle(Action calldata a, uint256[] memory balancesBefore) private {
        uint256 n = trackedAssets.length;
        uint16 slippageBps = policy.slippageBps;

        for (uint256 i = 0; i < n; i++) {
            address asset = trackedAssets[i];
            uint256 declared = _declaredFor(a, asset);
            uint256 after_ = _balance(asset);
            uint256 before_ = balancesBefore[i];
            uint256 actual = before_ > after_ ? before_ - after_ : 0;

            uint256 permitted = declared + (declared * slippageBps) / 10_000;
            if (actual > permitted) {
                revert OutflowExceedsDeclaration(asset, actual, permitted);
            }

            if (declared > actual) {
                _spendWindow[asset].refund(uint128(declared - actual));
            }
        }
    }

    function _snapshot() private view returns (uint256[] memory balances) {
        uint256 n = trackedAssets.length;
        balances = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            balances[i] = _balance(trackedAssets[i]);
        }
    }

    function _declaredFor(Action calldata a, address asset) private pure returns (uint256) {
        if (asset == address(0)) return a.value;
        for (uint256 i = 0; i < a.declared.length; i++) {
            if (a.declared[i].asset == asset) return a.declared[i].amount;
        }
        return 0;
    }

    /// @dev Skips the asset the call is addressed to: calling a token directly (`transfer`)
    ///      spends the mandate's own balance and needs no allowance, and the set-call-zero pair
    ///      is the single most expensive item in a multi-asset act (bench/RESULTS.md). The
    ///      balance assertion still bounds that leg, so nothing is given up by not approving.
    function _grantApprovals(Action calldata a, address spender) private {
        for (uint256 i = 0; i < a.declared.length; i++) {
            address asset = a.declared[i].asset;
            if (asset == spender) continue;
            _approve(asset, spender, a.declared[i].amount);
        }
    }

    function _revokeApprovals(Action calldata a, address spender) private {
        for (uint256 i = 0; i < a.declared.length; i++) {
            address asset = a.declared[i].asset;
            if (asset == spender) continue;
            _approve(asset, spender, 0);
        }
    }

    /// @dev Tolerates tokens that return nothing from `approve` (USDT and friends).
    function _approve(address asset, address spender, uint256 amount) private {
        (bool ok, bytes memory ret) =
            asset.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert ApprovalFailed();
    }

    function _balance(address asset) private view returns (uint256) {
        if (asset == address(0)) return address(this).balance;
        return IERC20(asset).balanceOf(address(this));
    }

    function _selectorOf(bytes calldata data) private pure returns (bytes4) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[:4]);
    }

    function _isForbidden(bytes4 selector) private pure returns (bool) {
        return selector == SEL_APPROVE || selector == SEL_INC_ALLOWANCE || selector == SEL_SET_APPROVAL_ALL
            || selector == SEL_PERMIT_2612 || selector == SEL_PERMIT_DAI;
    }

    // ---------------------------------------------------------------------------------
    // Tightening — immediate, owner only (I3)
    // ---------------------------------------------------------------------------------

    function tighten(Policy calldata next) external onlyOwner {
        if (!PolicyLib.isTightening(policy, next)) revert NotTightening();
        _applyPolicy(next);
        emit Tightened("policy", abi.encode(next));
    }

    function tightenAsset(address asset, AssetPolicy calldata next) external onlyOwner {
        if (!PolicyLib.isAssetTightening(assetPolicy[asset], next)) revert NotTightening();
        _setAssetPolicy(asset, next);
        emit Tightened("asset", abi.encode(asset, next));
    }

    function revokeCall(address target, bytes4 selector) external onlyOwner {
        _setAllowedCall(target, selector, false);
        emit Tightened("revokeCall", abi.encode(target, selector));
    }

    function pause() external {
        if (msg.sender != owner && msg.sender != guardian) revert NotGuardian();
        paused = true;
        emit Paused(msg.sender);
    }

    /// @dev Appointing a guardian only adds someone who can pause, which is a tightening, so
    ///      it needs no timelock and expands no trust. Removing one is a loosening.
    function setGuardian(address guardian_) external onlyOwner {
        if (guardian_ == address(0)) revert NotGuardian();
        guardian = guardian_;
        emit GuardianSet(guardian_);
    }

    /// @dev Rotating the agent key is safe at any time: a new key can only do what the policy
    ///      already allows, and the old one stops working immediately. The epoch is recorded
    ///      so the record cannot be laundered by rotating.
    function rotateAgent(address agent_) external onlyOwner {
        address from = agent;
        agent = agent_;
        keyEpoch += 1;
        emit KeyRotated(from, agent_, keyEpoch);
    }

    function increaseLoosenDelay(uint64 delay) external onlyOwner {
        if (delay <= loosenDelay) revert NotTightening();
        loosenDelay = delay;
        emit Tightened("loosenDelay", abi.encode(delay));
    }

    function withdraw(address asset, address to, uint256 amount) external onlyOwner {
        if (asset == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            (bool ok, bytes memory ret) =
                asset.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
            if (!ok || (ret.length != 0 && !abi.decode(ret, (bool)))) revert TransferFailed();
        }
        emit Withdrawn(asset, to, amount);
    }

    // ---------------------------------------------------------------------------------
    // Loosening — timelocked, reachable only via executeLoosen (I3)
    // ---------------------------------------------------------------------------------

    function queueLoosen(bytes calldata payload) external onlyOwner returns (bytes32 id) {
        id = keccak256(payload);
        if (queuedAt[id] != 0) revert AlreadyQueued();
        uint64 eta = uint64(block.timestamp) + loosenDelay;
        queuedAt[id] = eta;
        emit LoosenQueued(id, payload, eta);
    }

    function executeLoosen(bytes calldata payload) external onlyOwner returns (bytes memory ret) {
        bytes32 id = keccak256(payload);
        uint64 eta = queuedAt[id];
        if (eta == 0) revert NotQueued();
        if (block.timestamp < eta) revert TimelockPending(eta);
        delete queuedAt[id];

        bool ok;
        (ok, ret) = address(this).call(payload);
        if (!ok) {
            assembly {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        emit LoosenExecuted(id, payload);
    }

    /// @dev Cancelling a queued loosening is itself a tightening, so it is immediate.
    function cancelLoosen(bytes32 id) external onlyOwner {
        if (queuedAt[id] == 0) revert NotQueued();
        delete queuedAt[id];
        emit LoosenCancelled(id);
    }

    function loosen(Policy calldata next) external onlySelf {
        _applyPolicy(next);
    }

    function loosenAsset(address asset, AssetPolicy calldata next) external onlySelf {
        _setAssetPolicy(asset, next);
    }

    function allowCall(address target, bytes4 selector) external onlySelf {
        _setAllowedCall(target, selector, true);
    }

    function unpause() external onlySelf {
        paused = false;
        emit Unpaused();
    }

    function clearGuardian() external onlySelf {
        guardian = address(0);
        emit GuardianSet(address(0));
    }

    function decreaseLoosenDelay(uint64 delay) external onlySelf {
        if (delay < MIN_LOOSEN_DELAY) revert DelayTooShort();
        loosenDelay = delay;
    }

    // ---------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------

    function trackedAssetCount() external view returns (uint256) {
        return trackedAssets.length;
    }

    function spentInWindow(address asset) external view returns (uint256) {
        return _spendWindow[asset].peek(uint32(block.timestamp));
    }

    function actsInWindow() external view returns (uint256) {
        return _rateWindow.peek(uint32(block.number));
    }

    /// @notice Dry-run the policy without spending anything.
    /// @dev The console and the SDK use this to explain a refusal before it is attempted.
    function evaluate(Action calldata a) external view returns (Rule) {
        return _evaluate(a, _selectorOf(a.data));
    }

    // ---------------------------------------------------------------------------------
    // Internals shared by both directions
    // ---------------------------------------------------------------------------------

    /// @dev Reconfiguring a ring buffer clears the usage accumulated in it, so it happens only
    ///      when the window's shape actually changes. PolicyLib forces any shape change through
    ///      the timelock for exactly this reason: resetting the spend counter is a loosening
    ///      however the caps move.
    function _applyPolicy(Policy calldata next) private {
        Policy memory prev = policy;
        policy = next;
        if (next.rateWindow != prev.rateWindow || next.rateBuckets != prev.rateBuckets) {
            _configureRateWindow(next);
        }
    }

    function _configureRateWindow(Policy memory p) private {
        if (p.rateBuckets == 0 || p.rateBuckets > WindowLib.MAX_BUCKETS) revert BadPolicy();
        uint32 duration = p.rateWindow / p.rateBuckets;
        _rateWindow.configure(duration == 0 ? 1 : duration, p.rateBuckets, uint32(block.number));
    }

    function _setAllowedCall(address target, bytes4 selector, bool value) private {
        bool current = allowedCall[target][selector];
        if (current == value) return;
        allowedCall[target][selector] = value;
        if (value) {
            allowedSelectorCount[target] += 1;
        } else {
            allowedSelectorCount[target] -= 1;
        }
    }

    function _setAssetPolicy(address asset, AssetPolicy calldata next) private {
        AssetPolicy memory prev = assetPolicy[asset];
        assetPolicy[asset] = next;

        if (next.tracked && !prev.tracked) {
            if (trackedAssets.length >= MAX_TRACKED_ASSETS) revert TooManyTrackedAssets();
            trackedAssets.push(asset);
            _trackedIndex[asset] = trackedAssets.length;
        } else if (!next.tracked && prev.tracked) {
            uint256 idx = _trackedIndex[asset];
            uint256 last = trackedAssets.length;
            if (idx != last) {
                address moved = trackedAssets[last - 1];
                trackedAssets[idx - 1] = moved;
                _trackedIndex[moved] = idx;
            }
            trackedAssets.pop();
            delete _trackedIndex[asset];
        }

        // Only reconfigure when the shape actually changes, so that tightening a cap does not
        // silently hand the agent a fresh window to spend from.
        bool shapeChanged =
            next.windowDuration != prev.windowDuration || next.windowBuckets != prev.windowBuckets;
        if (next.tracked && (!prev.tracked || shapeChanged)) {
            if (next.windowBuckets == 0 || next.windowBuckets > WindowLib.MAX_BUCKETS) {
                revert BadPolicy();
            }
            uint32 duration = next.windowDuration / next.windowBuckets;
            _spendWindow[asset]
            .configure(duration == 0 ? 1 : duration, next.windowBuckets, uint32(block.timestamp));
        }
    }
}
