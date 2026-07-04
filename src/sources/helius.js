// Helius adapter — the real-time KOL/smart-money tracking engine.
// Two modes: pull recent swaps for a wallet, and register push webhooks.
// Needs HELIUS_API_KEY (free tier at https://helius.dev). Without it, `npm run kol`
// falls back to data/sample-swaps.json so the PnL logic is still demonstrable.

const KEY = process.env.HELIUS_API_KEY || "";
const BASE = "https://api.helius.xyz/v0";

export function hasKey() {
  return Boolean(KEY);
}

/** Swaps for one wallet, paginated for fuller history so FIFO PnL is accurate.
 *  Walks the `before` cursor up to maxPages * 100 swaps. */
export async function getWalletSwaps(address, maxPages = 6) {
  if (!KEY) throw new Error("HELIUS_API_KEY not set");
  const out = [];
  let before = "";
  for (let page = 0; page < maxPages; page++) {
    const url = `${BASE}/addresses/${address}/transactions?api-key=${KEY}&type=SWAP&limit=100${before ? `&before=${before}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Helius ${res.status}`);
    const txs = await res.json();
    if (!Array.isArray(txs) || txs.length === 0) break;
    for (const tx of txs) { const s = parseSwap(tx, address); if (s) out.push(s); }
    before = txs[txs.length - 1].signature;
    if (txs.length < 100) break; // last page
  }
  return out;
}

/** Register a webhook so Helius pushes every tracked wallet's tx to your server in real time. */
export async function createWebhook(addresses, webhookURL) {
  if (!KEY) throw new Error("HELIUS_API_KEY not set");
  const res = await fetch(`${BASE}/webhooks?api-key=${KEY}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      webhookURL,
      transactionTypes: ["SWAP"],
      accountAddresses: addresses,
      webhookType: "enhanced",
      // Helius sends this as the Authorization header on every push -> we verify it server-side.
      ...(process.env.WEBHOOK_SECRET ? { authHeader: process.env.WEBHOOK_SECRET } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Helius webhook ${res.status}`);
  return res.json();
}

const WSOL = "So11111111111111111111111111111111111111112";

// Decode a Helius enhanced SWAP tx into {ts, mint, symbol, side, sol, tokens} using the
// tokenTransfers / nativeTransfers arrays (the events.swap field isn't populated on all tiers).
// Heuristic: the non-WSOL token the wallet net-received (buy) or net-sent (sell), priced by
// the wallet's net SOL/WSOL movement.
export function parseSwap(tx, wallet) {
  const tt = tx.tokenTransfers || [];
  const nt = tx.nativeTransfers || [];
  if (!tt.length && !nt.length) return null;

  let wsolFromW = 0, wsolToW = 0;
  for (const x of tt) {
    if (x.mint !== WSOL) continue;
    const amt = Number(x.tokenAmount) || 0;
    if (x.fromUserAccount === wallet) wsolFromW += amt;
    if (x.toUserAccount === wallet) wsolToW += amt;
  }
  let nativeFromW = 0, nativeToW = 0;
  for (const x of nt) {
    const sol = (Number(x.amount) || 0) / 1e9;
    if (x.fromUserAccount === wallet) nativeFromW += sol;
    if (x.toUserAccount === wallet) nativeToW += sol;
  }

  // net per-mint delta for the wallet (non-WSOL tokens)
  const delta = {};
  for (const x of tt) {
    if (x.mint === WSOL) continue;
    const amt = Number(x.tokenAmount) || 0;
    if (x.toUserAccount === wallet) delta[x.mint] = (delta[x.mint] || 0) + amt;
    if (x.fromUserAccount === wallet) delta[x.mint] = (delta[x.mint] || 0) - amt;
  }
  let mint = null, best = 0;
  for (const m in delta) if (Math.abs(delta[m]) > Math.abs(best)) { best = delta[m]; mint = m; }
  if (!mint || best === 0) return null;

  const solOut = wsolFromW > 0 ? wsolFromW : Math.max(0, nativeFromW - nativeToW);
  const solIn = wsolToW > 0 ? wsolToW : Math.max(0, nativeToW - nativeFromW);
  const side = best > 0 ? "buy" : "sell";
  const sol = side === "buy" ? solOut : solIn;
  if (sol <= 0) return null;

  return { ts: tx.timestamp, mint, symbol: mint.slice(0, 4), side, sol, tokens: Math.abs(best) };
}
