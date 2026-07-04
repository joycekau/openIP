// End-to-end proof: boot the server, pull live trending, then POST a fake Helius
// SWAP webhook and watch it surface as a live KOL signal + update the leaderboard.
import { start } from "../src/server.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8799;
const base = `http://localhost:${PORT}`;
const j = async (p, o) => (await fetch(base + p, o)).json();

const __dir = dirname(fileURLToPath(import.meta.url));
const wallets = JSON.parse(await readFile(join(__dir, "..", "data", "kol-wallets.json"), "utf8"));
const WALLET = wallets[0]?.wallet; // use a currently-tracked wallet so ingestion is real

const server = await start(PORT);

const trending = await j("/api/trending");
console.log(`\n1) GET /api/trending        -> ${trending.length} tokens, top: ${trending[0]?.symbol} (${trending[0]?.flags.join(",") || "-"})`);

const before = await j("/api/kol/signals");
console.log(`2) GET /api/kol/signals     -> ${before.length} signals, newest: ${before[0]?.kol} ${before[0]?.side} ${before[0]?.symbol}`);

const now = Math.floor(Date.now() / 1000);
// real Helius enhanced shape: spent 7.5 SOL -> bought MOODENG (parsed via native/tokenTransfers)
const payload = [{
  feePayer: WALLET,
  timestamp: now,
  type: "SWAP",
  tokenTransfers: [{ fromUserAccount: "pool", toUserAccount: WALLET, mint: "MOODENGmint", tokenAmount: 123456 }],
  nativeTransfers: [{ fromUserAccount: WALLET, toUserAccount: "pool", amount: 7500000000 }],
}];
const ing = await j("/webhooks/helius", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
console.log(`3) POST /webhooks/helius     -> ingested ${ing.ingested} swap (tracked wallet bought MOODENG, 7.5 SOL)`);

const after = await j("/api/kol/signals");
const t = after[0];
console.log(`4) GET /api/kol/signals     -> ${after.length} signals, newest: ${t?.kol} ${t?.side?.toUpperCase()} ${t?.symbol} ${t?.sol}SOL  <-- LIVE`);

const board = await j("/api/kol/leaderboard");
console.log(`5) GET /api/kol/leaderboard -> #1 ${board[0]?.kol} score ${board[0]?.score?.toFixed(1)} (win ${(board[0]?.winRate * 100).toFixed(0)}%)\n`);

server.close();
process.exit(0);
