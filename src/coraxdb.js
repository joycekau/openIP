// CoraX relational bridge — writes oneIP state into CoraX's Supabase tables (the relational model
// that lives alongside the repo's KV store). Uses the service-role key server-side (bypasses RLS),
// exactly like persist.js. Degrades gracefully: with no SUPABASE creds it's a no-op (hasCoraxDb()
// is false) so local/file mode keeps working.
//
// This is the missing link between "draft token created when a creator lists a product" (the DB
// trigger on channel_products) and "token launched on-chain" (the wallet-signed create_token): the
// launch-complete endpoint calls markTokenLaunched() to flip the draft row to launched with the real
// mint address.
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  "";

export function hasCoraxDb() {
  return Boolean(SUPABASE_URL && SUPABASE_KEY);
}

function headers(extra) {
  return { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, ...extra };
}
const enc = encodeURIComponent;

// Flip a creator's DRAFT token to launched, swapping the 'draft:<uid>' placeholder for the real mint.
// Idempotent by design: matches only rows still in launch_status='draft', so replaying the call after
// the row is already launched updates nothing. Returns the updated row(s) (usually 0 or 1).
export async function markTokenLaunched({ creatorId, mint, decimals, totalSupply }) {
  if (!hasCoraxDb()) throw new Error("SUPABASE not configured");
  if (!creatorId || !mint) throw new Error("creatorId and mint required");
  const patch = { mint_address: mint, launch_status: "launched", launched_at: new Date().toISOString() };
  if (decimals != null) patch.decimals = Number(decimals);
  if (totalSupply != null) patch.total_supply = Number(totalSupply);
  const u = `${SUPABASE_URL}/rest/v1/oneip_creator_tokens?creator_id=eq.${enc(creatorId)}&launch_status=eq.draft`;
  const r = await fetch(u, {
    method: "PATCH",
    keepalive: true,
    headers: headers({ "content-type": "application/json", prefer: "return=representation" }),
    body: JSON.stringify(patch),
  });
  if (!r.ok) throw new Error(`markTokenLaunched: ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}

// Fallback for creators who mint WITHOUT ever having a draft (e.g. wallet-first, never listed a
// product). Inserts a launched row directly. mint_address is UNIQUE, so a duplicate mint 409s.
export async function insertLaunchedToken({ creatorId, mint, name, symbol, decimals, totalSupply }) {
  if (!hasCoraxDb()) throw new Error("SUPABASE not configured");
  if (!creatorId || !mint || !name || !symbol) throw new Error("creatorId, mint, name, symbol required");
  const row = {
    creator_id: creatorId, mint_address: mint, name, symbol,
    launch_status: "launched", launched_at: new Date().toISOString(),
  };
  if (decimals != null) row.decimals = Number(decimals);
  if (totalSupply != null) row.total_supply = Number(totalSupply);
  const u = `${SUPABASE_URL}/rest/v1/oneip_creator_tokens`;
  const r = await fetch(u, {
    method: "POST",
    keepalive: true,
    headers: headers({ "content-type": "application/json", prefer: "return=representation" }),
    body: JSON.stringify(row),
  });
  if (!r.ok) throw new Error(`insertLaunchedToken: ${r.status} ${await r.text().catch(() => "")}`);
  return r.json();
}

// Read a creator's token row (for verification / read-after-write).
export async function getTokenByCreator(creatorId) {
  if (!hasCoraxDb() || !creatorId) return null;
  const u = `${SUPABASE_URL}/rest/v1/oneip_creator_tokens?creator_id=eq.${enc(creatorId)}&select=*`;
  const r = await fetch(u, { headers: headers() });
  if (!r.ok) throw new Error(`getTokenByCreator: ${r.status} ${await r.text().catch(() => "")}`);
  const rows = await r.json();
  return rows[0] || null;
}
