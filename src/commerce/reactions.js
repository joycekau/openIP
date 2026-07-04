// Paid emoji reactions — oneIP.ai's "web4 likes". On web2, a like is free and worthless to the
// creator; here every reaction is a micro-payment (5 priced emojis), so fan emotion = real revenue.
// Each reaction runs through the same engine as a tip (5% platform fee + 20% floor + creator).
// This module owns the catalog + the per-target counts; the money flow is orchestrated in server.js.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dir, "..", "..", "data", "reactions.json");

// 5 reactions, a price ladder. key is stable; emoji/label/price are display + cost.
export const REACTIONS = [
  { key: "like", emoji: "👍", label: "赞", priceCents: 50 },
  { key: "v", emoji: "✌️", label: "V手", priceCents: 100 },
  { key: "cheer", emoji: "💪", label: "加油", priceCents: 200 },
  { key: "love", emoji: "❤️", label: "爱了", priceCents: 500 },
  { key: "fire", emoji: "🔥", label: "燃爆", priceCents: 1000 },
];
const BY_KEY = Object.fromEntries(REACTIONS.map((r) => [r.key, r]));

let counts = {}; // targetId -> { key: count }   (target = a product id, post id, or creator handle)
let loaded = false;
let timer = null;

export async function load() {
  try { counts = JSON.parse(await readFile(FILE, "utf8")); } catch { counts = {}; }
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => writeFile(FILE, JSON.stringify(counts, null, 2)).catch(() => {}), 200);
}

export function byKey(key) { return BY_KEY[key] || null; }

/** Increment a target's count for a reaction (called once the reaction's payment settles). */
export function bump(target, key) {
  if (!target || !BY_KEY[key]) return getCounts(target);
  counts[target] = counts[target] || {};
  counts[target][key] = (counts[target][key] || 0) + 1;
  persist();
  return counts[target];
}
export function getCounts(target) { return counts[target] || {}; }
/** Total reactions across every target (platform-wide) — for the admin overview. */
export function totalReactions() {
  let t = 0;
  for (const k in counts) for (const key in counts[k]) t += counts[k][key];
  return t;
}
