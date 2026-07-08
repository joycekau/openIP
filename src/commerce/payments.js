// Fiat checkout for product orders. Fans pay with money (card / SEA local methods via the PSP) —
// they never touch crypto. Keyed -> real Stripe Checkout (one-time `payment` mode); unkeyed ->
// dev mode (the server marks the order paid instantly for local testing). Mirrors billing.js.
//
// SEA local payment methods (GCash/GrabPay/Maya/DANA/ShopeePay) are enabled per Stripe account /
// local PSP — wired via STRIPE_PAYMENT_METHODS once the live account supports them.
import { createHmac, timingSafeEqual } from "node:crypto";

const KEY = process.env.STRIPE_SECRET_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_SHOP_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET || "";
// comma-separated, e.g. "card,grabpay,alipay" — left empty = Stripe account default
const METHODS = (process.env.STRIPE_PAYMENT_METHODS || "").split(",").map((s) => s.trim()).filter(Boolean);

export function hasStripe() { return Boolean(KEY); }

/** Create a one-time Checkout session for an order. Returns {url} (live) or {devMode:true}. */
export async function createCheckout(order, origin) {
  if (!KEY) return { devMode: true, orderId: order.id };
  const params = {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": (order.currency || "USD").toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(order.priceCents),
    "line_items[0][price_data][product_data][name]": order.title || "Order",
    success_url: `${origin}/coin?mint=${order.coin}&paid=${order.id}`,
    cancel_url: `${origin}/coin?mint=${order.coin}`,
    "metadata[orderId]": order.id,
  };
  METHODS.forEach((m, i) => (params[`payment_method_types[${i}]`] = m));
  const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new Error(`stripe ${res.status}`);
  const data = await res.json();
  return { url: data.url };
}

/** Verify a Stripe webhook signature (same scheme as billing.js). Skips if no secret set. */
export function verifyWebhook(raw, sigHeader) {
  if (!WEBHOOK_SECRET) return true;
  if (!sigHeader) return false;
  const parts = Object.fromEntries(sigHeader.split(",").map((kv) => kv.split("=")));
  if (!parts.t || !parts.v1) return false;
  const expected = createHmac("sha256", WEBHOOK_SECRET).update(`${parts.t}.${raw}`).digest("hex");
  try { return timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1)); } catch { return false; }
}

/** Map a Stripe payment event to {orderId, paid}. Returns null for events we ignore. */
export function parseWebhook(raw) {
  let evt; try { evt = JSON.parse(raw); } catch { return null; }
  const obj = evt?.data?.object || {};
  const orderId = obj.metadata?.orderId;
  if (!orderId) return null;
  if (evt.type === "checkout.session.completed" || evt.type === "payment_intent.succeeded") return { orderId, paid: true };
  return null;
}
