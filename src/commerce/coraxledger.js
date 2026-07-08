// Bridge to the SHARED CoraX ledger tables (same Supabase project as oneIP's KV store).
// Two jobs:
//   1. READ the three creator money figures for the unified display —
//        • merchant earnings  = the creator's channel goods sales − category commission (channel_orders)
//        • creator-IP earnings = 70% of their digital/IP sales (oneip_revenue_splits.creator_amount)
//        • value pool          = token floor + liquidity (oneip_token_pools)  ← NOT income
//   2. WRITE the compatibility rows when oneIP's engine settles a token/IP sale, so the CoraX app's
//      creator-earnings + pool displays keep working after the CoraX trigger is demoted. GATED behind
//      CORAX_LEDGER_WRITE=1 and OFF by default — must be turned on in lockstep with demoting the
//      `oneip_apply_revenue_split` trigger, else the live trigger + this would DOUBLE-credit the pool.
//
// CoraX money columns are numeric DOLLARS; oneIP works in integer CENTS — convert on the boundary.
// Every call is best-effort/no-throw so ledger issues never break a settle or a page load.
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "";
export const available = Boolean(SUPABASE_URL && SUPABASE_KEY);
const writeEnabled = () => available && process.env.CORAX_LEDGER_WRITE === "1";

const h = (extra) => ({ apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, ...extra });
const dollars = (cents) => Math.round(cents) / 100;
const num = (v) => (v == null ? 0 : Number(v) || 0);

async function sbGet(pathAndQuery) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, { headers: h() });
  if (!r.ok) throw new Error(`corax read ${r.status}`);
  return r.json();
}

// ---- identity ----
/** The CoraX channels a creator owns (channel = a single-merchant storefront in CoraX). */
async function channelsFor(creatorUuid) {
  const rows = await sbGet(`channel_products?creator_id=eq.${encodeURIComponent(creatorUuid)}&select=channel_id`);
  return [...new Set(rows.map((r) => r.channel_id).filter(Boolean))];
}

// ---- READS (for the unified earnings display) ----
/** Merchant earnings = goods GMV − category commission across the creator's channels.
 *  Mirrors the CoraX dashboard (get_channel_overview_stats: total_revenue − commission_paid). */
export async function merchantEarnings(creatorUuid) {
  if (!available || !creatorUuid) return null;
  try {
    const channels = await channelsFor(creatorUuid);
    if (!channels.length) return { gmvUsd: 0, commissionUsd: 0, netUsd: 0, channels: 0 };
    const inList = `(${channels.map((c) => `"${c}"`).join(",")}`.concat(")");
    const rows = await sbGet(`channel_orders?channel_id=in.${encodeURIComponent(inList)}&status=not.in.(cancelled,refunded)&select=total,commission_amount`);
    const gmv = rows.reduce((a, r) => a + num(r.total), 0);
    const commission = rows.reduce((a, r) => a + num(r.commission_amount), 0);
    return { gmvUsd: gmv, commissionUsd: commission, netUsd: Math.max(0, gmv - commission), channels: channels.length, orders: rows.length };
  } catch { return null; }
}

/** Creator/IP earnings = 70% share summed from the token-split ledger. */
export async function creatorIpEarnings(creatorUuid) {
  if (!available || !creatorUuid) return null;
  try {
    const rows = await sbGet(`oneip_revenue_splits?creator_id=eq.${encodeURIComponent(creatorUuid)}&select=creator_amount,token_pool_amount,base_amount`);
    return {
      earningsUsd: rows.reduce((a, r) => a + num(r.creator_amount), 0),
      poolFundedUsd: rows.reduce((a, r) => a + num(r.token_pool_amount), 0),
      grossUsd: rows.reduce((a, r) => a + num(r.base_amount), 0),
      sales: rows.length,
    };
  } catch { return null; }
}

/** Value pool = the token's floor + liquidity (pending + deployed) + deposits. NOT income. */
export async function poolBalance(creatorUuid) {
  if (!available || !creatorUuid) return null;
  try {
    const rows = await sbGet(`oneip_token_pools?creator_id=eq.${encodeURIComponent(creatorUuid)}&select=*`);
    if (!rows.length) return { liquidityPendingUsd: 0, floorPendingUsd: 0, liquidityDeployedUsd: 0, floorDeployedUsd: 0, totalFromSalesUsd: 0, totalFromDepositsUsd: 0, exists: false };
    const p = rows[0];
    return {
      exists: true,
      liquidityPendingUsd: num(p.liquidity_pending), floorPendingUsd: num(p.floor_pending),
      liquidityDeployedUsd: num(p.liquidity_deployed), floorDeployedUsd: num(p.floor_deployed),
      totalFromSalesUsd: num(p.total_from_sales), totalFromDepositsUsd: num(p.total_from_deposits),
      currency: p.currency || "USD",
    };
  } catch { return null; }
}

// ---- WRITE (compatibility; gated) ----
/** Mirror the CoraX trigger's writes for an IP sale the oneIP engine just settled: one row in
 *  oneip_revenue_splits + an upsert into oneip_token_pools. No-op unless CORAX_LEDGER_WRITE=1 and a
 *  CoraX creator uuid is known. Idempotent-ish via purchaseId (skips if a split already exists). */
export async function recordSplit({ creatorUuid, purchaseId, productId, baseCents, creatorCents, poolCents, platformCents, liquidityCents, floorCents, platformRate }) {
  if (!writeEnabled() || !creatorUuid) return { skipped: true };
  try {
    // idempotency: if a split for this purchase already exists (e.g. trigger still ran), don't double-write
    if (purchaseId) {
      const existing = await sbGet(`oneip_revenue_splits?purchase_id=eq.${encodeURIComponent(purchaseId)}&select=id&limit=1`);
      if (existing.length) return { skipped: true, reason: "split already recorded" };
    }
    const liqUsd = dollars(liquidityCents), floorUsd = dollars(floorCents), poolUsd = dollars(poolCents);
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/oneip_revenue_splits`, {
      method: "POST", keepalive: true, headers: h({ "content-type": "application/json", prefer: "return=minimal" }),
      body: JSON.stringify({
        purchase_id: purchaseId || null, creator_id: creatorUuid, product_id: productId || null,
        base_amount: dollars(baseCents), creator_amount: dollars(creatorCents),
        token_pool_amount: poolUsd, platform_amount: dollars(platformCents),
        liquidity_amount: liqUsd, floor_amount: floorUsd,
        platform_rate: platformRate != null ? platformRate : 0.10, cashback_amount: 0,
      }),
    });
    if (!ins.ok && ins.status !== 201 && ins.status !== 204) throw new Error(`split insert ${ins.status}`);
    // upsert the pool (add pending liquidity/floor + total_from_sales) — read-modify-write
    const cur = await sbGet(`oneip_token_pools?creator_id=eq.${encodeURIComponent(creatorUuid)}&select=liquidity_pending,floor_pending,total_from_sales`);
    const base = cur.length ? cur[0] : { liquidity_pending: 0, floor_pending: 0, total_from_sales: 0 };
    await fetch(`${SUPABASE_URL}/rest/v1/oneip_token_pools?on_conflict=creator_id`, {
      method: "POST", keepalive: true,
      headers: h({ "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" }),
      body: JSON.stringify({
        creator_id: creatorUuid,
        liquidity_pending: num(base.liquidity_pending) + liqUsd,
        floor_pending: num(base.floor_pending) + floorUsd,
        total_from_sales: num(base.total_from_sales) + poolUsd,
        updated_at: new Date().toISOString(),
      }),
    });
    return { written: true };
  } catch (e) { return { error: String(e.message || e).slice(0, 200) }; }
}
