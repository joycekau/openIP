// GMGN OpenAPI adapter (Path A) — the fastest way to light up KOL / smart-money /
// security / holder data, straight from gmgn's own backend.
// Key + exact skill routes: https://gmgn.ai/ai  (set GMGN_API_KEY, and GMGN_API_BASE if needed).
//
// GMGN exposes 6 skills; methods below mirror them. Fill the exact paths from your
// dashboard docs (they're gated behind the key) — the request plumbing is done.

const KEY = process.env.GMGN_API_KEY || "";
const BASE = process.env.GMGN_API_BASE || "https://gmgn.ai/api/v1";

export function hasKey() {
  return Boolean(KEY);
}

async function call(path, params = {}) {
  if (!KEY) throw new Error("GMGN_API_KEY not set (get one at https://gmgn.ai/ai)");
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${KEY}`, accept: "application/json" } });
  if (!res.ok) throw new Error(`GMGN ${res.status} ${path}`);
  return res.json();
}

// gmgn-market: trending rankings + K-line
export const market = {
  trending: (chain = "sol", params = {}) => call(`/market/trending/${chain}`, params),
  kline: (chain, token, interval = "1m") => call(`/market/kline/${chain}/${token}`, { interval }),
};

// gmgn-token: fundamentals, security, holder breakdown
export const token = {
  info: (chain, address) => call(`/token/info/${chain}/${address}`),
  security: (chain, address) => call(`/token/security/${chain}/${address}`),
  holders: (chain, address) => call(`/token/holders/${chain}/${address}`),
};

// gmgn-track: the KOL / smart-money signal feed ⭐
export const track = {
  smartMoney: (chain = "sol") => call(`/track/smart-money/${chain}`),
  kolTrades: (chain = "sol") => call(`/track/kol/${chain}`),
  followed: (chain = "sol") => call(`/track/followed/${chain}`),
};

// gmgn-portfolio: wallet PnL / holdings / history
export const portfolio = {
  stats: (chain, wallet) => call(`/portfolio/stats/${chain}/${wallet}`),
  holdings: (chain, wallet) => call(`/portfolio/holdings/${chain}/${wallet}`),
};
