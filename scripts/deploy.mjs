// Deploys artifacts/<Name>.json to Hideki with the .env key. Usage: node scripts/deploy.mjs <Name>
import "dotenv/config";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createPublicClient, createWalletClient, http, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";

const name = process.argv[2];
const { abi, bytecode } = JSON.parse(readFileSync(`artifacts/${name}.json`, "utf8"));
const account = privateKeyToAccount(process.env.PRIVATE_KEY);
const publicClient = createPublicClient({ chain: hidekiTestnet, transport: http() });
const wallet = createWalletClient({ account, chain: hidekiTestnet, transport: http() });

const before = await publicClient.getBalance({ address: account.address });
const hash = await wallet.deployContract({ abi, bytecode, gas: 15_000_000n });
const receipt = await publicClient.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`deploy reverted: ${hash}`);
const after = await publicClient.getBalance({ address: account.address });
mkdirSync("deployments", { recursive: true });
writeFileSync(`deployments/${name}.json`, JSON.stringify({ address: receipt.contractAddress, tx: hash, chainId: hidekiTestnet.id }, null, 2));
console.log(name, "deployed at", receipt.contractAddress);
console.log("tx", hash, "| cost", formatEther(before - after), "STT");
