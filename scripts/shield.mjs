// Drives a PerpsShield on Hideki with the .env key, which is the shield's owner.
// Usage: node scripts/shield.mjs <command> [args]
//   deploy                         deploy a new shield for the BTC perp market
//   status                         position, health, settings, wake counters
//   claim                          claim the shield's one-time credit voucher
//   open <long|short> <usd>        market order for about <usd> of notional
//   settings <trigger> <trim> <slip> <interval> [gas]   bps, bps, bps, seconds
//   fund <stt>                     send STT to the shield to pay for wake-ups
//   arm | disarm | check           start or stop the wake loop, or run the guard once
//   close                          market-close the whole position
import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatEther, formatUnits, parseEther, parseEventLogs, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";

const BTC_POOL = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
const MARGIN_BANK = "0x478769e1177c0773c43a593dccc4ad15f15f1394";
const USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72";
// Read from the indexed market row on 22 Oct 2026: price 18 dp, quantity 8 dp.
const TICK = 10n ** 17n;
const LOT = 1000n;
const MIN_QTY = 13000n;
const ORDER_IOC = 2;
const poolAbi = parseAbi(["function tryGetMarkPrice() view returns (bool ok, uint256 price)"]);
const bankAbi = parseAbi(["struct Position { int128 size; uint128 avgEntryPrice; int256 entryFundingIndex; uint64 lastUpdatedTimestampNs; }", "function getPosition(address account, address perpPool) view returns (Position)"]);

const { abi, bytecode } = JSON.parse(readFileSync("artifacts/PerpsShield.json", "utf8"));
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const pc = createPublicClient({ chain: hidekiTestnet, transport: http() });
const wallet = createWalletClient({ account, chain: hidekiTestnet, transport: http() });
const DEPLOYMENT = "deployments/PerpsShield.json";

const [cmd, ...args] = process.argv.slice(2);
const shield = () => {
  if (!existsSync(DEPLOYMENT)) throw new Error("no shield deployed yet: run deploy first");
  return JSON.parse(readFileSync(DEPLOYMENT, "utf8")).address;
};
const read = (functionName, a = []) => pc.readContract({ address: shield(), abi, functionName, args: a });

async function send(functionName, a = [], opts = {}) {
  const hash = await wallet.writeContract({ address: shield(), abi, functionName, args: a, ...opts });
  const receipt = await pc.waitForTransactionReceipt({ hash });
  console.log(functionName, receipt.status, hash, "gas", receipt.gasUsed);
  for (const log of parseEventLogs({ abi, logs: receipt.logs })) console.log("  event", log.eventName, fmtArgs(log.args));
  if (receipt.status !== "success") process.exit(1);
  return receipt;
}

const fmtArgs = (o) => JSON.stringify(o, (k, v) => (typeof v === "bigint" ? v.toString() : v));

async function mark() {
  const [ok, price] = await pc.readContract({ address: BTC_POOL, abi: poolAbi, functionName: "tryGetMarkPrice" });
  if (!ok) throw new Error("mark price is stale");
  return price;
}

switch (cmd) {
  case "deploy": {
    const hash = await wallet.deployContract({ abi, bytecode, args: [account.address, BTC_POOL, MARGIN_BANK, USDSO, TICK, LOT, MIN_QTY] });
    const receipt = await pc.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`deploy reverted: ${hash}`);
    mkdirSync("deployments", { recursive: true });
    writeFileSync(DEPLOYMENT, JSON.stringify({ address: receipt.contractAddress, tx: hash, owner: account.address, chainId: hidekiTestnet.id }, null, 2));
    console.log("PerpsShield deployed at", receipt.contractAddress, "tx", hash);
    break;
  }
  case "status": {
    const s = shield();
    const pos = await pc.readContract({ address: MARGIN_BANK, abi: bankAbi, functionName: "getPosition", args: [s, BTC_POOL] });
    const [bps, equity, mmReq] = await read("healthBps");
    const names = ["armed", "triggerBps", "trimBps", "slippageBps", "intervalSec", "wakeGasLimit", "wakes", "trims", "nextWakeMs"];
    const vals = await Promise.all(names.map((n) => read(n)));
    console.log("shield     ", s);
    console.log("STT        ", formatEther(await pc.getBalance({ address: s })));
    console.log("position   ", formatUnits(pos.size, 8), "BTC @", formatEther(pos.avgEntryPrice));
    console.log("mark       ", formatEther(await mark()));
    console.log("equity     ", formatEther(equity), "USDso | maintenance", formatEther(mmReq));
    console.log("health     ", bps === 2n ** 256n - 1n ? "flat" : `${Number(bps) / 100}% of maintenance`);
    names.forEach((n, i) => console.log(n.padEnd(11), String(vals[i])));
    break;
  }
  case "claim":
    await send("claimVoucher");
    break;
  case "open": {
    const [side, usd] = args;
    const isBid = side === "long";
    const m = await mark();
    // quantity (8 dp) = usd / price, rounded down to the lot and kept above the minimum.
    let qty = ((parseEther(usd) * 10n ** 8n) / m / LOT) * LOT;
    if (qty < MIN_QTY) qty = MIN_QTY;
    const price = isBid ? (((m * 10_200n) / 10_000n + TICK - 1n) / TICK) * TICK : ((m * 9_800n) / 10_000n / TICK) * TICK;
    console.log(side, formatUnits(qty, 8), "BTC, limit", formatEther(price));
    await send("placeOrder", [isBid, price, qty, ORDER_IOC]);
    break;
  }
  case "close": {
    const { size } = await pc.readContract({ address: MARGIN_BANK, abi: bankAbi, functionName: "getPosition", args: [shield(), BTC_POOL] });
    if (size === 0n) { console.log("already flat"); break; }
    const m = await mark();
    const isBid = size < 0n;
    const price = isBid ? (((m * 10_200n) / 10_000n + TICK - 1n) / TICK) * TICK : ((m * 9_800n) / 10_000n / TICK) * TICK;
    await send("placeOrder", [isBid, price, size < 0n ? -size : size, ORDER_IOC]);
    break;
  }
  case "settings": {
    const [trigger, trim, slip, interval, gas] = args;
    const current = await read("wakeGasLimit");
    await send("setSettings", [BigInt(trigger), BigInt(trim), BigInt(slip), BigInt(interval), gas ? BigInt(gas) : current]);
    break;
  }
  case "fund": {
    const hash = await wallet.sendTransaction({ to: shield(), value: parseEther(args[0]) });
    console.log("fund", (await pc.waitForTransactionReceipt({ hash })).status, hash);
    break;
  }
  case "arm":
  case "disarm":
  case "check":
    await send(cmd);
    break;
  default:
    console.log("commands: deploy status claim open close settings fund arm disarm check");
}
