// Simulates Reactivity callbacks against a deployed PerpsShield with debug_traceCall, sent
// from the precompile address, and checks which ones the shield acts on. Sends nothing.
// Usage: node test/wake-guard.mjs   (reads deployments/PerpsShield.json; the shield must be armed)
import { readFileSync } from "node:fs";
import { createPublicClient, http, encodeFunctionData, parseAbi, pad, toHex, toEventSelector, decodeEventLog } from "viem";
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";

const pc = createPublicClient({ chain: hidekiTestnet, transport: http() });
const shield = JSON.parse(readFileSync("deployments/PerpsShield.json", "utf8")).address;
const { abi } = JSON.parse(readFileSync("artifacts/PerpsShield.json", "utf8"));
const PRECOMPILE = "0x0000000000000000000000000000000000000100";
const SCHEDULE = toEventSelector("Schedule(uint256)");
const BLOCK_TICK = toEventSelector("BlockTick(uint64)");
const next = await pc.readContract({ address: shield, abi, functionName: "nextWakeMs" });
if (!(await pc.readContract({ address: shield, abi, functionName: "armed" }))) throw new Error("arm the shield first");

const onEvent = (emitter, topics) => encodeFunctionData({ abi: parseAbi(["function onEvent(address,bytes32[],bytes)"]), functionName: "onEvent", args: [emitter, topics, "0x"] });
async function run(from, data) {
  const tr = await pc.request({ method: "debug_traceCall", params: [{ from, to: shield, data, gas: toHex(8_000_000n) }, "latest", { tracer: "callTracer", tracerConfig: { withLog: true } }] });
  const logs = [];
  const walk = (c) => { for (const l of c.logs ?? []) if (l.address.toLowerCase() === shield.toLowerCase()) { try { logs.push(decodeEventLog({ abi, topics: l.topics, data: l.data }).eventName); } catch { logs.push("?"); } } (c.calls ?? []).forEach(walk); };
  walk(tr);
  return { reverted: !!tr.error, logs };
}

const ms = (n) => pad(toHex(n), { size: 32 });
const cases = [
  ["stranger calls onEvent directly", "0x000000000000000000000000000000000000dEaD", onEvent(PRECOMPILE, [SCHEDULE, ms(next)]), (r) => r.reverted],
  ["BlockTick from a stranger's subscription", PRECOMPILE, onEvent(PRECOMPILE, [BLOCK_TICK, ms(1n)]), (r) => !r.reverted && r.logs.length === 0],
  ["Schedule wake before the booked time", PRECOMPILE, onEvent(PRECOMPILE, [SCHEDULE, ms(next - 1n)]), (r) => !r.reverted && r.logs.length === 0],
  ["Schedule-shaped event from another emitter", PRECOMPILE, onEvent("0x1998c88d54a240b8c671493f27f58ec416b81d7f", [SCHEDULE, ms(next)]), (r) => !r.reverted && r.logs.length === 0],
  ["genuine wake, stamped 32 ms after booking", PRECOMPILE, onEvent(PRECOMPILE, [SCHEDULE, ms(next + 32n)]), (r) => !r.reverted && r.logs.includes("Checked") && r.logs.some((e) => e === "Armed" || e === "ArmFailed")],
];
let failed = 0;
for (const [name, from, data, ok] of cases) {
  const r = await run(from, data);
  const pass = ok(r);
  if (!pass) failed++;
  console.log(pass ? "PASS" : "FAIL", name, "| reverted:", r.reverted, "| events:", r.logs.join(",") || "none");
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
