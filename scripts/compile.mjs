// Compiles contracts/*.sol with solcjs into artifacts/<Name>.json (abi + bytecode).
import solc from "solc";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";

const sources = Object.fromEntries(
  readdirSync("contracts").filter((f) => f.endsWith(".sol")).map((f) => [f, { content: readFileSync(`contracts/${f}`, "utf8") }]),
);
const out = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources,
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
})));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) { console.error(errors.map((e) => e.formattedMessage).join("\n")); process.exit(1); }
mkdirSync("artifacts", { recursive: true });
for (const file of Object.values(out.contracts)) {
  for (const [name, c] of Object.entries(file)) {
    writeFileSync(`artifacts/${name}.json`, JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
    console.log("compiled", name, (c.evm.bytecode.object.length / 2) | 0, "bytes");
  }
}
