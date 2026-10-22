// Moves the build wallet's STT (or USDso with --token USDso) from Somnia Shannon (50312)
// to Hideki (50383).
// Usage: node scripts/bridge-stt-to-hideki.mjs <amount> [--token USDso] [--send]
import "dotenv/config";
import { createPublicClient, http, parseEther, formatEther, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { somniaShannon, hidekiTestnet, createBridgeTransfer, sendBridgeStep, getBridgeToken, BridgeToken, ChainId } from "@somnia-chain/markets-sdk/chains";

const amount = parseEther(process.argv[2] ?? "0");
const send = process.argv.includes("--send");
const tokenArg = process.argv.includes("--token") ? process.argv[process.argv.indexOf("--token") + 1] : "STT";
const token = BridgeToken[tokenArg];
if (!token) { console.log("unknown token", tokenArg); process.exit(1); }
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const shannon = createPublicClient({ chain: somniaShannon, transport: http() });
const hideki = createPublicClient({ chain: hidekiTestnet, transport: http() });

// Native STT has no token address; an ERC-20 route reads balances from each side's token.
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const balanceOn = async (client, chainId, address) => {
  const side = getBridgeToken(token, chainId);
  return side?.address
    ? client.readContract({ address: side.address, abi: erc20, functionName: "balanceOf", args: [address] })
    : client.getBalance({ address });
};

const plan = createBridgeTransfer({
  token,
  from: ChainId.somniaShannon,
  to: ChainId.hidekiTestnet,
  amount,
  recipient: account.address,
});
const liquidity = await balanceOn(hideki, ChainId.hidekiTestnet, plan.destination.router);
console.log("wallet           ", account.address, "token", tokenArg);
console.log("shannon balance  ", formatEther(await balanceOn(shannon, ChainId.somniaShannon, account.address)));
console.log("hideki balance   ", formatEther(await balanceOn(hideki, ChainId.hidekiTestnet, account.address)));
console.log("shannon STT gas  ", formatEther(await shannon.getBalance({ address: account.address })));
console.log("hideki router    ", plan.destination.router, "holds", formatEther(liquidity), tokenArg);
console.log("needs liquidity  ", plan.destination.requiresDestinationLiquidity);
if (plan.destination.requiresDestinationLiquidity && liquidity < amount) {
  console.log("STOP: destination router is short, transfer would stall");
  process.exit(1);
}
if (!send) { console.log("dry run: add --send to bridge", formatEther(amount), tokenArg); process.exit(0); }
if (plan.approveStep) {
  const approval = await sendBridgeStep(shannon, plan.approveStep, { account });
  console.log("approve tx       ", approval.transactionHash, approval.status);
}
const receipt = await sendBridgeStep(shannon, plan.bridgeStep, { account });
console.log("bridge tx        ", receipt.transactionHash, receipt.status);
process.exit(0);
