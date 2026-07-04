// oneIP.io live data feed — pulls trending Solana meme tokens RIGHT NOW (no API key).
// Run: npm run feed
import { getBoostedSolanaAddresses, getPairsForTokens } from "./sources/dexscreener.js";
import { bestPairPerToken, normalize } from "./normalize.js";
import { enrich } from "./security.js";
import { money, pct, age, table } from "./format.js";

const SHIELD = { safe: "SAFE", caution: "CAUTION", danger: "DANGER", unknown: "?" };

async function main() {
  console.log("oneIP.io · pulling live Solana data from DexScreener …\n");

  const addresses = await getBoostedSolanaAddresses(30);
  const pairs = await getPairsForTokens(addresses);
  const tokens = bestPairPerToken(pairs)
    .map(normalize)
    .filter((t) => t.liquidity > 0)
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 15);

  if (!tokens.length) {
    console.log("No tokens returned (DexScreener boost list may be momentarily empty). Try again.");
    return;
  }

  console.log("checking RugCheck security on top tokens …");
  await enrich(tokens, 15);

  console.log(
    table(tokens, [
      { header: "SYMBOL", get: (t) => t.symbol.slice(0, 12) },
      { header: "PRICE", get: (t) => money(t.priceUsd) },
      { header: "24H", get: (t) => pct(t.change24h) },
      { header: "VOL 24H", get: (t) => money(t.volume24h) },
      { header: "LIQ", get: (t) => money(t.liquidity) },
      { header: "MCAP", get: (t) => money(t.marketCap) },
      { header: "AGE", get: (t) => age(t.ageHours) },
      { header: "B/S 24H", get: (t) => `${t.buys24h}/${t.sells24h}` },
      { header: "SECURITY", get: (t) => {
        const s = t.security;
        if (!s) return "-";
        const v = SHIELD[s.verdict] || "?";
        return s.badges?.length ? `${v}:${s.badges.slice(0, 2).join(",")}` : v;
      } },
    ])
  );

  console.log(`\n${tokens.length} tokens · sorted by 24h volume · ${new Date().toLocaleString()}`);
  console.log("\nNext: KOL / smart-money / wallet-PnL data needs a keyed source (see README + .env.example).");
}

main().catch((e) => {
  console.error("feed failed:", e.message);
  process.exit(1);
});
