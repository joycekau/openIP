// Birdeye adapter (Path B) — price, OHLCV/K-line, trades, holders across 50+ Solana DEXs.
// Needs BIRDEYE_API_KEY (https://birdeye.so). The OHLCV here feeds the chart UI and the
// PnL engine's unrealized-PnL (current price per token).

const KEY = process.env.BIRDEYE_API_KEY || "";
const BASE = "https://public-api.birdeye.so";

export function hasKey() {
  return Boolean(KEY);
}

async function call(path, params = {}) {
  if (!KEY) throw new Error("BIRDEYE_API_KEY not set");
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${BASE}${path}?${qs}`, {
    headers: { "X-API-KEY": KEY, "x-chain": "solana", accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Birdeye ${res.status} ${path}`);
  return res.json();
}

export const price = (address) => call("/defi/price", { address });

export const ohlcv = (address, type = "1m") =>
  call("/defi/ohlcv", { address, type });

export const trades = (address, limit = 50) =>
  call("/defi/txs/token", { address, limit, tx_type: "swap" });
