// Product-source adapter for the commerce closed-loop.
// A creator curates products (their own, or from a dropshipping supply chain); fans buy them in
// FIAT (handled in payments.js). The supplier ships (the creator holds NO inventory). This module
// owns only the catalog + placing the fulfillment order with the supplier.
//
// Phase 1 source = "manual": products are curated in the Studio. The SAME interface later gets a
// 1688-distribution / dropship-SaaS implementation — callers (orders.js, server routes) never change.
// Persistence goes through persist.js (Supabase KV on Vercel, data/shop_products.json locally).
import { randomBytes } from "node:crypto";
import { loadJson, saveJson } from "../persist.js";

const KEY = "shop_products"; // distinct from the legacy link-out "products" store
const SOURCE = process.env.COMMERCE_SOURCE || "manual"; // "manual" now; "alibaba1688" / "saas" later

let products = {}; // id -> product
let loaded = false;

const newId = () => "prod_" + randomBytes(6).toString("hex");

export async function load() {
  products = await loadJson(KEY, {});
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }
function persist() { saveJson(KEY, products); }

/** Add/curate a product. Money is in integer CENTS to avoid float drift.
 *  priceCents = what the fan pays (fiat);  costCents = supplier landed cost. */
// A monetizable item. `type` decides cost model + fulfillment + settle speed:
//   physical = merchant goods (supplier ships, refund window) — the default
//   digital  = paid video/photo/work/unlock (cost≈0, instant unlock of `contentUrl`)
//   nft      = minted collectible (later)
// (tips are ad-hoc, not catalog items — see orders.createTip.)
// BOUNDARY RULE (user-locked): the creator's own IP/content (digital/nft) is in the TOKEN
// PROGRAM (70/20/10, feeds the value pool). Merchant business verticals (physical goods) settle
// under a CATEGORY COMMISSION instead — `category` picks which one (mirrors corax platform_fee_config).
export const ITEM_TYPES = ["physical", "digital", "nft"];
export const CATEGORIES = ["retail", "fnb", "education"];

// Minimum listing prices per merchant category so the minimum commission can never consume the
// whole sale (a $1 retail item would net the seller $0 after the $1 minimum commission).
const MIN_PRICE_CENTS = {
  retail: Number(process.env.MIN_PRICE_RETAIL_CENTS || 300),   // ≥ $3
  fnb: Number(process.env.MIN_PRICE_FNB_CENTS || 800),         // ≥ $8 (min commission is $5)
  education: Number(process.env.MIN_PRICE_EDU_CENTS || 300),   // ≥ $3
};

export function addProduct({ creator, coin, title, image, description, priceCents, costCents, currency, sku, supplier, type, category, contentUrl }) {
  if (!creator) throw new Error("creator (account) required");
  if (!title) throw new Error("title required");
  const t = ITEM_TYPES.includes(type) ? type : "physical";
  // category applies to merchant (physical) items only; the token program ignores it.
  const cat = t === "physical" ? (CATEGORIES.includes(category) ? category : "retail") : "";
  const cost = Math.round(costCents || 0); // digital/nft default to 0 cost
  if (!(priceCents > 0)) throw new Error("priceCents must be > 0");
  if (cat && priceCents < MIN_PRICE_CENTS[cat])
    throw new Error(`${cat} items need a price of at least $${(MIN_PRICE_CENTS[cat] / 100).toFixed(2)} (so the minimum commission never nets you zero)`);
  if (cost < 0 || cost >= priceCents) throw new Error("costCents must be >= 0 and < priceCents");
  if (t === "digital" && !contentUrl) throw new Error("digital items need a contentUrl (the unlock payload)");
  const id = newId();
  products[id] = {
    id, creator, coin: coin || "", type: t, category: cat,
    title: String(title).slice(0, 200), image: image || "", description: (description || "").slice(0, 2000),
    priceCents: Math.round(priceCents), costCents: cost,
    currency: currency || "USD", sku: sku || "", supplier: supplier || SOURCE,
    contentUrl: t === "digital" ? String(contentUrl).slice(0, 1000) : "", // the paid content (kept private)
    active: true, source: SOURCE, createdAt: Date.now(),
  };
  persist();
  return products[id];
}

/** Public-safe view: never leak a digital item's `contentUrl` (that's what the fan pays to unlock). */
export function publicProduct(p) {
  if (!p) return p;
  const { contentUrl, ...rest } = p;
  return { ...rest, locked: p.type === "digital" };
}

export function setProduct(id, patch) {
  const p = products[id];
  if (!p) throw new Error("product not found");
  Object.assign(p, patch);
  persist();
  return p;
}

export function getProduct(id) { return products[id] || null; }

/** Re-point all of a creator's listings from their auto-pool placeholder to their real on-chain
 *  mint, once they launch it for real. Returns how many products were updated. */
export function repointCreatorCoin(creator, fromCoin, toCoin) {
  let n = 0;
  for (const p of Object.values(products)) {
    if (p.creator === creator && p.coin === fromCoin) { p.coin = toCoin; n++; }
  }
  if (n) persist();
  return n;
}

/** Storefront listing. A creator's landing page calls this with {creator} (and optionally {coin}). */
export function listProducts({ creator, coin, activeOnly = true } = {}) {
  return Object.values(products)
    .filter((p) => (!creator || p.creator === creator))
    .filter((p) => (!coin || p.coin === coin))
    .filter((p) => (!activeOnly || p.active))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(publicProduct);
}

const isLive = () => SOURCE !== "manual" && !!process.env.COMMERCE_SOURCE_API_KEY;

/** Hand the paid order to the supplier for fulfillment. Returns a supplier ref to track shipping.
 *  Manual/mock source synthesizes a ref (real 1688/SaaS adapter posts to their order API here). */
export async function placeSupplierOrder({ orderId, product, address }) {
  if (!isLive()) {
    return { supplierOrderRef: `mock-sup-${orderId}`, status: "accepted", mock: true };
  }
  // TODO real adapter: POST product.sku + address to the dropship API, return its order id.
  throw new Error(`live source '${SOURCE}' not implemented yet`);
}

/** Poll the supplier for shipping progress. Mock advances straight to "shipped". */
export async function supplierStatus(ref) {
  if (String(ref).startsWith("mock-sup-")) return { status: "shipped", tracking: "MOCKTRACK123", mock: true };
  throw new Error("live supplier status not implemented yet");
}
