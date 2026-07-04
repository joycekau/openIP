// oneIP.io — KOL leaderboard + live signal feed.  Run: npm run kol
import { buildKolBoard } from "./kol/track.js";
import { table, money } from "./format.js";

function sol(n) {
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(2)}◎`;
}

async function main() {
  const { live, rows, signals } = await buildKolBoard();

  console.log(`oneIP.io · KOL tracker · mode: ${live ? "LIVE (Helius)" : "REPLAY (sample data — set HELIUS_API_KEY for live)"}\n`);

  console.log("KOL LEADERBOARD (by score)");
  console.log(
    table(rows, [
      { header: "KOL", get: (r) => r.kol },
      { header: "TWITTER", get: (r) => r.twitter },
      { header: "TRADES", get: (r) => r.trades },
      { header: "WIN%", get: (r) => `${(r.winRate * 100).toFixed(0)}%` },
      { header: "REALIZED", get: (r) => sol(r.realizedSol) },
      { header: "AVG HOLD", get: (r) => `${r.avgHoldH.toFixed(0)}h` },
      { header: "SCORE", get: (r) => r.score.toFixed(1) },
      { header: "TAGS", get: (r) => r.tags.join(",") },
    ])
  );

  console.log("\nRECENT KOL SIGNALS");
  for (const s of signals) {
    const when = new Date(s.ts * 1000).toLocaleString();
    const arrow = s.side === "buy" ? "🟢 BUY " : "🔴 SELL";
    console.log(`  ${when}  ${arrow}  ${s.kol.padEnd(8)}  ${s.symbol.padEnd(7)}  ${s.sol.toFixed(2)}◎`);
  }
  console.log("");
}

main().catch((e) => { console.error("kol failed:", e.message); process.exit(1); });
