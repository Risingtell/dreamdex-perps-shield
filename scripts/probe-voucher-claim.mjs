// Read-only probe behind feedback 005: compares the SDK's voucher eligibility answer with
// what VoucherDistributor.claim() actually does, for several fresh addresses. Sends nothing.
import { hidekiTestnet } from "@somnia-chain/markets-sdk/chains";
import { contractErrorsAbi } from "@somnia-chain/markets-sdk";
import { getPerpVoucherCampaign, getPerpVoucherEligibility } from "../node_modules/@somnia-chain/markets-sdk/dist/perp/voucher.js";
import { createPublicClient, http, decodeErrorResult } from "viem";

const MARGIN_BANK = "0x478769e1177c0773c43a593dccc4ad15f15f1394";
const CLAIM = "0x4e71d92d"; // claim()
const callers = {
  "build wallet (EOA)": "0x29FD4dDD9793e83fe216c398a2e81BF9Cd82FB41",
  "PerpsShield (contract)": "0x7d662c7bbff7aa9aaf20b036ebe6c53f6941e3e5",
  "ProbeForwarder (contract)": "0x214b1E0E7EcC3339c7eb2C9a92968006552506B3",
};

const client = createPublicClient({ chain: hidekiTestnet, transport: http() });
const campaign = await getPerpVoucherCampaign(MARGIN_BANK, client);
const now = (await client.getBlock()).timestamp;
console.log("distributor", campaign.distributor, "| window", campaign.startsAt, "to", campaign.endsAt, "| now", now, "| claims left", campaign.claimsRemaining);

for (const [label, address] of Object.entries(callers)) {
  const eligibility = await getPerpVoucherEligibility(MARGIN_BANK, address, client);
  let result = "claim() would succeed";
  try {
    await client.call({ account: address, to: campaign.distributor, data: CLAIM });
  } catch (e) {
    const data = e.cause?.data ?? e.data ?? e.walk?.((x) => x.data)?.data;
    let name = "unknown";
    try { name = decodeErrorResult({ abi: contractErrorsAbi, data }).errorName; } catch {}
    result = `claim() reverts ${data ?? e.shortMessage} (contractErrorsAbi: ${name})`;
  }
  console.log(label.padEnd(26), "eligible:", eligibility.eligible, eligibility.reason ?? "", "|", result);
}
