// Dual-mode persistence for the OpenIP launchpad.
//   • Supabase mode (serverless / Vercel): stores each JSON blob as a row in the `openip_kv`
//     table via the PostgREST API. Writes are immediate + keepalive so they survive a function
//     freeze. Enabled when SUPABASE_URL + a key are set.
//   • File mode (local dev / a persistent Node host like Render): reads/writes data/<name>.json,
//     debounced. This is the original behaviour, kept so nothing breaks off Vercel.
//
// The launchpad modules call loadJson(name, fallback) on startup and saveJson(name, value) on every
// change — exactly mirroring the old readFile/writeFile pattern, so the swap is mechanical.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "..", "data");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  "";
const TABLE = process.env.SUPABASE_KV_TABLE || "openip_kv";

export const backend = SUPABASE_URL && SUPABASE_KEY ? "supabase" : "file";

// ---- Supabase (PostgREST) ----
function sbHeaders(extra) {
  return { apikey: SUPABASE_KEY, authorization: `Bearer ${SUPABASE_KEY}`, ...extra };
}
async function sbGet(key) {
  const u = `${SUPABASE_URL}/rest/v1/${TABLE}?key=eq.${encodeURIComponent(key)}&select=value`;
  const r = await fetch(u, { headers: sbHeaders() });
  if (!r.ok) throw new Error(`kv get ${key}: ${r.status} ${await r.text().catch(() => "")}`);
  const rows = await r.json();
  return rows.length ? rows[0].value : undefined;
}
async function sbPut(key, value) {
  const u = `${SUPABASE_URL}/rest/v1/${TABLE}?on_conflict=key`;
  const r = await fetch(u, {
    method: "POST",
    keepalive: true, // survive a serverless freeze after the response is sent
    headers: sbHeaders({ "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" }),
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }),
  });
  if (!r.ok && r.status !== 201 && r.status !== 204) {
    throw new Error(`kv put ${key}: ${r.status} ${await r.text().catch(() => "")}`);
  }
}

// ---- File fallback ----
const fileTimers = {};
async function fileGet(name) {
  try { return JSON.parse(await readFile(join(DATA, `${name}.json`), "utf8")); } catch { return undefined; }
}
function fileWrite(name, value) {
  clearTimeout(fileTimers[name]);
  fileTimers[name] = setTimeout(
    () => writeFile(join(DATA, `${name}.json`), JSON.stringify(value, null, 2)).catch(() => {}),
    200,
  );
}

// ---- Public API ----
export async function loadJson(name, fallback) {
  try {
    const v = backend === "supabase" ? await sbGet(name) : await fileGet(name);
    return v === undefined ? fallback : v;
  } catch (e) {
    console.error(`[persist] load ${name} failed:`, e.message);
    return fallback;
  }
}

export function saveJson(name, value) {
  if (backend === "supabase") {
    // fire immediately (keepalive) — do not await; callers persist in the background as before
    sbPut(name, value).catch((e) => console.error(`[persist] save ${name} failed:`, e.message));
  } else {
    fileWrite(name, value);
  }
}

// Awaited write — use for read-after-write flows (ledgers, inventory) where a following request
// must see this write. In file mode it bypasses the debounce (which otherwise coalesces rapid
// writes to the same key and drops all but the last = lost update). In Supabase mode it awaits the
// PostgREST upsert instead of firing-and-forgetting.
export async function saveJsonNow(name, value) {
  if (backend === "supabase") {
    await sbPut(name, value);
  } else {
    clearTimeout(fileTimers[name]);
    await writeFile(join(DATA, `${name}.json`), JSON.stringify(value, null, 2)).catch((e) =>
      console.error(`[persist] saveNow ${name} failed:`, e.message));
  }
}
