# oneIP.io — tokenize your influence

A **Solana** creator-IP / KOL token launchpad + gmgn-style trading terminal + creator social
platform. Every token ships with a **20% floor treasury** (can't go to zero), one-click launch,
and cross-wallet credibility (logo + socials show in Phantom / Solflare / Backpack / Solscan /
Jupiter via the Metaplex metadata standard).

> Built for Southeast-Asia creator networks (WebTVAsia). 7 languages, mobile, non-custodial Phantom.

---

## What's in this repo

```
oneip/
├── src/            backend  — zero-dependency Node.js HTTP server + API
│   ├── server.js       routes: pages, /api/*, /webhooks/*
│   ├── launchpad.js    social-verified launch registry (20% floor)
│   ├── social.js       creator feed: posts / follow / subscribe / comments
│   ├── ai.js           $10/mo Pro AI-clone auto-reply (Claude)
│   ├── billing.js      Stripe Pro subscriptions
│   ├── sync.js         mirror creator posts from Twitter/IG/TikTok/YouTube
│   ├── ipfs.js         Pinata pin (logo + metadata JSON)
│   ├── kol/, sources/  KOL smart-money tracking + FIFO PnL engine (Helius)
│   ├── security.js     RugCheck security badges
│   └── verify.js       centralized signed social attestation
├── web/            frontend — static pages (dark + gold "noble" UI)
│   ├── index.html      gmgn-style data terminal (trending + KOL tracker)
│   ├── launch.html     one-click launch form (logo/site/socials)
│   ├── feed.html       creator social feed + Creator Studio
│   ├── coin.html       per-coin community page
│   ├── admin.html      backstage / admin panel (token-gated)
│   ├── wallet.js       Phantom connector (non-custodial)
│   └── i18n.js         7 languages: EN 中文 ไทย Bahasa Tiếng-Việt 日本語 한국어
├── onchain/        Solana — Anchor program (the trustless core, kolpad)
│   ├── programs/kolpad/ create_token / buy / sell / redeem_floor / verify_token
│   └── curve/          pure-Rust bonding-curve + floor math (cargo test)
├── scripts/        ops — smoke tests, wallet discovery, webhook registration
├── data/           seed data (public wallet addresses, sample swaps)
├── docs/DATA.md    data-layer detail (sources, gmgn parity map)
└── DEPLOY.md       step-by-step: GitHub → Render → oneip.io domain
```

## Architecture at a glance

- **Off-chain (live now):** the Node server runs the launch registry, social feed, KOL
  terminal, and admin panel. No build step, no `npm install` required to boot.
- **On-chain (written, undeployed):** `onchain/` is the Anchor program that makes the 20%
  floor and trading **trustless** (program-owned vault, no withdraw path). Needs WSL + Anchor
  to deploy to devnet/mainnet.

## Quick start (no API key needed)

```bash
npm run serve      # http://localhost:8787  — full UI + API
```

Open it and you get the terminal (`/`), launch (`/launch`), feed (`/feed`),
coin (`/coin`), and admin (`/admin`, token = `ADMIN_TOKEN`, default `admin`).
Trending data is live from the free DexScreener API; KOL data goes live once you add a
free Helius key.

```bash
npm run feed       # live Solana trending in the terminal
npm run kol        # KOL leaderboard + signals (replay, or LIVE with HELIUS_API_KEY)
npm run smoke      # end-to-end: boot → live trending → fake webhook → live KOL signal
node onchain/curve # see onchain/README.md — cargo test proves the floor math
```

## Going live (add keys when ready)

Every integration degrades gracefully — it runs in mock/dev mode without a key, real mode with one.
Copy `.env.example` → `.env` and fill what you have:

| Key | Enables |
|---|---|
| `HELIUS_API_KEY` | real on-chain KOL smart-money tracking (free tier is enough) |
| `PINATA_JWT` | pin logo + metadata to IPFS → cross-wallet credibility |
| `ANTHROPIC_API_KEY` | Pro AI-clone auto-reply (`npm install @anthropic-ai/sdk` first) |
| `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` + `STRIPE_WEBHOOK_SECRET` | $10/mo Pro checkout |
| `*_CLIENT_ID/SECRET` (Twitter/Discord/YouTube/TikTok/…) | real social verification + sync |
| `ADMIN_TOKEN` | **change from `admin` before production** |

## Deploy

See **[DEPLOY.md](DEPLOY.md)** — push to GitHub, deploy free on Render, point `oneip.io` at it.

## Trust model (honest)

- ✅ Trustless once `onchain/` is deployed: all funds, the 20% floor, trading, redemption.
- 🟡 Centralized by choice: social verification is a signed attestation (3 socials checked
  off-chain). Path to decentralize: rotate attester to a multisig/DAO or move to zkTLS proofs.
- ⚠️ The off-chain registry currently issues placeholder mints with **no real liquidity pool** —
  real tokens + pools come from deploying `onchain/`. API/webhooks need auth before production.

---

Detailed docs: **[docs/DATA.md](docs/DATA.md)** (data sources) · **[onchain/README.md](onchain/README.md)** (the Solana program) · **[DEPLOY.md](DEPLOY.md)** (go-live).
