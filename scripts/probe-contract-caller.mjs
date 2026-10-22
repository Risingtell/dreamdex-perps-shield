// Read-only probe: does a perp pool treat a CONTRACT caller of placeOrderFor
// differently from an EOA caller? Uses eth_call only; sends nothing.
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, contractErrorsAbi } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, http, parseAbi, BaseError, ContractFunctionRevertedError } from "viem";

const OWNER = "0x3509c656303ce8c0f9cbd20d8114c196dbd7c843";
const exchange = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.hideki2.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
  account: OWNER,
});
const markets = await exchange.loadMarkets();
const perps = Object.values(markets).filter((m) => m.type === "swap" || m.info?.marketType === "perp" || /PERP/.test(m.symbol));
for (const m of perps.slice(0, 12)) {
  const i = m.info ?? {};
  console.log(m.symbol, "pool", i.poolAddress ?? i.pool ?? i.address, "marginBank", i.marginBank, "stopRegistry", i.stopRegistry);
}
const btc = perps.find((m) => /^BTC/.test(m.symbol));
const pool = btc.info.poolAddress ?? btc.info.pool ?? btc.info.address;
const client = createPublicClient({ chain: hidekiTestnet, transport: http() });
const abi = [...parseAbi([
  "function placeOrderFor(address owner, bool isBid, uint64 userData, uint256 price, uint256 quantity, uint64 expireTimestampNs, uint8 orderType, uint8 selfMatchingOption, address builder, uint96 builderFeeBpsTimes1k) payable returns (bool success, uint128 orderId)",
  "function isOperatorAuthorized(address owner, address operator, bytes4 selector) view returns (bool)",
]), ...contractErrorsAbi];
const callers = {
  "EOA (build wallet, not linked)": "0x29FD4dDD9793e83fe216c398a2e81BF9Cd82FB41",
  "contract (Multicall3)": "0xcA11bde05977b3631167028862bE2a173976CA11",
};
for (const [label, from] of Object.entries(callers)) {
  const auth = await client.readContract({ address: pool, abi, functionName: "isOperatorAuthorized", args: [OWNER, from, "0x80054449"] });
  try {
    await client.simulateContract({ address: pool, abi, functionName: "placeOrderFor", account: from, gas: 10_000_000n,
      args: [OWNER, true, 0n, 1n, 1n, 0n, 0, 0, "0x0000000000000000000000000000000000000000", 0n] });
    console.log(label, "authorized:", auth, "-> simulation PASSED");
  } catch (e) {
    const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
    console.log(label, "authorized:", auth, "-> reverts", r?.data?.errorName ?? r?.reason ?? e.shortMessage);
  }
}
process.exit(0);
