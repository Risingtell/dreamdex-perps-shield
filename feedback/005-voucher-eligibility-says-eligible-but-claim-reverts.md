# `getPerpVoucherEligibility` says "eligible", but `claimPerpVoucher` always reverts with an undecodable error

Severity: major
Area: sdk

## Steps to reproduce
1. Take any address that has never claimed a credit voucher on the Hideki BTC/ETH
   MarginBank `0x478769e1177c0773c43a593dccc4ad15f15f1394`. We used the EOA
   `0x29FD4dDD9793e83fe216c398a2e81BF9Cd82FB41` and two of our contracts,
   `0x7d662c7bbff7aa9aaf20b036ebe6c53f6941e3e5` and `0x214b1E0E7EcC3339c7eb2C9a92968006552506B3`.
2. Follow `docs/PERPS.md` "Credit vouchers": call
   `client.getPerpVoucherEligibility(marginBank, account)`, and since it says
   `eligible: true`, call `trader.claimPerpVoucher({ marginBank })`.

Script: `node scripts/probe-voucher-claim.mjs` (eth_call only, sends nothing).

## Expected
Either the claim credits the 1,000 USDso grant, or the eligibility read returns
`eligible: false` with a reason, as the docs promise: "Check eligibility before you
claim. A failed claim still mines and costs gas."

## Actual
The eligibility read says yes and the claim reverts, for every caller we tried:

```
distributor 0x2ACD9EFdA721450906bfE1bef3edE269636E42C4 | window 1790553600 to 1798477478 | now 1792687319 | claims left 404164
build wallet (EOA)         eligible: true  | claim() reverts 0x3e31dcc2 (contractErrorsAbi: unknown)
PerpsShield (contract)     eligible: true  | claim() reverts 0x3e31dcc2 (contractErrorsAbi: unknown)
ProbeForwarder (contract)  eligible: true  | claim() reverts 0x3e31dcc2 (contractErrorsAbi: unknown)
```

`0x3e31dcc2` is not in the SDK's `contractErrorsAbi`, and public signature databases do not
know it either, so the SDK raises an unnamed revert and the developer has no reason to act on.
The campaign is live, inside its window, and has budget left.

Vouchers are still being granted, just not through `claim()`. The "claims left" counter
fell by 24 in about ten minutes while we watched. Every grant we sampled was sent by the
EOA `0x792182e6b2bd50deb22dc5436f7c518b34f9bd12`, calling `grantTo(address[])`
(selector `0x0677d0a3`) on the distributor for 12 accounts at a time. Example:
`0xc752103f6b9dc3fce0108b1710918ebc512a4468f97d0ffa5a3f91fae4c70cf5` (Hideki block 30352767).

So the self-serve `claim()` that the SDK wraps appears to be switched off on this
distributor, and grants are pushed by an operator instead. That may be deliberate. But the
SDK does not know it:

- `getPerpVoucherEligibility` does not read whatever gate `claim()` checks, so it returns
  `eligible: true` for an address that can never claim.
- `claimPerpVoucher` and `buildClaimPerpVoucher` produce a call that always reverts.
- The reason list (`dormant`, `notStarted`, `ended`, `notFlat`, `mainFunded`,
  `alreadyClaimed`, `budgetExhausted`) has no entry for "self-claim disabled" or
  "operator grants only".

A bot or agent account that follows the docs pays gas for a reverted claim and cannot tell
why. Accounts created outside the app, such as a bot's own key or a contract, have no
documented way to receive the grant.

## Suggested fix
Have `getPerpVoucherEligibility` read the distributor's self-claim switch and return a new
reason (for example `"operatorOnly"`). Add `0x3e31dcc2` to `contractErrorsAbi` under its real
name. In `docs/PERPS.md`, say how a non-app account gets a voucher, or that it cannot.

## Environment
- Somnia Hideki testnet (chain 50383), 22 Oct 2026, around 16:40 UTC
- `@somnia-chain/markets-sdk` 0.32.1, viem 2.57.10, Node 24
- Distributor proxy `0x2ACD9EFdA721450906bfE1bef3edE269636E42C4`, implementation
  `0x9657f0fd53efc01cd108d93c835bb4b517732b43`
