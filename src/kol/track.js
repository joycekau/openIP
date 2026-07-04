// KOL tracker — loads tracked wallets, pulls their swaps (Helius if keyed, else replay),
// runs the PnL engine, and emits a leaderboard + a recent-signals feed.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { computeWalletStats } from "./pnl.js";
import * as helius from "../sources/helius.js";
import * as store from "../store.js";
import * as walletStore from "../wallets.js";

const __dir = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dir, "..", "..", "data");

async function loadJSON(p) {
  return JSON.parse(await readFile(p, "utf8"));
}

export async function buildKolBoard() {
  await walletStore.ensureLoaded();
  const wallets = walletStore.all();
  const live = helius.hasKey();
  const sample = live ? null : await loadJSON(join(DATA, "sample-swaps.json"));

  const rows = [];
  const signals = [];

  for (const w of wallets) {
    let base;
    if (live) {
      try { base = await helius.getWalletSwaps(w.wallet); }
      catch { base = []; }
    } else {
      base = sample[w.wallet] || [];
    }
    // merge any webhook-ingested live trades on top of the baseline
    const swaps = [...base, ...store.get(w.wallet)];

    const stats = computeWalletStats(swaps);
    rows.push({ ...w, ...stats });

    for (const s of swaps) {
      signals.push({ ts: s.ts, kol: w.kol, side: s.side, symbol: s.symbol, sol: s.sol });
    }
  }

  rows.sort((a, b) => b.score - a.score);
  signals.sort((a, b) => b.ts - a.ts);
  return { live, rows, signals: signals.slice(0, 12) };
}

// Full detail for one tracked wallet: stats + recent trade history.
export async function getKolDetail(wallet) {
  await walletStore.ensureLoaded();
  const w = walletStore.all().find((x) => x.wallet === wallet);
  if (!w) return null;

  const live = helius.hasKey();
  let base;
  if (live) {
    try { base = await helius.getWalletSwaps(wallet); } catch { base = []; }
  } else {
    const sample = await loadJSON(join(DATA, "sample-swaps.json"));
    base = sample[wallet] || [];
  }
  const swaps = [...base, ...store.get(wallet)];
  const stats = computeWalletStats(swaps);
  const recent = [...swaps].sort((a, b) => b.ts - a.ts).slice(0, 20);
  return { ...w, ...stats, recent };
}
