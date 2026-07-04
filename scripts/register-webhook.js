// Register your tracked KOL wallets as a Helius webhook so every SWAP they make is
// pushed to your server in real time (-> POST /webhooks/helius).
// Run: npm run helius:webhook -- https://your-public-server/webhooks/helius
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as helius from "../src/sources/helius.js";

const __dir = dirname(fileURLToPath(import.meta.url));

if (!helius.hasKey()) {
  console.log("✗ HELIUS_API_KEY not set — run `npm run doctor` first.");
  process.exit(1);
}

const webhookURL = process.argv[2] || process.env.WEBHOOK_URL;
if (!webhookURL) {
  console.log("Usage: npm run helius:webhook -- https://your-public-server/webhooks/helius");
  console.log("(the server must be reachable from the internet — use a tunnel like ngrok for local testing)");
  process.exit(1);
}

const wallets = JSON.parse(await readFile(join(__dir, "..", "data", "kol-wallets.json"), "utf8"));
const addresses = wallets.map((w) => w.wallet);

try {
  const r = await helius.createWebhook(addresses, webhookURL);
  console.log(`✓ Webhook registered (id: ${r.webhookID || JSON.stringify(r)})`);
  console.log(`  Tracking ${addresses.length} KOL wallets -> ${webhookURL}`);
} catch (e) {
  console.log(`✗ Failed to register webhook: ${e.message}`);
  process.exit(1);
}
