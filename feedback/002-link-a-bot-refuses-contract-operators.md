# "Link a bot" refuses a contract address, so on-chain automation cannot trade a user's account

Severity: major
Area: app

## Steps to reproduce
1. Deploy any contract on Hideki (50383). We used a minimal forwarder,
   `ProbeForwarder` at `0x214b1E0E7EcC3339c7eb2C9a92968006552506B3`, whose owner can send
   one call through it.
2. On app.testnet.dreamdex.io, sign in and open **Link a bot**.
3. Paste the contract address as the bot address. Keep **Perps** ticked and untick
   "Send it 5 STT for gas".
4. Try to continue.

## Expected
The contract is linked as an operator for `placeOrderFor`, `cancelOrderFor` and
`reduceOrderFor`, the same as an EOA trading key. Operator rights never include
withdrawal, so a contract operator is no riskier than a key. A contract is the natural
operator on Somnia: a Reactivity handler (`SomniaEventHandler.onEvent`) or a Somnia
Agent runs as a contract, and is woken by the chain without a server.

## Actual
The form rejects the address with:

> That address is a contract. Enter the address your bot trades from.

Nothing is linked, so a contract cannot place, cancel or reduce orders for the user. The
only way for on-chain automation to manage a perps position is to hold the margin
itself: the user moves funds into the contract and the contract trades its own account.
We confirmed that works: `placeOrder` sent through the forwarder and the same order from
an EOA both reach the same margin check (`ERC20: insufficient allowance` with no margin
deposited), and neither hits an authorization error. That workaround turns a
non-custodial guard into a custodial one.

This blocks the most Somnia-native use of the perps API, for example a
liquidation guard that Reactivity wakes on every mark-price update, from working on
a user's existing account.

## Evidence
- App error text as quoted above, shown for `0x214b1E0E7EcC3339c7eb2C9a92968006552506B3`.
- The contract's deploy tx on Hideki:
  `0x2a2974823fca6ea5d6f387ce396e64c7ef658fa782d01d4b2a28d2c194ea77b0`.
- After the attempt, `isOperatorAuthorized(0x3509c656303ce8c0f9cbd20d8114c196dbd7c843,
  0x214b1E0E7EcC3339c7eb2C9a92968006552506B3, 0x80054449)` on the BTC perp pool
  `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0` returns `false`.
- Script for the own-account comparison: `scripts/probe-contract-own-account.mjs`
  (simulation only, sends nothing).
- Not tested: whether the OperatorPermissionsRegistry contract itself also refuses a
  contract operator, or only the app form does. Its write ABI is not in
  `@somnia-chain/markets-sdk` 0.32.1.

## Environment
dreamDEX testnet app, 22 Oct 2026. Hideki testnet (50383). Account
`0x3509c656303ce8c0f9cbd20d8114c196dbd7c843`, wallet Zerion via Privy.
`@somnia-chain/markets-sdk` 0.32.1, viem 2.x, Node on Windows 11.
