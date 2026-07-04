// Doctor — verifies your HELIUS_API_KEY actually works before you rely on it.
// Run: npm run doctor
import * as helius from "../src/sources/helius.js";

if (!helius.hasKey()) {
  console.log("✗ HELIUS_API_KEY not set.");
  console.log("  1) sign up free at https://helius.dev");
  console.log("  2) copy your API key from the dashboard");
  console.log("  3) put it in .env  ->  HELIUS_API_KEY=your_key_here");
  process.exit(1);
}

// A known, always-active address (wrapped SOL) — proves the key is accepted by Helius.
const PROBE = "So11111111111111111111111111111111111111112";
try {
  const swaps = await helius.getWalletSwaps(PROBE, 3);
  console.log(`✓ Helius key works. Probe returned ${swaps.length} decoded swap(s).`);
  console.log("  You're ready: `npm run kol` is now LIVE on-chain, and you can register the");
  console.log("  real-time webhook with: npm run helius:webhook -- https://your-server/webhooks/helius");
} catch (e) {
  const bad = /401|403/.test(e.message);
  console.log(`✗ Helius rejected the request: ${e.message}`);
  if (bad) console.log("  That status means the key is invalid — re-copy it from the dashboard.");
  process.exit(1);
}
