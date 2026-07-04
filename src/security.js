// Cached security layer — wraps RugCheck so we never hammer it (5-min TTL per mint),
// and enrich() can decorate a token list in parallel without blocking the whole feed.
import { report } from "./sources/rugcheck.js";

const TTL = 5 * 60 * 1000;
const cache = new Map();

export async function getSecurity(mint) {
  const hit = cache.get(mint);
  if (hit && Date.now() - hit.ts < TTL) return hit.data;
  let data;
  try {
    data = await report(mint);
  } catch (e) {
    data = { mint, verdict: "unknown", badges: [], error: e.message };
  }
  cache.set(mint, { ts: Date.now(), data });
  return data;
}

/** Attach `.security` to the top `n` tokens (by current order) in parallel. */
export async function enrich(tokens, n = 10) {
  await Promise.all(
    tokens.slice(0, n).map(async (t) => {
      if (t.address) t.security = await getSecurity(t.address);
    })
  );
  return tokens;
}
