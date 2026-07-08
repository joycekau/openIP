// Revenue -> protocol buyback -> floor. When an order settles, 20% of the NET fiat profit is
// converted (via the SOL float pool) and funded into that token's on-chain floor vault. Every
// buyback is recorded with its on-chain signature so fans can publicly verify it.
//
// MESSAGING (locked): only ever describe this as "revenue -> protocol buyback -> higher floor"
// (a utility/protocol mechanic). NEVER "dividend / payout / holders share profit" — that framing
// trips the securities (Howey) line.
//
// On-chain is OPT-IN and LAZY (keeps the server zero-dep): with SOLANA_BUYBACK=1 + a deployer key,
// fundFloor() dynamically imports the web3.js client (a devDependency) and funds the real vault.
// Otherwise it mock-funds — same demonstrable flow as the rest of oneIP.
import * as treasury from "./treasury.js";
import { loadJson, saveJson } from "../persist.js";

const KEY = "buybacks";
// 20% of net profit funds the floor — mirrors the 20% floor-vault split of every on-curve buy.
const BUYBACK_BPS = Number(process.env.BUYBACK_BPS || 2000);

let byCoin = {}; // coin(mint) -> [record...]
let loaded = false;

export async function load() {
  byCoin = await loadJson(KEY, {});
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }
function persist() { saveJson(KEY, byCoin); }

const onchainEnabled = () => process.env.SOLANA_BUYBACK === "1";

/** How much a given net profit would buy back (no side effects) — for quotes/previews. */
export function quote(netProfitCents) {
  const buybackCents = Math.max(0, Math.round((netProfitCents * BUYBACK_BPS) / 10000));
  return { buybackCents, bps: BUYBACK_BPS, ...treasury.quoteLamports(buybackCents) };
}

/** Fund a token's floor vault with `lamports`. Lazy on-chain (MVP reuses the proven `buy` ix:
 *  20% auto-lands in the floor vault) or mock. Returns { sig, explorer, mock }. */
async function fundFloor({ coin, lamports }) {
  if (!onchainEnabled()) {
    return { sig: `mock-buyback-${Date.now()}`, explorer: "", mock: true };
  }
  // Literal specifier (not a computed path) so serverless bundlers trace the client + its
  // web3.js deps into the function bundle; still lazy — only loaded when SOLANA_BUYBACK=1.
  const mod = await import("../../scripts/sol/buyback.js");
  return mod.fundFloorViaBuy({ mint: coin, lamports });
}

/** Execute a buyback for a settled order. Reserves SOL from the float pool, funds the floor,
 *  records the proof. Returns the record (or { skipped } when there's no profit). */
export async function execute({ coin, orderId, netProfitCents }) {
  // A creator can sell before launching their token — the order still settles, the buyback is
  // just skipped (TODO: escrow pre-launch 20% and apply it once they launch their value pool).
  if (!coin) return { skipped: true, reason: "creator has no value pool (token) yet" };
  const q = quote(netProfitCents);
  if (q.buybackCents <= 0 || q.lamports <= 0) return { skipped: true, reason: "no net profit" };
  // Auto-provisioned value pools have a placeholder mint ("Kol…") with no on-chain floor vault yet.
  // ESCROW the 20% to the coin; it flushes into the real floor when the creator mints via Phantom.
  // Real Solana mints never start with "Kol".
  if (String(coin).startsWith("Kol")) {
    const rec = { orderId, coin, ts: Date.now(), buybackCents: q.buybackCents, bps: q.bps, usd: q.usd, solUsd: q.solUsd, lamports: q.lamports, status: "escrow", sig: null, explorer: "", mock: false };
    byCoin[coin] = byCoin[coin] || [];
    byCoin[coin].unshift(rec);
    persist();
    return rec;
  }
  const rec = {
    orderId, coin, ts: Date.now(),
    buybackCents: q.buybackCents, bps: q.bps, usd: q.usd, solUsd: q.solUsd, lamports: q.lamports,
    status: "funded", sig: null, explorer: "", mock: false,
  };
  // Try to reserve SOL from the float pool. If it's short, QUEUE the buyback (settle still
  // succeeds) — it funds once the platform's next fiat->SOL conversion tops the pool up.
  try {
    treasury.reserve(q.lamports, `buyback ${orderId}`);
  } catch {
    rec.status = "queued";
    byCoin[coin] = byCoin[coin] || [];
    byCoin[coin].unshift(rec);
    persist();
    return rec;
  }
  // If the on-chain send fails (missing deployer key, RPC down, token has no launch account),
  // NEVER fail the settle: give the reserved SOL back to the float pool and QUEUE the buyback
  // so it can be retried once the operator fixes the cause.
  try {
    const onchain = await fundFloor({ coin, lamports: q.lamports });
    rec.sig = onchain.sig; rec.explorer = onchain.explorer || ""; rec.mock = !!onchain.mock;
  } catch (e) {
    treasury.topUp(q.lamports, `buyback ${orderId} revert: ${String(e.message || e).slice(0, 80)}`);
    rec.status = "queued"; rec.error = String(e.message || e).slice(0, 200);
  }
  byCoin[coin] = byCoin[coin] || [];
  byCoin[coin].unshift(rec);
  persist();
  return rec;
}

/** Flush a pre-launch pool's escrowed 20% onto the now-real on-chain coin. Called when an account
 *  mints its value-pool token for real (Phantom). Re-keys escrow records to the real mint and marks
 *  them funded. (TODO real mode: actually fund the on-chain floor vault with the summed lamports.) */
export function flushEscrow(fromCoin, toCoin) {
  const list = byCoin[fromCoin] || [];
  const escrow = list.filter((r) => r.status === "escrow");
  if (!escrow.length) return { flushed: 0, lamports: 0 };
  const lamports = escrow.reduce((a, r) => a + (r.lamports || 0), 0);
  const escrowSet = new Set(escrow);
  byCoin[fromCoin] = list.filter((r) => !escrowSet.has(r)); // remove escrow from the old placeholder coin
  byCoin[toCoin] = byCoin[toCoin] || [];
  for (const r of escrow) {
    r.status = "funded"; r.coin = toCoin; r.flushedFrom = fromCoin; r.sig = r.sig || `flush-${Date.now()}`;
    byCoin[toCoin].unshift(r);
  }
  persist();
  return { flushed: escrow.length, lamports };
}

/** Public proof for a coin page: total floor added by real sales + each verifiable tx. */
export function proof(coin) {
  const list = byCoin[coin] || [];
  const funded = list.filter((r) => r.status !== "queued" && r.status !== "escrow");
  const queued = list.filter((r) => r.status === "queued");
  const escrow = list.filter((r) => r.status === "escrow");
  const totalLamports = funded.reduce((a, r) => a + (r.lamports || 0), 0);
  const totalCents = funded.reduce((a, r) => a + (r.buybackCents || 0), 0);
  return {
    coin,
    count: funded.length,
    queuedCount: queued.length,
    escrowCount: escrow.length,
    totalFloorAddedSol: totalLamports / 1_000_000_000,
    totalBuybackUsd: totalCents / 100,
    queuedUsd: queued.reduce((a, r) => a + (r.buybackCents || 0), 0) / 100,
    escrowUsd: escrow.reduce((a, r) => a + (r.buybackCents || 0), 0) / 100,
    txs: list.slice(0, 100),
  };
}
