// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IMarginBank {
    struct Position {
        int128 size;
        uint128 avgEntryPrice;
        int256 entryFundingIndex;
        uint64 lastUpdatedTimestampNs;
    }

    function getAccountHealth(address account) external view returns (int256 equity, uint256 imReq, uint256 mmReq, uint256 cmReq);
    function getPosition(address account, address perpPool) external view returns (Position memory);
    function getCreditGranter() external view returns (address);
    function withdraw(uint256 amount) external;
}

interface IPerpPool {
    function placeOrder(
        bool isBid,
        uint64 userData,
        uint256 price,
        uint256 quantity,
        uint64 expireTimestampNs,
        uint8 orderType,
        uint8 selfMatchingOption,
        address builder,
        uint96 builderFeeBpsTimes1k
    ) external;
    function cancelOrder(uint128 orderId) external;
    function tryGetMarkPrice() external view returns (bool ok, uint256 price);
}

interface IVoucherDistributor {
    function claim() external;
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @notice The Somnia on-chain reactivity precompile at 0x0100.
interface ISomniaReactivity {
    struct SubscriptionData {
        bytes32[4] eventTopics;
        address origin;
        address caller;
        address emitter;
        address handlerContractAddress;
        bytes4 handlerFunctionSelector;
        uint64 priorityFeePerGas;
        uint64 maxFeePerGas;
        uint64 gasLimit;
        bool isGuaranteed;
        bool isCoalesced;
    }

    function subscribe(SubscriptionData calldata subscriptionData) external returns (uint256 subscriptionId);
}

/// @title PerpsShield
/// @notice Holds one dreamDEX perps position on its own account and guards it on margin
///         health. Somnia Reactivity wakes it on a timer it re-arms itself, so the guard
///         keeps working when no bot process is running. When equity falls under a set
///         multiple of the maintenance requirement, it trims the position with a market
///         order before the liquidation engine gets to it.
/// @dev Only the owner can trade, change settings or take money out. Anyone may call
///      `check()`, which can only ever reduce the position.
contract PerpsShield {
    address internal constant SOMNIA_REACTIVITY = 0x0000000000000000000000000000000000000100;
    /// @dev topic0 of the precompile's Schedule(uint256 indexed timestampMillis).
    bytes32 internal constant TOPIC_SCHEDULE = 0x67aa3d752967d87d8944b9c7adf73172518777fa4703f336edee81f0736d8987;
    uint8 internal constant ORDER_IOC = 2;

    address public immutable owner;
    IPerpPool public immutable pool;
    IMarginBank public immutable bank;
    IERC20 public immutable collateral;
    uint256 public immutable tickSize;
    uint256 public immutable lotSize;
    uint256 public immutable minQuantity;

    /// @notice Trim when equity is below this multiple of the maintenance requirement, in bps.
    uint256 public triggerBps = 15_000;
    /// @notice Share of the position to cut on each trim, in bps.
    uint256 public trimBps = 5_000;
    /// @notice How far through the mark a trim may fill, in bps.
    uint256 public slippageBps = 200;
    /// @notice Seconds between wake-ups while armed.
    uint256 public intervalSec = 30;
    /// @notice Gas the chain may spend on one wake. A trim is a market order, which can walk the book.
    uint64 public wakeGasLimit = 6_000_000;

    bool public armed;
    uint256 public wakes;
    uint256 public trims;
    uint256 public nextWakeMs;
    uint256 public lastTrimAt;

    event Checked(uint256 indexed wake, int256 equity, uint256 mmReq, uint256 healthBps, int128 size);
    event Trimmed(uint256 indexed wake, bool sold, uint256 quantity, uint256 price, uint256 healthBps);
    event TrimFailed(uint256 indexed wake, bytes reason);
    event GuardFailed(bytes reason);
    event Armed(uint256 nextWakeMs, uint256 subscriptionId);
    event ArmFailed(uint256 nextWakeMs, bytes reason);
    event Disarmed();
    event SettingsChanged(uint256 triggerBps, uint256 trimBps, uint256 slippageBps, uint256 intervalSec, uint64 wakeGasLimit);

    error NotOwner();
    error NotReactivity(address caller);
    error NotSelf();
    error BadSetting();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address owner_, IPerpPool pool_, IMarginBank bank_, IERC20 collateral_, uint256 tickSize_, uint256 lotSize_, uint256 minQuantity_) {
        owner = owner_;
        pool = pool_;
        bank = bank_;
        collateral = collateral_;
        tickSize = tickSize_;
        lotSize = lotSize_;
        minQuantity = minQuantity_;
    }

    /// @notice Pays for wake-ups. A contract that owns a subscription must hold at least 32 STT.
    receive() external payable {}

    // ---------------------------------------------------------------- owner

    /// @notice Claim this account's one-time dreamDEX credit voucher into its MarginBank balance.
    function claimVoucher() external onlyOwner {
        IVoucherDistributor(bank.getCreditGranter()).claim();
    }

    /// @notice Place an order on this account. Opening and adding to the position is owner-only.
    function placeOrder(bool isBid, uint256 price, uint256 quantity, uint8 orderType) external onlyOwner {
        pool.placeOrder(isBid, 0, price, quantity, _expiryNs(), orderType, 0, address(0), 0);
    }

    function cancelOrder(uint128 orderId) external onlyOwner {
        pool.cancelOrder(orderId);
    }

    function setSettings(uint256 triggerBps_, uint256 trimBps_, uint256 slippageBps_, uint256 intervalSec_, uint64 wakeGasLimit_)
        external
        onlyOwner
    {
        if (triggerBps_ < 10_000 || trimBps_ == 0 || trimBps_ > 10_000 || slippageBps_ > 2_000 || intervalSec_ < 2) revert BadSetting();
        if (wakeGasLimit_ == 0 || wakeGasLimit_ > 200_000_000) revert BadSetting();
        triggerBps = triggerBps_;
        trimBps = trimBps_;
        slippageBps = slippageBps_;
        intervalSec = intervalSec_;
        wakeGasLimit = wakeGasLimit_;
        emit SettingsChanged(triggerBps_, trimBps_, slippageBps_, intervalSec_, wakeGasLimit_);
    }

    /// @notice Start the wake-up loop. The contract owns the subscription and pays for it.
    function arm() external onlyOwner {
        armed = true;
        _scheduleNext();
    }

    /// @notice Stop re-arming. A wake already scheduled still arrives once and does nothing.
    function disarm() external onlyOwner {
        armed = false;
        emit Disarmed();
    }

    /// @notice Move collateral above the voucher floor out of the MarginBank to the owner.
    function withdraw(uint256 amount) external onlyOwner {
        bank.withdraw(amount);
        if (!collateral.transfer(owner, collateral.balanceOf(address(this)))) revert TransferFailed();
    }

    function withdrawNative(uint256 amount) external onlyOwner {
        (bool ok,) = owner.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------------------------------------------------------------- guard

    /// @notice Run the guard now. Open to anyone: it can only cut the position, never grow it.
    function check() external {
        _guard();
    }

    /// @notice Called by the chain when a scheduled wake fires.
    /// @dev The guard runs in its own frame so a revert inside it, such as a dead oracle,
    ///      cannot undo the re-arm and end the loop.
    function onEvent(address, bytes32[] calldata, bytes calldata) external {
        if (msg.sender != SOMNIA_REACTIVITY) revert NotReactivity(msg.sender);
        if (armed) _scheduleNext();
        try this.guardFromWake() {}
        catch (bytes memory reason) {
            emit GuardFailed(reason);
        }
    }

    /// @dev Only reachable from onEvent, through the external call above.
    function guardFromWake() external {
        if (msg.sender != address(this)) revert NotSelf();
        _guard();
    }

    /// @notice Equity as a multiple of the maintenance requirement, in bps. Max uint when flat.
    function healthBps() public view returns (uint256 bps, int256 equity, uint256 mmReq) {
        (equity,, mmReq,) = bank.getAccountHealth(address(this));
        if (mmReq == 0) return (type(uint256).max, equity, mmReq);
        if (equity <= 0) return (0, equity, mmReq);
        return ((uint256(equity) * 10_000) / mmReq, equity, mmReq);
    }

    function _guard() internal {
        uint256 wake = ++wakes;
        int128 size = bank.getPosition(address(this), address(pool)).size;
        (uint256 bps, int256 equity, uint256 mmReq) = healthBps();
        emit Checked(wake, equity, mmReq, bps, size);
        if (size == 0 || bps >= triggerBps) return;
        // One trim per interval, so repeated public calls cannot walk the position to zero.
        if (lastTrimAt != 0 && block.timestamp < lastTrimAt + intervalSec) return;

        (bool ok, uint256 mark) = pool.tryGetMarkPrice();
        if (!ok || mark == 0) {
            emit TrimFailed(wake, "stale mark");
            return;
        }

        bool isLong = size > 0;
        uint256 abs = isLong ? uint256(int256(size)) : uint256(-int256(size));
        uint256 qty = ((abs * trimBps) / 10_000 / lotSize) * lotSize;
        // Never leave a remainder the pool would refuse to close later.
        if (qty < minQuantity || abs - qty < minQuantity) qty = abs;

        // A long sells under the mark and a short buys over it, both on the tick grid.
        uint256 price = isLong
            ? ((mark * (10_000 - slippageBps)) / 10_000 / tickSize) * tickSize
            : (((mark * (10_000 + slippageBps)) / 10_000 + tickSize - 1) / tickSize) * tickSize;

        try pool.placeOrder(!isLong, 0, price, qty, _expiryNs(), ORDER_IOC, 0, address(0), 0) {
            trims++;
            lastTrimAt = block.timestamp;
            emit Trimmed(wake, isLong, qty, price, bps);
        } catch (bytes memory reason) {
            emit TrimFailed(wake, reason);
        }
    }

    function _scheduleNext() internal {
        uint256 at = (block.timestamp + intervalSec) * 1000;
        bytes32[4] memory topics;
        topics[0] = TOPIC_SCHEDULE;
        topics[1] = bytes32(at);
        nextWakeMs = at;
        // A failed re-arm (for example under the 32 STT floor) must not undo the guard's work.
        try ISomniaReactivity(SOMNIA_REACTIVITY).subscribe(
            ISomniaReactivity.SubscriptionData({
                eventTopics: topics,
                origin: address(0),
                caller: address(0),
                emitter: SOMNIA_REACTIVITY,
                handlerContractAddress: address(this),
                handlerFunctionSelector: this.onEvent.selector,
                priorityFeePerGas: 0,
                maxFeePerGas: 0,
                gasLimit: wakeGasLimit,
                isGuaranteed: false,
                isCoalesced: false
            })
        ) returns (uint256 id) {
            emit Armed(at, id);
        } catch (bytes memory reason) {
            emit ArmFailed(at, reason);
        }
    }

    function _expiryNs() internal view returns (uint64) {
        return uint64((block.timestamp + 300) * 1e9);
    }
}
