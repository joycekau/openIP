// Tracked KOL wallet registry — single source of truth for data/kol-wallets.json.
// The KOL board reads it, the webhook checks membership, and the admin panel mutates it.
import { loadJson, saveJson } from "./persist.js";

const KEY = "kol-wallets";

let list = [];
let set = new Set();
let loaded = false;

export async function load() {
  list = await loadJson(KEY, []);
  if (!Array.isArray(list)) list = [];
  set = new Set(list.map((w) => w.wallet));
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }

export function all() { return list; }
export function has(addr) { return set.has(addr); }

export async function add(entry) {
  const wallet = (entry.wallet || "").trim();
  if (!wallet) throw new Error("wallet address required");
  if (wallet.length < 32 || wallet.length > 44) throw new Error("not a valid Solana address");
  if (set.has(wallet)) throw new Error("already tracked");
  const w = {
    wallet,
    kol: (entry.kol || "Unnamed").trim(),
    twitter: (entry.twitter || "").trim(),
    tags: Array.isArray(entry.tags) ? entry.tags : String(entry.tags || "").split(",").map((s) => s.trim()).filter(Boolean),
  };
  list.push(w);
  set.add(wallet);
  await persist();
  return w;
}

export async function remove(addr) {
  const before = list.length;
  list = list.filter((w) => w.wallet !== addr);
  set.delete(addr);
  if (list.length === before) throw new Error("not found");
  await persist();
}

async function persist() {
  saveJson(KEY, list);
}
