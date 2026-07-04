// DexScreener adapter — FREE, no API key. Good for: trending/boosted tokens,
// live price / volume / liquidity / market cap / pair age across 50+ Solana DEXs.
// Docs: https://docs.dexscreener.com/api/reference

const BASE = "https://api.dexscreener.com";

async function getJSON(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`DexScreener ${res.status} ${url}`);
  return res.json();
}

/** Currently boosted/promoted tokens on Solana — a decent proxy for "what's hot right now". */
export async function getBoostedSolanaAddresses(limit = 30) {
  const data = await getJSON(`${BASE}/token-boosts/latest/v1`);
  const seen = new Set();
  const out = [];
  for (const t of data) {
    if (t.chainId !== "solana" || !t.tokenAddress) continue;
    if (seen.has(t.tokenAddress)) continue;
    seen.add(t.tokenAddress);
    out.push(t.tokenAddress);
    if (out.length >= limit) break;
  }
  return out;
}

/** Full market data for up to 30 token addresses at once (returns one row per DEX pair). */
export async function getPairsForTokens(addresses) {
  if (!addresses.length) return [];
  const joined = addresses.slice(0, 30).join(",");
  const data = await getJSON(`${BASE}/tokens/v1/solana/${joined}`);
  return Array.isArray(data) ? data : [];
}

/** Free-text search (symbol / name / address). */
export async function search(query) {
  const data = await getJSON(`${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`);
  return data.pairs || [];
}
