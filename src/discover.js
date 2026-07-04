// Discover real, active Solana trader wallets from on-chain data (gmgn methodology):
// take the hottest trending token and surface the wallets trading it the most.
// Reused by both `npm run discover` (CLI) and the admin panel's one-click discovery.
import { getBoostedSolanaAddresses, getPairsForTokens } from "./sources/dexscreener.js";
import { bestPairPerToken, normalize } from "./normalize.js";

// routers / programs that aren't real trader wallets
const SKIP = new Set([
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
]);

export async function discoverWallets({ limit = 8 } = {}) {
  const KEY = process.env.HELIUS_API_KEY;
  if (!KEY) throw new Error("HELIUS_API_KEY not set");

  const addrs = await getBoostedSolanaAddresses(30);
  const pairs = await getPairsForTokens(addrs);
  const toks = bestPairPerToken(pairs).map(normalize)
    .filter((t) => t.liquidity > 5000)
    .sort((a, b) => b.volume24h - a.volume24h);
  const target = toks[0];
  if (!target) throw new Error("no trending token found, try again");

  const url = `https://api.helius.xyz/v0/addresses/${target.address}/transactions?api-key=${KEY}&type=SWAP&limit=100`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Helius " + res.status);
  const txs = await res.json();

  const count = {};
  for (const tx of txs) {
    const w = tx.feePayer;
    if (!w || SKIP.has(w)) continue;
    count[w] = (count[w] || 0) + 1;
  }
  const candidates = Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([wallet, swaps]) => ({ wallet, swaps }));

  return { token: { symbol: target.symbol, address: target.address }, sampled: txs.length, candidates };
}
