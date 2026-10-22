// Compiles contracts/*.sol with solcjs into artifacts/<Name>.json (abi + bytecode).
import solc from "solc";
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from "node:fs";

// Resolves package imports such as @somnia-chain/reactivity-contracts from node_modules.
const findImports = (path) =>
  existsSync(`node_modules/${path}`) ? { contents: readFileSync(`node_modules/${path}`, "utf8") } : { error: `not found: ${path}` };

const sources = Object.fromEntries(
  readdirSync("contracts").filter((f) => f.endsWith(".sol")).map((f) => [f, { content: readFileSync(`contracts/${f}`, "utf8") }]),
);
const out = JSON.parse(solc.compile(JSON.stringify({
  language: "Solidity",
  sources,
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun", outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
}), { import: findImports }));
const errors = (out.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) { console.error(errors.map((e) => e.formattedMessage).join("\n")); process.exit(1); }
mkdirSync("artifacts", { recursive: true });
for (const [source, file] of Object.entries(out.contracts)) {
  if (source.startsWith("@")) continue;
  for (const [name, c] of Object.entries(file)) {
    writeFileSync(`artifacts/${name}.json`, JSON.stringify({ abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2));
    console.log("compiled", name, (c.evm.bytecode.object.length / 2) | 0, "bytes");
  }
}
