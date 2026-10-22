// Read-only probe: may a CONTRACT trade its OWN perps account (placeOrder, not
// placeOrderFor)? Simulates the same order from the build wallet directly and
// through ProbeForwarder, and compares the revert reasons. Sends nothing.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, contractErrorsAbi, perpPoolWriteAbi } from "@somnia-chain/markets-sdk";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { createPublicClient, http, encodeFunctionData, BaseError, ContractFunctionRevertedError } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const fwd = JSON.parse(readFileSync("deployments/ProbeForwarder.json", "utf8")).address;
const fwdAbi = JSON.parse(readFileSync("artifacts/ProbeForwarder.json", "utf8")).abi;
const exchange = new SomniaMarkets({
  chain: hidekiTestnet,
  indexerUrl: "https://hideki-dev.smk.somnia.host/v1/graphql",
  wsRpcUrl: "wss://api.hideki2.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
  account: account.address,
});
const markets = await exchange.loadMarkets();
const btc = Object.values(markets).find((m) => /^BTC\//.test(m.symbol) && m.info?.marginBank);
const pool = btc.info.poolAddress ?? btc.info.pool ?? btc.info.address;
console.log("market", btc.symbol, "pool", pool);
const client = createPublicClient({ chain: hidekiTestnet, transport: http() });
const abi = [...perpPoolWriteAbi, ...contractErrorsAbi];
const far = BigInt(Math.floor(Date.now() / 1000) + 86400) * 1_000_000_000n;
const order = encodeFunctionData({ abi: perpPoolWriteAbi, functionName: "placeOrder",
  args: [true, 0n, 50000n * 10n ** 18n, 13000n, far, 0, 0, "0x0000000000000000000000000000000000000000", 0n] });

const why = (e) => {
  const r = e instanceof BaseError ? e.walk((x) => x instanceof ContractFunctionRevertedError) : null;
  return r?.data?.errorName ?? r?.reason ?? e.shortMessage;
};
try {
  await client.simulateContract({ address: pool, abi, functionName: "placeOrder", args: [true, 0n, 50000n * 10n ** 18n, 13000n, far, 0, 0, "0x0000000000000000000000000000000000000000", 0n], account, gas: 10_000_000n });
  console.log("EOA placeOrder        -> PASSED");
} catch (e) { console.log("EOA placeOrder        -> reverts", why(e), "|", e.cause?.data ?? e.data ?? ""); }
try {
  await client.simulateContract({ address: fwd, abi: [...fwdAbi, ...contractErrorsAbi], functionName: "forward", args: [pool, order], account, gas: 10_000_000n });
  console.log("contract placeOrder   -> PASSED");
} catch (e) { console.log("contract placeOrder   -> reverts", why(e)); }
