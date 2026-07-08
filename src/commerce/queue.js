// Shared "paid orders" queue — the handoff mailbox between the two doors (oneip.io + corax.live
// channels) and the ONE settlement engine.
//
//   fan pays on oneip.io ──┐
//                          ├─► enqueue({ source, ... }) ─► [ one engine drains ] ─► split · pool · buyback
//   fan pays in a channel ─┘        (this queue)
//
// Each door only captures payment natively, then drops one row here. The engine (drain, in
// server.js) reads pending rows and settles each identically, so the economics live in exactly one
// place regardless of which door the sale came from.
//
// Two storage modes (mirrors persist.js):
//   • Supabase (prod / both apps): the relational table `oneip_settle_queue`. Per-row INSERT with a
//     unique (source, order_ref) constraint → the DATABASE enforces idempotency (webhook retries /
//     at-least-once delivery can't double-settle) and there's no lost-write risk under concurrency.
//   • File (local dev): a JSON blob via persist.js — fine when there's no concurrency.
import { loadJson, saveJsonNow } from "../persist.js";

const KEY = "settle_queue";
const TABLE = "oneip_settle_queue";
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "";
const useDb = Boolean(SUPABASE_URL && SUPABASE_KEY);

// ---- file-mode state (only used when not on Supabase) ----
let rows = {}; // dedupeKey -> row
let loaded = false;
const dedupeKey = (source, orderRef) => `${source}:${orderRef}`;

export async function load() {
  if (useDb) { loaded = true; return; }      // DB mode is stateless — nothing to preload
  rows = await loadJson(KEY, {});
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }

// ---- Supabase (PostgREST) helpers ----
function h(extra) { return { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, ...extra }; }
const toRow = (r) => ({
  source: r.source, orderRef: r.order_ref, creator: r.creator, coin: r.coin || "",
  type: r.type, category: r.category || "", amountCents: r.amount_cents, currency: r.currency || "USD",
  fan: r.fan || "", target: r.target || "", reactionKey: r.reaction_key || "", contentUrl: r.content_url || "",
  channelId: r.channel_id || "", status: r.status, orderId: r.order_id || null, error: r.error || null,
  enqueuedAt: r.enqueued_at, settledAt: r.settled_at,
});

const normType = (t) => (["physical", "digital", "nft", "tip", "reaction"].includes(t) ? t : "digital");

/** A door drops a paid sale here. `source` = "oneip" | "corax"; `orderRef` = that door's order id.
 *  Returns { queued, duplicate, row }. Idempotent on (source, orderRef). */
export async function enqueue({ source, orderRef, creator, coin, type, category, amountCents, currency, fan, target, reactionKey, contentUrl, channelId }) {
  if (!source || !orderRef) throw new Error("source and orderRef required");
  if (!creator) throw new Error("creator required");
  if (!(amountCents > 0)) throw new Error("amountCents must be > 0");
  const rec = {
    source, order_ref: String(orderRef), creator, coin: coin || "", type: normType(type), category: category || "",
    amount_cents: Math.round(amountCents), currency: currency || "USD", fan: fan || "",
    target: target || "", reaction_key: reactionKey || "", content_url: contentUrl || "", channel_id: channelId || "",
    status: "pending",
  };
  if (useDb) {
    // INSERT; on unique-conflict do nothing and return the existing row → DB-enforced idempotency.
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=source,order_ref`, {
      method: "POST", keepalive: true,
      headers: h({ "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=representation" }),
      body: JSON.stringify(rec),
    });
    if (!ins.ok && ins.status !== 201 && ins.status !== 200) throw new Error(`queue insert ${ins.status}: ${await ins.text().catch(() => "")}`);
    const arr = await ins.json().catch(() => []);
    if (arr.length) return { queued: true, duplicate: false, row: toRow(arr[0]) };
    // empty body = conflict ignored → fetch the pre-existing row
    const existing = await dbGet(source, orderRef);
    return { queued: false, duplicate: true, row: existing };
  }
  await ensureLoaded();
  const key = dedupeKey(source, orderRef);
  if (rows[key]) return { queued: false, duplicate: true, row: rows[key] };
  rows[key] = { ...toRow({ ...rec, enqueued_at: new Date(0).toISOString() }), enqueuedAt: Date.now(), settledAt: null };
  await saveJsonNow(KEY, rows);
  return { queued: true, duplicate: false, row: rows[key] };
}

async function dbGet(source, orderRef) {
  const u = `${SUPABASE_URL}/rest/v1/${TABLE}?source=eq.${encodeURIComponent(source)}&order_ref=eq.${encodeURIComponent(orderRef)}&select=*`;
  const r = await fetch(u, { headers: h() });
  const arr = await r.json().catch(() => []);
  return arr.length ? toRow(arr[0]) : null;
}

/** All rows still awaiting settlement, oldest first (FIFO). */
export async function pending() {
  if (useDb) {
    const u = `${SUPABASE_URL}/rest/v1/${TABLE}?status=eq.pending&select=*&order=enqueued_at.asc`;
    const r = await fetch(u, { headers: h() });
    const arr = await r.json().catch(() => []);
    return arr.map(toRow);
  }
  await ensureLoaded();
  return Object.values(rows).filter((r) => r.status === "pending").sort((a, b) => a.enqueuedAt - b.enqueuedAt);
}

/** Mark a row settled (engine calls this after the split + buyback succeed). Idempotent. */
export async function markSettled(source, orderRef, orderId) {
  if (useDb) {
    const u = `${SUPABASE_URL}/rest/v1/${TABLE}?source=eq.${encodeURIComponent(source)}&order_ref=eq.${encodeURIComponent(orderRef)}&status=eq.pending`;
    await fetch(u, { method: "PATCH", keepalive: true, headers: h({ "content-type": "application/json", prefer: "return=minimal" }),
      body: JSON.stringify({ status: "settled", settled_at: new Date().toISOString(), order_id: orderId || null, error: null }) });
    return;
  }
  const r = rows[dedupeKey(source, orderRef)];
  if (r && r.status !== "settled") { r.status = "settled"; r.settledAt = Date.now(); r.orderId = orderId || r.orderId; r.error = null; await saveJsonNow(KEY, rows); }
}

/** Mark a row failed — stays status:"pending" (via `error`) so the next drain retries it. */
export async function markError(source, orderRef, message) {
  const msg = String(message || "").slice(0, 300);
  if (useDb) {
    const u = `${SUPABASE_URL}/rest/v1/${TABLE}?source=eq.${encodeURIComponent(source)}&order_ref=eq.${encodeURIComponent(orderRef)}`;
    await fetch(u, { method: "PATCH", keepalive: true, headers: h({ "content-type": "application/json", prefer: "return=minimal" }), body: JSON.stringify({ error: msg }) });
    return;
  }
  const r = rows[dedupeKey(source, orderRef)];
  if (r) { r.error = msg; await saveJsonNow(KEY, rows); }
}

/** Snapshot for the admin overview. */
export async function snapshot() {
  let all;
  if (useDb) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${TABLE}?select=*&order=enqueued_at.desc&limit=500`, { headers: h() });
    all = (await r.json().catch(() => [])).map(toRow);
  } else {
    await ensureLoaded();
    all = Object.values(rows).sort((a, b) => b.enqueuedAt - a.enqueuedAt);
  }
  const bySource = {};
  for (const r of all) { bySource[r.source] = bySource[r.source] || { pending: 0, settled: 0 }; bySource[r.source][r.status] = (bySource[r.source][r.status] || 0) + 1; }
  return {
    backend: useDb ? "supabase" : "file",
    total: all.length,
    pending: all.filter((r) => r.status === "pending").length,
    settled: all.filter((r) => r.status === "settled").length,
    errored: all.filter((r) => r.error).length,
    bySource, recent: all.slice(0, 50),
  };
}
