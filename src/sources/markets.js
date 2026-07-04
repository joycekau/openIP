// Multi-source Solana meme-coin aggregator — the "全网 SOL Meme" data layer.
// All sources are FREE / no key (the same primary data gmgn itself indexes):
//   - GeckoTerminal (CoinGecko on-chain): trending + new pools, full price/vol/liq/mcap
//   - DexScreener: boosted/promoted tokens
//   - pump.fun frontend API: freshest launches (best-effort)
// Each fetch is wrapped so one source failing never breaks the rest.

const GT = "https://api.geckoterminal.com/api/v2/networks/solana";
const DS = "https://api.dexscreener.com";
const PUMP = "https://frontend-api.pump.fun";

async function getJSON(url, opts = {}) {
  const res = await fetch(url, { headers: { accept: "application/json" }, ...opts });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

const num = (x) => (Number(x) || 0);
const ageH = (ms) => (ms != null ? ms / 3.6e6 : null);

function flagsFor(c) {
  const f = [];
  if (c.ageHours != null && c.ageHours < 24) f.push("NEW");
  if (c.liquidity > 0 && c.liquidity < 10_000) f.push("LOW_LIQ");
  if (c.liquidity > 0 && c.volume24h / c.liquidity > 20) f.push("HOT");
  return f;
}

// ---- GeckoTerminal ----
function fromGeckoPool(pool, included) {
  const a = pool.attributes || {};
  const baseId = pool.relationships?.base_token?.data?.id || "";
  const mint = baseId.replace(/^solana_/, "");
  const tok = (included || []).find((x) => x.id === baseId);
  const ta = tok?.attributes || {};
  const name = (a.name || "").split("/")[0].trim();
  const created = a.pool_created_at ? new Date(a.pool_created_at).getTime() : null;
  const tx = a.transactions?.h24 || {};
  const c = {
    symbol: ta.symbol || name || "?",
    name: ta.name || name || "",
    address: mint,
    image: ta.image_url && ta.image_url !== "missing.png" ? ta.image_url : "",
    dex: pool.relationships?.dex?.data?.id || "",
    priceUsd: num(a.base_token_price_usd),
    change24h: num(a.price_change_percentage?.h24),
    volume24h: num(a.volume_usd?.h24),
    liquidity: num(a.reserve_in_usd),
    marketCap: num(a.market_cap_usd) || num(a.fdv_usd),
    buys24h: num(tx.buys),
    sells24h: num(tx.sells),
    ageHours: ageH(created != null ? Date.now() - created : null),
    source: "geckoterminal",
  };
  c.flags = flagsFor(c);
  return c;
}

async function geckoList(path, pages = 1) {
  const out = [];
  for (let p = 1; p <= pages; p++) {
    try {
      const data = await getJSON(`${GT}/${path}?page=${p}`);
      const included = data.included || [];
      for (const pool of data.data || []) out.push(fromGeckoPool(pool, included));
    } catch { break; }
  }
  return out;
}

// ---- DexScreener boosted ----
async function dexBoosted() {
  try {
    const boosts = await getJSON(`${DS}/token-boosts/latest/v1`);
    const addrs = [...new Set(boosts.filter((b) => b.chainId === "solana" && b.tokenAddress).map((b) => b.tokenAddress))].slice(0, 30);
    if (!addrs.length) return [];
    const pairs = await getJSON(`${DS}/tokens/v1/solana/${addrs.join(",")}`);
    const best = new Map();
    for (const p of pairs) {
      const a = p.baseToken?.address; if (!a) continue;
      const liq = p.liquidity?.usd || 0;
      if (!best.has(a) || liq > (best.get(a).liquidity?.usd || 0)) best.set(a, p);
    }
    return [...best.values()].map((p) => {
      const created = p.pairCreatedAt || null;
      const c = {
        symbol: p.baseToken?.symbol || "?", name: p.baseToken?.name || "", address: p.baseToken?.address,
        image: p.info?.imageUrl || "", dex: p.dexId,
        priceUsd: num(p.priceUsd), change24h: num(p.priceChange?.h24), volume24h: num(p.volume?.h24),
        liquidity: num(p.liquidity?.usd), marketCap: num(p.marketCap) || num(p.fdv),
        buys24h: num(p.txns?.h24?.buys), sells24h: num(p.txns?.h24?.sells),
        ageHours: ageH(created ? Date.now() - created : null), source: "dexscreener",
      };
      c.flags = flagsFor(c);
      return c;
    });
  } catch { return []; }
}

// ---- pump.fun newest ----
async function pumpNew(limit = 40) {
  try {
    const data = await getJSON(`${PUMP}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`);
    return (Array.isArray(data) ? data : []).map((x) => {
      const created = x.created_timestamp || null;
      const c = {
        symbol: x.symbol || "?", name: x.name || "", address: x.mint,
        image: x.image_uri || "", dex: "pump.fun",
        priceUsd: 0, change24h: 0, volume24h: 0,
        liquidity: num(x.virtual_sol_reserves) / 1e9,
        marketCap: num(x.usd_market_cap),
        ageHours: ageH(created ? Date.now() - created : null), source: "pump.fun",
      };
      c.flags = flagsFor(c);
      return c;
    });
  } catch { return []; }
}

function dedupe(coins) {
  const m = new Map();
  for (const c of coins) {
    if (!c.address) continue;
    const cur = m.get(c.address);
    // keep the row with more volume/liquidity info
    if (!cur || c.volume24h > cur.volume24h || (!cur.priceUsd && c.priceUsd)) m.set(c.address, c);
  }
  return [...m.values()];
}

/** The big "全网 SOL Meme" list — trending across sources, sorted by 24h volume. */
export async function getAllMemes(limit = 60) {
  const [gtTrend, ds] = await Promise.all([geckoList("trending_pools", 3), dexBoosted()]);
  return dedupe([...gtTrend, ...ds])
    .filter((c) => c.liquidity > 0 || c.volume24h > 0)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, limit);
}

/** Freshly-launched coins — GeckoTerminal new pools + pump.fun newest, by age. */
export async function getNewMemes(limit = 40) {
  const [gtNew, pump] = await Promise.all([geckoList("new_pools", 2), pumpNew(40)]);
  return dedupe([...gtNew, ...pump])
    .filter((c) => c.ageHours != null)
    .sort((a, b) => (a.ageHours ?? 1e9) - (b.ageHours ?? 1e9))
    .slice(0, limit);
}

/** pump.fun-origin coins — pumpswap pools on GeckoTerminal + pump.fun API (best-effort). */
export async function getPumpMemes(limit = 50) {
  const [trend, fresh, pump] = await Promise.all([geckoList("trending_pools", 4), geckoList("new_pools", 2), pumpNew(40)]);
  const fromGecko = [...trend, ...fresh].filter((c) => /pump/i.test(c.dex || ""));
  return dedupe([...fromGecko, ...pump])
    .sort((a, b) => b.volume24h - a.volume24h || (a.ageHours ?? 1e9) - (b.ageHours ?? 1e9))
    .slice(0, limit);
}
