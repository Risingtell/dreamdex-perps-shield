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

## MVP

In progress: a perps position guard on Hideki that is woken by Somnia Reactivity and acts on margin health, so it keeps working when no bot process is running.

## Scripts

`scripts/bridge-stt-to-hideki.mjs` moves a wallet's STT (or USDso, with `--token USDso`) from Somnia Shannon to Hideki through the Somnia Markets SDK bridge. It runs as a dry run, with a destination-liquidity check, unless you pass `--send`.

```bash
npm install
cp .env.example .env   # then set PRIVATE_KEY to a testnet-only key
node scripts/bridge-stt-to-hideki.mjs 10          # dry run
node scripts/bridge-stt-to-hideki.mjs 10 --send   # bridge 10 STT
```

`scripts/compile.mjs` compiles `contracts/*.sol` with solcjs into `artifacts/`, and `scripts/deploy.mjs <Name>` deploys one to Hideki with the `.env` key.

`scripts/probe-contract-caller.mjs` and `scripts/probe-contract-own-account.mjs` are the read-only checks behind feedback 002 and 003. They simulate orders with `eth_call` and send nothing.
