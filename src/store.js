// Live swap store — webhook-ingested KOL trades, kept in memory and mirrored to
// data/live-swaps.json so they survive a restart. The KOL engine merges these on top
// of each wallet's baseline history.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dir, "..", "data", "live-swaps.json");

let mem = {};
let timer = null;

export async function load() {
  try { mem = JSON.parse(await readFile(FILE, "utf8")); }
  catch { mem = {}; }
}

export function add(wallet, swap) {
  (mem[wallet] ||= []).push(swap);
  schedulePersist();
}

export function get(wallet) {
  return mem[wallet] || [];
}

function schedulePersist() {
  clearTimeout(timer);
  timer = setTimeout(() => writeFile(FILE, JSON.stringify(mem, null, 2)).catch(() => {}), 300);
}
