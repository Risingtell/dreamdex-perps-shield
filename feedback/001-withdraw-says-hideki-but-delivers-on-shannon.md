# Withdraw shows "Chain: Hideki Testnet" but delivers the STT on Somnia Shannon

Severity: major
Area: app

## Steps to reproduce
1. On app.testnet.dreamdex.io, sign in and open Portfolio, then Wallet, then **Withdraw**.
2. Set **Token** to `STT`. The form shows **Chain: Hideki Testnet** under the selector.
3. Enter an EOA as the recipient, an amount, and confirm.
4. Check the recipient's STT balance on Hideki (50383) and on Somnia Shannon (50312).

## Expected
The STT arrives on Hideki, the chain the form names, at the recipient address. Or, if
withdrawing is meant to leave Hideki, the form says the destination is Somnia Shannon
before the user signs.

## Actual
The amount leaves the Hideki account and arrives on **Shannon**, not Hideki. Nothing in
the form says so. The only hint appears afterwards, in Portfolio, then Deposits &
withdrawals, where the row's route reads "To Somnia". A bot or contract waiting for gas
on Hideki receives nothing, and the user has to bridge the coins back.

## Evidence
- Withdrawal 1: 7 STT, Shannon tx `0xaffbb835c28e425ac9379df47b6a888cacbebeae14b7c594df7a64501021f771`
- Withdrawal 2: 38 STT, Shannon tx `0x4fefaca3710595eae42605aa6fc6ad2b49612d8ca8108ef0838a2c9d1b0719f6`
- Neither hash exists on Hideki (`eth_getTransactionReceipt` returns null on
  `api.hideki2.infra.testnet.somnia.network`).
- After both: recipient held 0 STT on Hideki and 45 STT on Shannon. The sending account's
  Hideki balance fell by the same amounts (62.25 to 24.25 STT around the 38 STT withdrawal).
- Recovered with the SDK bridge (`createBridgeTransfer`, Shannon to Hideki), Shannon tx
  `0x7827cd30e302743c99e230d27c9728a5ece0b5737da32bad0c858b845a84d837`; 43 STT delivered on Hideki.

## Environment
dreamDEX testnet app, 22 Oct 2026, ~11:56 and 12:00 UTC+1. Hideki testnet (50383) and
Somnia Shannon testnet (50312). Account `0x3509c656303ce8c0f9cbd20d8114c196dbd7c843`,
recipient `0x29FD4dDD9793e83fe216c398a2e81BF9Cd82FB41`. Wallet: Zerion via Privy.
