// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Feasibility probe: lets its deployer send one call through a contract,
/// so we can see whether a perp pool accepts placeOrderFor from a linked contract.
contract ProbeForwarder {
    address public immutable owner;

    constructor() {
        owner = msg.sender;
    }

    function forward(address target, bytes calldata data) external payable returns (bytes memory) {
        require(msg.sender == owner, "not owner");
        (bool ok, bytes memory ret) = target.call{value: msg.value}(data);
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        return ret;
    }
}
