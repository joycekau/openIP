// Live swap store — webhook-ingested KOL trades, kept in memory and mirrored to
// data/live-swaps.json so they survive a restart. The KOL engine merges these on top
// of each wallet's baseline history.
import { loadJson, saveJson } from "./persist.js";

const KEY = "live-swaps";

let mem = {};

export async function load() {
  mem = await loadJson(KEY, {});
  if (!mem || typeof mem !== "object") mem = {};
}

export function add(wallet, swap) {
  (mem[wallet] ||= []).push(swap);
  saveJson(KEY, mem);
}

export function get(wallet) {
  return mem[wallet] || [];
}
