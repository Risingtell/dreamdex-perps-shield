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

The wake loop is live on Hideki: shield `0x7d662c7bbff7aa9aaf20b036ebe6c53f6941e3e5` was woken four times, 20 seconds apart, at about 0.002 STT a wake (for example `0xcf58dfeb39cbb895e2a6743db6fb4eee1ad1416a4f109eaf662e35e5b51157f3`). It is disarmed until it holds a position: the USDso to fund one is held up by [004](feedback/004-usdso-bridge-shannon-to-hideki-reverts.md) and [005](feedback/005-voucher-eligibility-says-eligible-but-claim-reverts.md).

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

`scripts/shield.mjs` drives a PerpsShield with the `.env` key as owner: `deploy`, `status`, `fund <stt>`, `open <long|short> <usd>`, `settings <trigger> <trim> <slippage> <interval>`, `arm`, `disarm`, `check` and `close`.
