# dreamDEX Perps Shield

Work for the [dreamDEX Perps Builder Bounty](https://dorahacks.io/hackathon/dreamdex-perps-bounty) on the Somnia Hideki (Tokyo) testnet, chain 50383.

## Feedback

Each issue found while building on the dreamDEX Perps API, SDK and app is one file in [`feedback/`](feedback), with steps to reproduce, expected and actual behaviour, and on-chain evidence.

| # | Issue | Severity | Area |
| --- | --- | --- | --- |
| 001 | [Withdraw shows "Chain: Hideki Testnet" but delivers the STT on Somnia Shannon](feedback/001-withdraw-says-hideki-but-delivers-on-shannon.md) | major | app |
| 002 | ["Link a bot" refuses a contract address, so on-chain automation cannot trade a user's account](feedback/002-link-a-bot-refuses-contract-operators.md) | major | app |
| 003 | [An unlinked operator gets `OnlyApprovedContracts`, which is undocumented and points the wrong way](feedback/003-unlinked-operator-gets-onlyapprovedcontracts.md) | normal | contracts |
| 004 | [USDso cannot be bridged from Shannon to Hideki: every transfer reverts inside the router's hook](feedback/004-usdso-bridge-shannon-to-hideki-reverts.md) | major | contracts |
| 005 | [`getPerpVoucherEligibility` says "eligible", but `claimPerpVoucher` always reverts with an undecodable error](feedback/005-voucher-eligibility-says-eligible-but-claim-reverts.md) | major | sdk |

## MVP

In progress: [`PerpsShield`](contracts/PerpsShield.sol), a perps position guard on Hideki that is woken by Somnia Reactivity and acts on margin health, so it keeps working when no bot process is running.

The shield holds the position on its own MarginBank account. Every `intervalSec` the chain wakes it through a one-shot `Schedule` subscription that the shield re-arms itself. On each wake it reads `getAccountHealth`, and when equity falls under `triggerBps` of the maintenance requirement it cuts `trimBps` of the position with an immediate-or-cancel order before the liquidation engine reaches it. Anyone can call `check()`, which can only ever reduce the position. Only the owner can trade, change settings or take money out.

**Your wallet keeps the money.** The shield is a linked child of the owner's wallet on dreamDEX's linked-wallet rail: the wallet proposes the link, the shield accepts it with `linkMain`, and from then on each order the shield places draws its margin shortfall from the wallet. The MarginBank books that as the wallet's claim, so the shield can trade it but can never withdraw it, and the wallet can recall it at any time. `depositMargin` is there for a shield funded directly instead.

**Strangers cannot drain the wake loop.** Anyone can point their own Reactivity subscription at a handler contract. The shield only acts on a `Schedule` wake from the precompile stamped at or after the time it booked last, and each accepted wake books the next one later than anything pending, so extra subscriptions cannot multiply the loop. `test/wake-guard.mjs` checks this against the deployed shield by simulating callbacks from the precompile address.

The current shield is `0xd4ac1ebfcd5446c7bf768c566888cedf40180f8f`, linked to its owner `0x29FD4dDD9793e83fe216c398a2e81BF9Cd82FB41` (`quotePerpFundingPayer` returns that wallet as payer). Its wake loop ran on Hideki three times, 30 seconds apart, at about 0.002 STT a wake: `0xe012707f059c981ee1f378321c8b69ceac2c684edfe5896c0096bc152b415c70`, `0x26c1099c218465b536fc03f017f091841d91b24684cfd7c2cc90835caa2bd419`, `0x63e626f09a38864f8b52481a266d1a6f9f01bf534fa69b948956c71d4ebf5557`. It is disarmed until it holds a position: the USDso to fund one is held up by [004](feedback/004-usdso-bridge-shannon-to-hideki-reverts.md) and [005](feedback/005-voucher-eligibility-says-eligible-but-claim-reverts.md).

## Scripts

`scripts/bridge-stt-to-hideki.mjs` moves a wallet's STT (or USDso, with `--token USDso`) from Somnia Shannon to Hideki through the Somnia Markets SDK bridge. It runs as a dry run, with a destination-liquidity check, unless you pass `--send`.

```bash
npm install
cp .env.example .env   # then set PRIVATE_KEY to a testnet-only key
node scripts/bridge-stt-to-hideki.mjs 10          # dry run
node scripts/bridge-stt-to-hideki.mjs 10 --send   # bridge 10 STT
```

`scripts/compile.mjs` compiles `contracts/*.sol` with solcjs into `artifacts/`, and `scripts/deploy.mjs <Name>` deploys one to Hideki with the `.env` key.

`scripts/probe-contract-caller.mjs` and `scripts/probe-contract-own-account.mjs` are the read-only checks behind feedback 002 and 003, and `scripts/probe-voucher-claim.mjs` is the one behind 005. They use `eth_call` and send nothing.

`scripts/shield.mjs` drives a PerpsShield with the `.env` key as owner: `deploy`, `status`, `fund <stt>`, `link [allowance]`, `unlink`, `deposit <usdso>`, `open <long|short> <usd>`, `settings <trigger> <trim> <slippage> <interval>`, `arm`, `disarm`, `check` and `close`.
