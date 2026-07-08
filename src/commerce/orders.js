// Order lifecycle + the money math behind the closed loop. Fans pay in FIAT; the supplier ships;
// once the order SETTLES (delivered AND past the refund window) 20% of the NET profit funds the
// token floor via buyback.js.
//
//   pending -> paid -> shipped -> delivered -> SETTLED ──► triggers buyback
//                                          ↘ refunded / chargeback ──► no buyback
//
// IRON RULE: buyback fires ONLY on settle (after the refund window), never on `paid`. A refund
// before settle just ends the order — the floor never moves on money that might be clawed back.
import { randomBytes } from "node:crypto";
import * as source from "./source.js";
import * as buyback from "./buyback.js";
import * as accounts from "../accounts.js";
import { loadJson, saveJson } from "../persist.js";

const KEY = "orders";
// Payment-processor fee (Stripe-like 2.9% + 30c) deducted from gross before profit. Configurable.
const FEE_BPS = Number(process.env.PAYMENT_FEE_BPS || 290);
const FEE_FIXED_CENTS = Number(process.env.PAYMENT_FEE_FIXED_CENTS || 30);
// oneIP revenue split (user-locked). Net profit = gross fiat - supplier cost - payment fee = 100%,
// split THREE ways: 75% creator / 20% floor / 5% platform pool. (Same split for every type:
// product/digital/tip/reaction — tips & reactions just have zero cost.)
const FLOOR_BPS = Number(process.env.FLOOR_BPS || 2000);             // 20% of net -> floor buyback
const PLATFORM_POOL_BPS = Number(process.env.PLATFORM_POOL_BPS || 500); // 5% of net -> platform pool
// The 5% platform pool is itself sub-split, in bps OF NET (must sum to <= PLATFORM_POOL_BPS; the
// platform base keeps the remainder PLUS any empty partner/referrer slots). 0.5/1.0/1.0 -> base 2.5%.
const POOL_COUNTRY_BPS = Number(process.env.POOL_COUNTRY_BPS || 50);   // 0.5% country partner
const POOL_LOCAL_BPS = Number(process.env.POOL_LOCAL_BPS || 100);      // 1.0% local partner
const POOL_REFERRAL_BPS = Number(process.env.POOL_REFERRAL_BPS || 100);// 1.0% 1-gen referral
// Days after "delivered" before money is considered un-clawbackable and the buyback may fire.
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

/** The money math for one sale. Net profit = gross fiat - supplier cost - payment fee = 100%, then
 *  split 75% creator / 20% floor / 5% platform pool. The pool's 4-way sub-split (platform/country/
 *  local/referrer) is deferred to settle, when the parties + the 60-day referral gate are known. */
function computeNet(priceCents, costCents = 0) {
  const feeCents = paymentFee(priceCents);
  const netProfitCents = Math.max(0, priceCents - costCents - feeCents);
  const floorCents = Math.round((netProfitCents * FLOOR_BPS) / 10000);          // 20%
  const platformFeeCents = Math.round((netProfitCents * PLATFORM_POOL_BPS) / 10000); // 5% pool
  const creatorCents = netProfitCents - floorCents - platformFeeCents;          // 75% (remainder, exact)
  return { feeCents, netProfitCents, floorCents, platformFeeCents, creatorCents };
}

/** Split the 5% platform pool among platform / country partner / local partner / referrer, based on
 *  which parties are present for this sale. Empty slots fall back to the platform base, so the total
 *  is always exactly platformFeeCents (the merchant/creator never pay more for the channel). */
function splitPlatformPool(netProfitCents, platformFeeCents, parties) {
  const countryAgentCents = parties.countryAgentId ? Math.round((netProfitCents * POOL_COUNTRY_BPS) / 10000) : 0;
  const localAgentCents = parties.localAgentId ? Math.round((netProfitCents * POOL_LOCAL_BPS) / 10000) : 0;
  const referrerCents = parties.referrerActive ? Math.round((netProfitCents * POOL_REFERRAL_BPS) / 10000) : 0;
  const platformBaseCents = platformFeeCents - countryAgentCents - localAgentCents - referrerCents;
  return {
    countryAgentId: parties.countryAgentId || "", countryAgentCents,
    localAgentId: parties.localAgentId || "", localAgentCents,
    referrerHandle: parties.referrerHandle || "", referrerCents,
    platformBaseCents,
  };
}

// Only physical goods need shipping + a refund window; digital/tip/nft settle the instant payment
// clears (the money isn't clawed back), so the buyback can fund the floor immediately.
const isInstant = (type) => type !== "physical";

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
  const { feeCents, netProfitCents, floorCents, platformFeeCents, creatorCents } = computeNet(product.priceCents, product.costCents);
  const id = newId();
  orders[id] = blankOrder({
    id, type, productId, creator: product.creator, coin: product.coin,
    fan: fan || "", address: address || null,
    title: product.title, currency: product.currency,
    priceCents: product.priceCents, costCents: product.costCents,
    feeCents, netProfitCents, floorCents, platformFeeCents, creatorCents,
    deliverPayload: type === "digital" ? product.contentUrl : "", // revealed to the buyer on delivery
    content: null, unlocked: false,
  });
  persist();
  return orders[id];
}

/** Create a TIP order — ad-hoc, no catalog item. Fan picks the amount; cost is 0, so net = amount - fee. */
export function createTip({ creator, coin, amountCents, fan, currency }) {
  if (!creator) throw new Error("creator required");
  if (!(amountCents > 0)) throw new Error("amountCents must be > 0");
  const amt = Math.round(amountCents);
  const { feeCents, netProfitCents, floorCents, platformFeeCents, creatorCents } = computeNet(amt, 0);
  const id = newId();
  orders[id] = blankOrder({
    id, type: "tip", productId: null, creator, coin: coin || "",
    fan: fan || "", address: null,
    title: "Tip", currency: currency || "USD",
    priceCents: amt, costCents: 0, feeCents, netProfitCents, floorCents, platformFeeCents, creatorCents,
    deliverPayload: "", content: null, unlocked: false,
  });
  persist();
  return orders[id];
}

/** Create a paid EMOJI REACTION order — a fixed-price tip tagged with an emoji + a target
 *  (product/post/creator). Same economics as a tip: 5% platform fee + payment fee, rest → 20%
 *  floor + creator. Settles instantly like a tip. */
export function createReaction({ creator, coin, amountCents, emoji, target, reactionKey, fan, currency }) {
  if (!creator) throw new Error("creator required");
  if (!(amountCents > 0)) throw new Error("amountCents must be > 0");
  const amt = Math.round(amountCents);
  const { feeCents, netProfitCents, floorCents, platformFeeCents, creatorCents } = computeNet(amt, 0);
  const id = newId();
  orders[id] = blankOrder({
    id, type: "reaction", productId: null, creator, coin: coin || "",
    fan: fan || "", address: null,
    title: emoji || "Reaction", currency: currency || "USD",
    emoji: emoji || "", target: target || "", reactionKey: reactionKey || "",
    priceCents: amt, costCents: 0, feeCents, netProfitCents, floorCents, platformFeeCents, creatorCents,
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
 *  (digital/tip/nft) -> deliver immediately and settle (no shipping, no refund window),
 *  so the buyback funds the floor right away. Returns the (possibly settled) order. */
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

/** Refund/chargeback — only valid BEFORE settle. Ends the order; the floor is never touched. */
export function refund(id, reason) {
  const o = orders[id]; if (!o) throw new Error("order not found");
  if (o.status === "settled") throw new Error("cannot refund a settled order (buyback already funded the floor)");
  o.status = "refunded"; o.refundedAt = Date.now(); o.refundReason = reason || "";
  persist();
  return o;
}

/** Whether an order has cleared its refund window and may settle. */
export function settleEligible(o, now = Date.now()) {
  return o.status === "delivered" && o.deliveredAt && now - o.deliveredAt >= REFUND_WINDOW_DAYS * 864e5;
}

/** Settle a delivered order: 20% of net profit -> floor buyback. `force` skips the refund-window
 *  wait (used by smoke/admin). Returns the order with its buyback record attached. */
export async function settle(id, { force = false } = {}) {
  const o = orders[id]; if (!o) throw new Error("order not found");
  if (o.status === "settled") return o; // idempotent
  requireStatus(o, "delivered");
  if (!force && !settleEligible(o)) throw new Error(`refund window (${REFUND_WINDOW_DAYS}d) not elapsed`);
  // Resolve the channel parties + evaluate the 60-day referral gate (this mutates the creator's
  // activity state, so it runs exactly once — settle is idempotent above). Then sub-split the 5% pool.
  await accounts.ensureLoaded();
  const parties = accounts.resolveSaleParties(o.creator, Date.now());
  o.payout = splitPlatformPool(o.netProfitCents, o.platformFeeCents || 0, parties);
  const rec = await buyback.execute({ coin: o.coin, orderId: o.id, netProfitCents: o.netProfitCents });
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
