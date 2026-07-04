// Pro subscription ($10/mo) via Stripe Checkout. Keyed -> real Stripe; unkeyed -> dev mode
// (the server grants Pro instantly for local testing). Closes the loop with the AI clone,
// which is gated on a creator being `pro`.
import { createHmac, timingSafeEqual } from "node:crypto";

const KEY = process.env.STRIPE_SECRET_KEY || "";
const PRICE_AI = process.env.STRIPE_PRICE_ID || "";              // recurring $10/mo (AI clone)
const PRICE_PUBLISH = process.env.STRIPE_PRICE_ID_PUBLISH || ""; // recurring $39/mo (multi-platform)
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";

const priceFor = (tier) => (tier === "publish" ? PRICE_PUBLISH : PRICE_AI);

export function hasStripe() {
  return Boolean(KEY && (PRICE_AI || PRICE_PUBLISH));
}

/** Create a Stripe Checkout subscription session for a tier ("ai" | "publish").
 *  Returns {url} (live) or {devMode:true} (no key for that tier). */
export async function createCheckout(wallet, origin, tier = "ai") {
  const price = priceFor(tier);
  if (!KEY || !price) return { devMode: true, tier };
  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": price,
    "line_items[0][quantity]": "1",
    success_url: `${origin}/feed?pro=1`,
    cancel_url: `${origin}/feed`,
    "metadata[wallet]": wallet,
    "metadata[tier]": tier,
    "subscription_data[metadata][wallet]": wallet,
    "subscription_data[metadata][tier]": tier,
  });
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`stripe ${res.status}`);
  const data = await res.json();
  return { url: data.url };
}

/** Verify a Stripe webhook signature (Stripe-Signature: t=…,v1=…). Skips if no secret configured. */
export function verifyWebhook(raw, sigHeader) {
  if (!WEBHOOK_SECRET) return true;
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((kv) => kv.split("=")));
  if (!parts.t || !parts.v1) return false;
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(`${parts.t}.${raw}`).digest("hex");
  try { return timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1)); } catch { return false; }
}

/** Map a Stripe subscription event to {wallet, pro, tier}. Returns null for events we ignore. */
export function parseWebhook(raw) {
  let evt;
  try { evt = JSON.parse(raw); } catch { return null; }
  const obj = evt?.data?.object || {};
  const wallet = obj.metadata?.wallet;
  if (!wallet) return null;
  const tier = obj.metadata?.tier === "publish" ? "publish" : "ai";
  if (evt.type === "checkout.session.completed" || evt.type === "customer.subscription.created") return { wallet, pro: true, tier };
  if (evt.type === "customer.subscription.deleted") return { wallet, pro: false, tier: "" };
  return null;
}
