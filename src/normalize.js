// Turn raw DexScreener pairs into a clean oneIP.io token shape, picking the
// deepest-liquidity pair per token and attaching the kind of risk flags gmgn shows.

export function bestPairPerToken(pairs) {
  const byToken = new Map();
  for (const p of pairs) {
    const addr = p.baseToken?.address;
    if (!addr) continue;
    const liq = p.liquidity?.usd || 0;
    const cur = byToken.get(addr);
    if (!cur || liq > (cur.liquidity?.usd || 0)) byToken.set(addr, p);
  }
  return [...byToken.values()];
}

export function normalize(p) {
  const liq = p.liquidity?.usd || 0;
  const vol24 = p.volume?.h24 || 0;
  const ch24 = p.priceChange?.h24 || 0;
  const tx24 = p.txns?.h24 || { buys: 0, sells: 0 };
  const ageMs = p.pairCreatedAt ? Date.now() - p.pairCreatedAt : null;
  const ageHours = ageMs != null ? ageMs / 3.6e6 : null;

  const flags = [];
  if (ageHours != null && ageHours < 24) flags.push("NEW");
  if (liq > 0 && liq < 10_000) flags.push("LOW_LIQ");
  if (liq > 0 && vol24 / liq > 20) flags.push("HOT");
  const totalTx = tx24.buys + tx24.sells;
  if (totalTx > 50 && tx24.sells / totalTx > 0.7) flags.push("SELL_PRESSURE");

  return {
    symbol: p.baseToken?.symbol || "?",
    name: p.baseToken?.name || "",
    address: p.baseToken?.address,
    dex: p.dexId,
    priceUsd: Number(p.priceUsd) || 0,
    change24h: ch24,
    volume24h: vol24,
    liquidity: liq,
    marketCap: p.marketCap || p.fdv || 0,
    buys24h: tx24.buys,
    sells24h: tx24.sells,
    ageHours,
    flags,
    url: p.url,
  };
}
