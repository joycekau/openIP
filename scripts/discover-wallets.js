// CLI wrapper around src/discover.js. Run: npm run discover
import { discoverWallets } from "../src/discover.js";

const { token, sampled, candidates } = await discoverWallets();
console.log(`\nDiscovering active traders of $${token.symbol}  (${token.address})\n`);
console.log(`found ${candidates.length} top wallets in last ${sampled} swaps:\n`);
console.log("swaps  wallet");
for (const c of candidates) console.log(String(c.swaps).padStart(4), "  ", c.wallet);

console.log("\nReady-to-paste kol-wallets.json entries (vet before trusting):");
console.log(JSON.stringify(
  candidates.slice(0, 4).map((c, i) => ({ wallet: c.wallet, kol: `Trader ${i + 1} ($${token.symbol})`, twitter: "", tags: ["discovered", "unvetted"] })),
  null, 2
));
