# oneIP.io — data layer

Pull live Solana meme + KOL/smart-money data, gmgn.ai-style.

## Quick start (no API key needed)

```bash
node src/feed.js      # live trending Solana memes: price / vol / liq / mcap / age / risk flags
```

Data comes from the **free DexScreener API** — proves the pipeline works today.

## What gmgn shows, and where each piece actually comes from

| Data | oneIP.io module | Source (Path A) | Source (Path B — own index) |
|------|-----------------|-----------------|------------------------------|
| Trending / new tokens, price, vol, liq, mcap | `feed.js` ✅ done | gmgn `gmgn-market` | **DexScreener** (free) / Birdeye |
| K-line / OHLCV | todo | gmgn `gmgn-market` | Birdeye OHLCV |
| Token security (honeypot, rug score, LP burned, mint authority) | todo | gmgn `gmgn-token` | RugCheck / Helius + own rules |
| Holder structure (KOL / smart-money / insider / sniper / bundler %) | todo | gmgn `gmgn-token` | Helius + Solana Tracker + labels |
| **KOL trades / smart-money buys (real-time)** ⭐ | todo | gmgn `gmgn-track` | **Helius webhooks** on labeled wallets |
| Wallet PnL / win-rate / history | todo | gmgn `gmgn-portfolio` | Bitquery + own PnL engine |
| One-click copy-trade buy/sell | todo | gmgn `gmgn-swap` / `gmgn-cooking` | Jupiter swap API |

## Two paths (pick per data type — you can mix)

**Path A — call GMGN OpenAPI directly.** Fastest. Key at https://gmgn.ai/ai (free tier).
Risk: depends on a competitor, per-call cost, they can cut you off, data isn't yours.

**Path B — index from primary sources** (what gmgn itself does). More work, but you own the
data and can build a differentiated "KOL score". Keys go in `.env` (see `.env.example`).

> Recommendation: ship on **A** to validate the product, build **B** underneath for independence —
> long-term oneIP.io cannot depend on gmgn for the data it's competing on.

## Backend service (zero-dep Node)

```bash
npm run serve   # http://localhost:8787  — serves the UI + the API below
npm run smoke   # end-to-end proof: boots server, pulls live trending, injects a fake
                # Helius webhook, watches it surface as a live KOL signal
```

Endpoints:
- `GET /api/trending` — live Solana trending (30s cache)
- `GET /api/kol/leaderboard` · `GET /api/kol/signals` — baseline + live webhook trades
- `GET /api/token/security?mint=…` — RugCheck report
- `POST /webhooks/helius` — register this as your Helius webhook URL; tracked-wallet
  SWAP txs get decoded and pushed into the live KOL feed in real time.

The UI (`web/index.html`) auto-detects the backend: served by `npm run serve` it shows
live API data; opened as a static file it falls back to baked demo data.

## Go live with real on-chain KOL data (3 steps)

Everything is plug-and-play — no code changes needed.

```bash
# 1. sign up free at https://helius.dev, copy your API key, then in .env:
#    HELIUS_API_KEY=your_key_here
# 2. replace the placeholder wallets in data/kol-wallets.json with REAL KOL addresses
# 3. verify + go live:
npm run doctor        # confirms the key works
npm run kol           # now LIVE on-chain (was replay)

# real-time push (optional, for production): expose your server publicly, then
npm run helius:webhook -- https://your-server/webhooks/helius
```

`.env` is auto-loaded by every script (Node `--env-file-if-exists`, zero deps).

## The KOL-tracking core (the part that makes it "oneIP.io")

1. Maintain a labeled wallet DB: `{ wallet, kol_name, twitter, tags }`.
2. Register those wallets as **Helius webhooks** (or LaserStream) → get every buy/sell in real time.
3. Decode the swap → token, side, size, price. Push to feed + notify followers.
4. Run a PnL engine over each wallet's history → win-rate, realized/unrealized, avg hold → "KOL score".

`.env.example` already lists every key you'll need. Adapters drop into `src/sources/`.
