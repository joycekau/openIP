// SOL float pool for the revenue->floor buyback.
//
// When an order SETTLES, the floor is funded INSTANTLY from this pre-funded SOL pool so fans see
// the floor rise the moment their purchase clears. The platform SEPARATELY, in batches, converts
// the accumulated FIAT profit to SOL (via a licensed exchange/OTC) and tops the pool back up —
// decoupling fan-facing speed from the slow/fee-heavy fiat->crypto conversion.
//
// This module is pure accounting (the actual on-chain spend happens in buyback.js against the
// deployer wallet, which this pool mirrors). The fiat->SOL conversion is out-of-band: topUp()
// records a deposit; a production impl wires an exchange API + a live SOL price feed.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dir, "..", "..", "data", "treasury.json");
const LAMPORTS_PER_SOL = 1_000_000_000;
// Fallback SOL/USD price. Production: replace with a live feed (Pyth/Jupiter/CEX). Kept as an env
// so smoke + offline dev are deterministic.
const SOL_USD = Number(process.env.SOL_USD_PRICE || 150);

let state = { lamports: 0, history: [] }; // lamports = available float; history = audit trail
let loaded = false;
let timer = null;

export async function load() {
  try { state = JSON.parse(await readFile(FILE, "utf8")); } catch { state = { lamports: 0, history: [] }; }
  loaded = true;
}
export async function ensureLoaded() { if (!loaded) await load(); }
function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => writeFile(FILE, JSON.stringify(state, null, 2)).catch(() => {}), 200);
}

export function balanceLamports() { return state.lamports; }
export function balanceSol() { return state.lamports / LAMPORTS_PER_SOL; }

/** Convert a fiat amount (cents) into the equivalent lamports at the current SOL/USD price. */
export function quoteLamports(cents) {
  const usd = cents / 100;
  const lamports = Math.round((usd / SOL_USD) * LAMPORTS_PER_SOL);
  return { usd, solUsd: SOL_USD, lamports };
}

/** Credit the pool (a batch fiat->SOL conversion landed, or an initial dev seed). */
export function topUp(lamports, note = "topup") {
  if (!(lamports > 0)) throw new Error("topUp lamports must be > 0");
  state.lamports += lamports;
  state.history.unshift({ t: "topup", lamports, note, ts: Date.now(), balanceAfter: state.lamports });
  state.history = state.history.slice(0, 500);
  persist();
  return state.lamports;
}

/** Reserve+debit lamports for a buyback. Throws if the float is short (caller should top up /
 *  queue the conversion first). */
export function reserve(lamports, note = "buyback") {
  if (!(lamports > 0)) throw new Error("reserve lamports must be > 0");
  if (state.lamports < lamports) throw new Error(`float pool short: need ${lamports}, have ${state.lamports}`);
  state.lamports -= lamports;
  state.history.unshift({ t: "reserve", lamports, note, ts: Date.now(), balanceAfter: state.lamports });
  state.history = state.history.slice(0, 500);
  persist();
  return state.lamports;
}

export function snapshot() {
  return { lamports: state.lamports, sol: balanceSol(), solUsd: SOL_USD, history: state.history.slice(0, 50) };
}
