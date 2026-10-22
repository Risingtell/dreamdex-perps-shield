# USDso cannot be bridged from Shannon to Hideki: every transfer reverts inside the router's hook

Severity: major
Area: contracts

## Steps to reproduce
1. Hold USDso on Somnia Shannon (50312) in a wallet with a little STT for gas.
2. Build the transfer with the SDK, exactly as `docs/BRIDGE.md` shows:
   ```ts
   const plan = createBridgeTransfer({ token: BridgeToken.USDso, from: ChainId.somniaShannon,
     to: ChainId.hidekiTestnet, amount: parseEther("100"), recipient });
   await sendBridgeStep(client, plan.approveStep, { account });
   await sendBridgeStep(client, plan.bridgeStep, { account });
   ```
3. Or simulate `plan.bridgeStep` with `eth_call` for any amount.

Script: `node scripts/bridge-stt-to-hideki.mjs 100 --token USDso --send`.

## Expected
The USDso is escrowed on Shannon and credited on Hideki a few seconds later, the same
as the STT route. `BRIDGE.md` says no gas paymaster is deployed and
`quoteGasPayment` is 0 on every router.

## Actual
The approval succeeds and the bridge call reverts with empty revert data. The SDK
reports only `"Bridge USDso from chain 50312 to chain 50383" reverted`.

The call trace shows where it fails. The router pulls the tokens and calls the
Mailbox, the Mailbox's required hook succeeds, and then the router's own hook reverts:

```
CALL         0x94e2…79e6 (USDso router)  transferRemote      REVERT 0x
  DELEGATECALL 0xbfa1…f2f8                transferRemote      REVERT 0x
    CALL       0x9c32…b171 (USDso)        transferFrom        ok
    CALL       0xf805…54f9 (Mailbox)      dispatch            REVERT 0x
      DELEGATECALL 0x6b8e…a864            dispatch            REVERT 0x
        CALL   0xa713…f87c (required hook) postDispatch       ok
        CALL   0xf11c…77de (router hook)   postDispatch       REVERT 0x
```

Only the USDso route has a hook set. Read on Shannon:

| Router | `hook()` | `quoteGasPayment(50383)` |
| --- | --- | --- |
| STT `0x67CD0778A719099DAF2D346aD0Db0d9E6FF6674C` | `0x0` | `0` |
| WBTC `0x888d8C8090b8cDcEa5d05b1C206c2bFF18cd2DA9` | `0x0` | `0` |
| USDso `0x94E2E7f4B2B0a8E3032c7D3ff3c86790BB5979E6` | `0xF11C364Da4B5e22b3040be8EA77DccDBfD1277De` | reverts |

Simulated amounts of 0.000001, 1, 10 and 50 USDso all revert, and attaching 0.001, 0.1
or 1 STT as `value` does not help. So a quote cannot be read and no payment gets through.
The route in the other direction works: the app's own USDso withdrawal crossed it
from Hideki to Shannon minutes earlier (see Evidence).

The result for a trader is that USDso which leaves Hideki cannot come back by the
documented route. A withdrawal from the app lands on Shannon (see
[001](001-withdraw-says-hideki-but-delivers-on-shannon.md)) and is then stuck there.
Hideki has no public faucet, so a bot or contract on Hideki has no other way to get
margin. If the hook is a deliberate gate, the SDK should check for it up front and say
why, rather than letting the user pay for an approval and a reverted transaction.

## Evidence
- Approval (success), Shannon: `0x2467b78c98ee4263598ca606383d89117619c75f6cf52b02235cc00b1d1c7fbe`
- Bridge (reverted, 213,551 gas used), Shannon: `0x4b9f52e28ffcc117bbd12d2e740d482937a733892bff02b965794cd955b12b2e`
- Trace from `debug_traceTransaction` with `callTracer` on `api.infra.testnet.somnia.network`.
- The reverse direction working: router `ReceivedTransferRemote` on Shannon at
  16:18:47 UTC (origin 50383, 100 USDso to the account's Shannon address
  `0x3509c656303ce8c0f9cbd20d8114c196dbd7c843`), tx
  `0x0578a8f84d56a8df58d6830916fcc6d66cc6376d5a776d52b7dd7221afbf7eb2`,
  followed 4 s later by the app forwarding the 100 USDso to the recipient,
  tx `0x4bf908f4015de0598a8fdaeff0b461708480a80f1a5990f4a329601bd9aac041`.
- Hook `0xF11C364Da4B5e22b3040be8EA77DccDBfD1277De` (2,577 bytes, owner
  `0xd088Cc0b128B283702b834CaEDC08E2c037cD758`) does not answer `hookType()`.

## Environment
Somnia Shannon (50312) to Hideki (50383), 22 Oct 2026, 16:21 UTC.
`@somnia-chain/markets-sdk` 0.32.1, viem 2.x, Node 24 on Windows 11.
Wallet `0x29FD4dDD9793e83fe216c398a2e81BF9Cd82FB41`.
