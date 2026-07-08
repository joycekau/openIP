// Order lifecycle + the money math behind the closed loop. Fans pay in FIAT; the supplier ships;
// physical orders settle after the refund window, digital/tip/reaction settle instantly.
//
//   pending -> paid -> shipped -> delivered -> SETTLED ──► triggers pool buyback (digital only)
//                                          ↘ refunded / chargeback ──► no buyback
//
// UNIFIED SPLIT (user-locked 2026-07-08, same numbers on oneIP and corax.live channels):
//   • DIGITAL goods & services (digital / tip / reaction / nft — the token program):
//       sale price = 70% creator + 20% token pool + 10% platform
//       The 20% pool splits 80% liquidity / 20% floor (matching the on-chain buy mechanics).
//       Payment/settlement costs are ABSORBED by the platform out of its 10% (no off-the-top
//       settlement fee) — the fan-facing math is a clean 70/20/10 of the price.
//   • PHYSICAL goods (merchant verticals) are NOT in the token program (no pool routing). They
//       pay a category commission — retail 5% min $1 / F&B 8% min $5 / education 5% min $1,
//       mirroring corax platform_fee_config. The seller's ONLY fee is the commission: the
//       payment-processor cost is absorbed by the platform out of its commission (same rule as
//       digital's 10%), so the creator keeps price − commission − supplier cost.
//
// IRON RULE: buyback fires ONLY on settle, never on `paid`. A refund before settle just ends the
// order — the pool never moves on money that might be clawed back.
import { randomBytes } from "node:crypto";
import * as source from "./source.js";
import * as buyback from "./buyback.js";
import * as accounts from "../accounts.js";
import { loadJson, saveJson } from "../persist.js";

const KEY = "orders";
// Payment-processor fee (Stripe-like 2.9% + 30c). Informational for digital (absorbed by the
// platform's 10%); deducted from the creator's remainder for physical (a real fulfilment cost).
const FEE_BPS = Number(process.env.PAYMENT_FEE_BPS || 290);
const FEE_FIXED_CENTS = Number(process.env.PAYMENT_FEE_FIXED_CENTS || 30);
// Digital split (bps of the sale price). Must sum to 10000.
const CREATOR_BPS = Number(process.env.CREATOR_BPS || 7000);        // 70% creator
const POOL_BPS = Number(process.env.POOL_BPS || 2000);              // 20% token pool
const PLATFORM_BPS = Number(process.env.PLATFORM_BPS || 1000);      // 10% platform (absorbs settlement)
// The 20% pool composition (matches the on-chain buy: ~80% curve liquidity / ~20% floor vault).
const POOL_LIQ_BPS = Number(process.env.POOL_LIQ_BPS || 8000);      // 80% of pool -> liquidity
// Merchant category commissions (mirror corax platform_fee_config): bps of gross + minimum.
const CATEGORY_FEES = {
  retail: { bps: Number(process.env.RETAIL_COMMISSION_BPS || 500), minCents: Number(process.env.RETAIL_MIN_FEE_CENTS || 100) },      // 5%, min $1
  fnb: { bps: Number(process.env.FNB_COMMISSION_BPS || 800), minCents: Number(process.env.FNB_MIN_FEE_CENTS || 500) },               // 8%, min $5
  education: { bps: Number(process.env.EDU_COMMISSION_BPS || 500), minCents: Number(process.env.EDU_MIN_FEE_CENTS || 100) },         // 5%, min $1
};
// The platform's take is itself sub-split among channel partners, in bps OF THE SALE PRICE
// (empty slots fall back to the platform base — the creator/pool never pay more for the channel).
const POOL_COUNTRY_BPS = Number(process.env.POOL_COUNTRY_BPS || 50);   // 0.5% country partner
const POOL_LOCAL_BPS = Number(process.env.POOL_LOCAL_BPS || 100);      // 1.0% local partner
const POOL_REFERRAL_BPS = Number(process.env.POOL_REFERRAL_BPS || 100);// 1.0% 1-gen referral
// Days after "delivered" before money is considered un-clawbackable and a physical order may settle.
const REFUND_WINDOW_DAYS = Number(process.env.REFUND_WINDOW_DAYS || 7);

let orders = {}; // id -> order
let loaded = false;

const newId = () => "ord_" + randomBytes(8).toString("hex");

export async function load() {
  orders = await loadJson(KEY, {});
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }
function persist() { saveJson(KEY, orders); }

const paymentFee = (gross) => Math.round((gross * FEE_BPS) / 10000) + FEE_FIXED_CENTS;

// Only physical goods need shipping + a refund window; digital/tip/nft/reaction settle the instant
// payment clears, so the buyback can fund the pool immediately.
const isInstant = (type) => type !== "physical";

/** The money math for one sale.
 *  Digital (token program): price = 70% creator + 20% pool + 10% platform.
 *  Physical (merchant): category commission (retail/fnb/education) to the platform; creator keeps
 *  price − commission − supplier cost; no pool.
 *  BOTH: the payment-processor fee is absorbed by the platform's cut — the seller's only fee is
 *  the split/commission, and the buyer always pays exactly the sticker price. */
function computeSplit(priceCents, costCents, type, category) {
  const feeCents = paymentFee(priceCents);
  if (isInstant(type)) {
    const poolCents = Math.round((priceCents * POOL_BPS) / 10000);
    const platformFeeCents = Math.round((priceCents * PLATFORM_BPS) / 10000);
    const creatorCents = priceCents - poolCents - platformFeeCents; // 70% (remainder, exact)
    const liquidityCents = Math.round((poolCents * POOL_LIQ_BPS) / 10000);
    return {
      feeCents, feeAbsorbed: true, category: "",
      netProfitCents: priceCents,      // split base (kept for back-compat with reports)
      poolCents, liquidityCents, floorCents: poolCents - liquidityCents,
      platformFeeCents, creatorCents,
    };
  }
  const cat = CATEGORY_FEES[category] ? category : "retail";
  const fee = CATEGORY_FEES[cat];
  const platformFeeCents = Math.max(Math.round((priceCents * fee.bps) / 10000), fee.minCents);
  const creatorCents = Math.max(0, priceCents - platformFeeCents - (costCents || 0));
  return {
    feeCents, feeAbsorbed: true, category: cat,
    netProfitCents: Math.max(0, priceCents - (costCents || 0)),
    poolCents: 0, liquidityCents: 0, floorCents: 0,
    platformFeeCents, creatorCents,
  };
}

/** Split the platform take among platform / country partner / local partner / referrer, based on
 *  which parties are present for this sale. Cuts are bps of the sale price, capped so the total is
 *  always exactly platformFeeCents (the creator and pool never pay more for the channel). */
function splitPlatformPool(baseCents, platformFeeCents, parties) {
  let remaining = platformFeeCents;
  const take = (bps, on) => {
    if (!on) return 0;
    const cut = Math.min(Math.round((baseCents * bps) / 10000), Math.max(0, remaining));
    remaining -= cut;
    return cut;
  };
  const countryAgentCents = take(POOL_COUNTRY_BPS, parties.countryAgentId);
  const localAgentCents = take(POOL_LOCAL_BPS, parties.localAgentId);
  const referrerCents = take(POOL_REFERRAL_BPS, parties.referrerActive);
  return {
    countryAgentId: parties.countryAgentId || "", countryAgentCents,
    localAgentId: parties.localAgentId || "", localAgentCents,
    referrerHandle: parties.referrerHandle || "", referrerCents,
    platformBaseCents: remaining,
  };
}

function blankOrder(extra) {
  return {
    status: "pending", supplierOrderRef: null, buyback: null,
    createdAt: Date.now(), paidAt: null, shippedAt: null, deliveredAt: null, settledAt: null, refundedAt: null,
    ...extra,
  };
}

/** Create a pending order from a catalog item (physical/digital/nft). Snapshots price/cost so later
 *  product edits can't retroactively change a placed order's economics. */
export function create({ productId, fan, address }) {
  const product = source.getProduct(productId);
  if (!product) throw new Error("product not found");
  if (!product.active) throw new Error("product not available");
  const type = product.type || "physical";
  const split = computeSplit(product.priceCents, product.costCents, type, product.category);
  const id = newId();
  orders[id] = blankOrder({
    id, type, productId, creator: product.creator, coin: product.coin,
    fan: fan || "", address: address || null,
    title: product.title, currency: product.currency,
    priceCents: product.priceCents, costCents: product.costCents,
    ...split,
    deliverPayload: type === "digital" ? product.contentUrl : "", // revealed to the buyer on delivery
    content: null, unlocked: false,
  });
  persist();
  return orders[id];
}

/** Create a TIP order — ad-hoc, no catalog item. Digital economics: 70/20/10 of the amount. */
export function createTip({ creator, coin, amountCents, fan, currency }) {
  if (!creator) throw new Error("creator required");
  if (!(amountCents > 0)) throw new Error("amountCents must be > 0");
  const amt = Math.round(amountCents);
  const split = computeSplit(amt, 0, "tip");
  const id = newId();
  orders[id] = blankOrder({
    id, type: "tip", productId: null, creator, coin: coin || "",
    fan: fan || "", address: null,
    title: "Tip", currency: currency || "USD",
    priceCents: amt, costCents: 0, ...split,
    deliverPayload: "", content: null, unlocked: false,
  });
  persist();
  return orders[id];
}

/** Create a paid EMOJI REACTION order — a fixed-price tip tagged with an emoji + a target
 *  (product/post/creator). Digital economics: 70/20/10, settles instantly. */
export function createReaction({ creator, coin, amountCents, emoji, target, reactionKey, fan, currency }) {
  if (!creator) throw new Error("creator required");
  if (!(amountCents > 0)) throw new Error("amountCents must be > 0");
  const amt = Math.round(amountCents);
  const split = computeSplit(amt, 0, "reaction");
  const id = newId();
  orders[id] = blankOrder({
    id, type: "reaction", productId: null, creator, coin: coin || "",
    fan: fan || "", address: null,
    title: emoji || "Reaction", currency: currency || "USD",
    emoji: emoji || "", target: target || "", reactionKey: reactionKey || "",
    priceCents: amt, costCents: 0, ...split,
    deliverPayload: "", content: null, unlocked: false,
  });
  persist();
  return orders[id];
}

export function get(id) { return orders[id] || null; }

/** Public-safe view: hide the digital payload until it's actually unlocked (paid). */
export function publicOrder(o) {
  if (!o) return o;
  const { deliverPayload, ...rest } = o;
  return rest; // `content` is only set once unlocked; deliverPayload (pre-unlock secret) is dropped
}
export function list({ creator, coin, status } = {}) {
  return Object.values(orders)
    .filter((o) => (!creator || o.creator === creator))
    .filter((o) => (!coin || o.coin === coin))
    .filter((o) => (!status || o.status === status))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function requireStatus(o, ...allowed) {
  if (!allowed.includes(o.status)) throw new Error(`order is '${o.status}', expected ${allowed.join("/")}`);
}

/** Fiat payment cleared. Physical -> hand to supplier for fulfillment. Instant types
 *  (digital/tip/nft/reaction) -> deliver immediately and settle (no shipping, no refund window),
 *  so the buyback funds the pool right away. Returns the (possibly settled) order. */
export async function markPaid(id) {
  const o = orders[id]; if (!o) throw new Error("order not found");
  requireStatus(o, "pending");
  o.status = "paid"; o.paidAt = Date.now();
  if (!isInstant(o.type)) {
    const sup = await source.placeSupplierOrder({ orderId: id, product: source.getProduct(o.productId), address: o.address });
    o.supplierOrderRef = sup.supplierOrderRef;
    persist();
    return o;
  }
  // instant: deliver (unlock digital content) then settle -> buyback
  o.status = "delivered"; o.deliveredAt = Date.now();
  if (o.type === "digital") { o.unlocked = true; o.content = o.deliverPayload || ""; }
  persist();
  return settle(id, { force: true });
}

export function markShipped(id, tracking) {
  const o = orders[id]; if (!o) throw new Error("order not found");
  requireStatus(o, "paid");
  o.status = "shipped"; o.shippedAt = Date.now(); o.tracking = tracking || o.tracking || "";
  persist();
  return o;
}

export function markDelivered(id) {
  const o = orders[id]; if (!o) throw new Error("order not found");
  requireStatus(o, "shipped");
  o.status = "delivered"; o.deliveredAt = Date.now();
  persist();
  return o;
}

/** Refund/chargeback — only valid BEFORE settle. Ends the order; the pool is never touched. */
export function refund(id, reason) {
  const o = orders[id]; if (!o) throw new Error("order not found");
  if (o.status === "settled") throw new Error("cannot refund a settled order (buyback already funded the pool)");
  o.status = "refunded"; o.refundedAt = Date.now(); o.refundReason = reason || "";
  persist();
  return o;
}

/** Whether an order has cleared its refund window and may settle. */
export function settleEligible(o, now = Date.now()) {
  return o.status === "delivered" && o.deliveredAt && now - o.deliveredAt >= REFUND_WINDOW_DAYS * 864e5;
}

/** Settle a delivered order: the order's 20% pool share funds the token pool via buyback (digital
 *  only — physical is outside the token program). `force` skips the refund-window wait. */
export async function settle(id, { force = false } = {}) {
  const o = orders[id]; if (!o) throw new Error("order not found");
  if (o.status === "settled") return o; // idempotent
  requireStatus(o, "delivered");
  if (!force && !settleEligible(o)) throw new Error(`refund window (${REFUND_WINDOW_DAYS}d) not elapsed`);
  // Resolve the channel parties + evaluate the 60-day referral gate (this mutates the creator's
  // activity state, so it runs exactly once — settle is idempotent above). Then sub-split the take.
  await accounts.ensureLoaded();
  const parties = accounts.resolveSaleParties(o.creator, Date.now());
  o.payout = splitPlatformPool(o.priceCents, o.platformFeeCents || 0, parties);
  const rec = (o.poolCents || 0) > 0
    ? await buyback.execute({ coin: o.coin, orderId: o.id, poolCents: o.poolCents })
    : { skipped: true, reason: "physical goods are outside the token program (no pool share)" };
  o.status = "settled"; o.settledAt = Date.now(); o.buyback = rec;
  persist();
  return o;
}

/** Channel-payout ledger: sum each settled order's recorded cuts by party (country/local partner
 *  and referrer). What the platform OWES out of the fees it has already collected. */
export function payouts() {
  const partners = {}; // agentId -> cents
  const referrers = {}; // handle -> cents
  let platformBase = 0, pool = 0;
  for (const o of Object.values(orders)) {
    if (o.status !== "settled" || !o.payout) continue;
    pool += o.platformFeeCents || 0;
    platformBase += o.payout.platformBaseCents || 0;
    if (o.payout.countryAgentId) partners[o.payout.countryAgentId] = (partners[o.payout.countryAgentId] || 0) + (o.payout.countryAgentCents || 0);
    if (o.payout.localAgentId) partners[o.payout.localAgentId] = (partners[o.payout.localAgentId] || 0) + (o.payout.localAgentCents || 0);
    if (o.payout.referrerHandle) referrers[o.payout.referrerHandle] = (referrers[o.payout.referrerHandle] || 0) + (o.payout.referrerCents || 0);
  }
  return {
    platformPoolUsd: pool / 100,
    platformBaseUsd: platformBase / 100,
    partners: Object.entries(partners).map(([id, c]) => ({ id, usd: c / 100 })).sort((a, b) => b.usd - a.usd),
    referrers: Object.entries(referrers).map(([handle, c]) => ({ handle, usd: c / 100 })).sort((a, b) => b.usd - a.usd),
  };
}
