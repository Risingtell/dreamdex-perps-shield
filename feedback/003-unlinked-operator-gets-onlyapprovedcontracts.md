# An unlinked operator calling placeOrderFor gets `OnlyApprovedContracts`, which is undocumented and points the wrong way

Severity: normal
Area: contracts

## Steps to reproduce
1. Take any address that has **not** been linked as a bot for an account. We used the
   EOA `0x29FD4dDD9793e83fe216c398a2e81BF9Cd82FB41` and, as a contract caller, Multicall3
   at `0xcA11bde05977b3631167028862bE2a173976CA11`.
2. Confirm it is not authorized: `isOperatorAuthorized(owner, caller, 0x80054449)` on
   the BTC perp pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0` returns `false`.
3. From that address, simulate `placeOrderFor(owner, ...)` on the same pool, decoding the
   revert with the SDK's `contractErrorsAbi`.

Script: `scripts/probe-contract-caller.mjs` (eth_call only, sends nothing).

## Expected
A revert that says the caller is not an authorized operator for this owner, such as one
of the names the SDK error reference lists under "Operators and venues"
(`InsufficientPermission`, `Unauthorized`, `UnknownOperator`). Ideally the error
carries the owner, the caller and the selector.

## Actual
Both callers, the EOA and the contract, revert with `OnlyApprovedContracts`:

```
EOA (build wallet, not linked) authorized: false -> reverts OnlyApprovedContracts
contract (Multicall3) authorized: false -> reverts OnlyApprovedContracts
```

The name says the caller must be an approved *contract*. A bot developer whose trading
key was never linked, or was linked for a different account, reads it as "EOAs are not
allowed" or "my contract is not whitelisted" and starts debugging the wrong thing. The
real fix is to link the key with **Link a bot**.

`OnlyApprovedContracts` is not mentioned anywhere in the SDK docs. `docs/reference/errors.md`
lists the operator errors a developer should expect, and this one is not among them.
It only appears in the generated `contractErrorsAbi`.

## Evidence
- Probe output above, rerun 22 Oct 2026 against Hideki.
- `grep -rn OnlyApprovedContracts node_modules/@somnia-chain/markets-sdk/docs` returns
  nothing; the name appears only in the generated `contractErrorsAbi` (`src/` and `dist/`).
- Owner used: `0x3509c656303ce8c0f9cbd20d8114c196dbd7c843`.

## Environment
Hideki testnet (50383), RPC `https://api.hideki2.infra.testnet.somnia.network`.
`@somnia-chain/markets-sdk` 0.32.1, viem 2.x, Node on Windows 11. 22 Oct 2026.
