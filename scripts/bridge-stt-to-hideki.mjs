// Moves the build wallet's STT from Somnia Shannon (50312) to Hideki (50383).
// Usage: node scripts/bridge-stt-to-hideki.mjs <amountSTT> [--send]
import "dotenv/config";
import { createPublicClient, http, parseEther, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon, hidekiTestnet, createBridgeTransfer, sendBridgeStep, BridgeToken, ChainId } from "@somnia-chain/markets-sdk/chains";

const amount = parseEther(process.argv[2] ?? "0");
const send = process.argv.includes("--send");
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const shannon = createPublicClient({ chain: somniaShannon, transport: http() });
const hideki = createPublicClient({ chain: hidekiTestnet, transport: http() });

const plan = createBridgeTransfer({
  token: BridgeToken.STT,
  from: ChainId.somniaShannon,
  to: ChainId.hidekiTestnet,
  amount,
  recipient: account.address,
});
const liquidity = await hideki.getBalance({ address: plan.destination.router });
console.log("wallet           ", account.address);
console.log("shannon balance  ", formatEther(await shannon.getBalance({ address: account.address })));
console.log("hideki balance   ", formatEther(await hideki.getBalance({ address: account.address })));
console.log("hideki router    ", plan.destination.router, "holds", formatEther(liquidity), "STT");
console.log("needs liquidity  ", plan.destination.requiresDestinationLiquidity);
if (plan.destination.requiresDestinationLiquidity && liquidity < amount) {
  console.log("STOP: destination router is short, transfer would stall");
  process.exit(1);
}
if (!send) { console.log("dry run: add --send to bridge", formatEther(amount), "STT"); process.exit(0); }
const receipt = await sendBridgeStep(shannon, plan.bridgeStep, { account });
console.log("bridge tx        ", receipt.transactionHash, receipt.status);
