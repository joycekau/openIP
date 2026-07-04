// FIFO PnL engine — the core of oneIP.io's "KOL score". All amounts in SOL.
// Input: a wallet's chronological swaps [{ts, mint, symbol, side:'buy'|'sell', sol, tokens}]
// Output: realized/unrealized PnL, win rate, avg hold, open positions, and a transparent score.

export function computeWalletStats(swaps, currentPriceSolPerToken = {}) {
  const byMint = new Map();

  for (const s of [...swaps].sort((a, b) => a.ts - b.ts)) {
    if (!byMint.has(s.mint)) {
      byMint.set(s.mint, { symbol: s.symbol, lots: [], realized: 0, sells: 0, wins: 0, firstTs: s.ts, lastTs: s.ts });
    }
    const m = byMint.get(s.mint);
    m.lastTs = s.ts;

    if (s.side === "buy") {
      m.lots.push({ tokens: s.tokens, costPer: s.sol / s.tokens });
    } else {
      // FIFO match this sell against the oldest buy lots
      let remaining = s.tokens;
      const sellPer = s.sol / s.tokens;
      let costMatched = 0;
      let tokensMatched = 0;
      while (remaining > 1e-9 && m.lots.length) {
        const lot = m.lots[0];
        const take = Math.min(remaining, lot.tokens);
        costMatched += take * lot.costPer;
        tokensMatched += take;
        lot.tokens -= take;
        remaining -= take;
        if (lot.tokens <= 1e-9) m.lots.shift();
      }
      // Only count a sell whose buy is in our history — skip "phantom" sells of
      // positions opened before the fetched window (they'd distort realized PnL + win rate).
      if (tokensMatched > 1e-9) {
        const gain = tokensMatched * sellPer - costMatched;
        m.realized += gain;
        m.sells += 1;
        if (gain > 0) m.wins += 1;
      }
    }
  }

  let realized = 0, sells = 0, wins = 0, unrealized = 0;
  const holdSpans = [];
  const positions = [];

  for (const [mint, m] of byMint) {
    realized += m.realized;
    sells += m.sells;
    wins += m.wins;
    const openTokens = m.lots.reduce((a, l) => a + l.tokens, 0);
    const openCost = m.lots.reduce((a, l) => a + l.tokens * l.costPer, 0);
    if (openTokens > 0) {
      let u = 0;
      const px = currentPriceSolPerToken[mint];
      if (px != null) u = openTokens * px - openCost;
      unrealized += u;
      positions.push({ symbol: m.symbol, tokens: openTokens, costSol: openCost, unrealizedSol: u });
    }
    holdSpans.push(m.lastTs - m.firstTs);
  }

  const winRate = sells ? wins / sells : 0;
  const avgHoldH = holdSpans.length ? holdSpans.reduce((a, b) => a + b, 0) / holdSpans.length / 3600 : 0;
  // Transparent score: realized PnL weighted by win-rate, plus a slice of open upside.
  const score = realized * (0.5 + winRate / 2) + unrealized * 0.3;

  return { realizedSol: realized, unrealizedSol: unrealized, trades: sells, winRate, avgHoldH, score, positions };
}
