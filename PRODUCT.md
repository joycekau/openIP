<div align="center">

<img src="web/assets/logo_mark.png" alt="oneIP logo" width="140" />

# oneIP

**Tokenize your influence.**

_A Solana creator-IP launchpad + fiat-commerce storefront + gmgn-style trading terminal._

</div>

---

## What is oneIP?

**oneIP** turns any creator's audience into an on-chain, tradable asset — without the creator (or their fans) ever needing to understand crypto. It pairs a **fiat commerce storefront** where fans buy products, unlock content, and tip, with a **Solana token engine** where a creator's value pool lives on-chain with a mathematical price floor that _can't go to zero_.

The product runs across two front doors, one identity, one backend:

| Domain | Audience | What it is |
|---|---|---|
| **oneIP.ai** | Fans & everyday users | The "front door": pure fiat e-commerce, creator content, social feed, one-click distribution. **Crypto is invisible.** |
| **oneIP.io** | Traders & creators | The token engine: launch a coin, 20% floor treasury, buy / sell / redeem, live terminal. |

---

## Core mechanics (the on-chain constitution)

- **Standardized 1B supply**, fair launch, zero pre-mine.
- **Buy:** 80% into the bonding curve, **20% into the floor treasury**.
- **Sell:** a 2% tax flows _into_ the floor — dumping actually raises the guaranteed floor.
- **Redeem anytime:** burn your tokens for a pro-rata share of the treasury's SOL — a mathematical "never goes to zero" floor.
- **Non-custodial & non-rug:** program-owned vault, no freeze authority, no withdraw backdoor.

**The business loop:** fans buy goods / tip / unlock in fiat → 20% of net profit auto-buys the creator's coin and pours into its on-chain floor → verifiable credibility, not promises.

---

## What's in the box

- 🚀 **One-click launch** — logo, site, and socials in a single form; cross-wallet credibility via the Metaplex metadata standard (logo + socials render in Phantom, Solflare, Backpack, Solscan, and Jupiter).
- 📈 **gmgn-style terminal** — live trending (DexScreener) + KOL smart-money tracking with a FIFO PnL engine (Helius).
- 🛍️ **Fiat commerce** — physical goods, digital unlocks, tips, and paid reactions, with automatic profit-share → floor buyback.
- 💬 **Creator social feed** — posts, follow, subscribe, comments, plus mirroring from Twitter / IG / TikTok / YouTube.
- 🔒 **Security badges** — RugCheck integration and signed social attestation.
- 🌏 **7 languages, mobile-first** — EN · 中文 · ไทย · Bahasa · Tiếng Việt · 日本語 · 한국어. Built for Southeast-Asia creator networks.

---

## Tech at a glance

- **Backend:** zero-dependency Node.js HTTP server (`npm run serve` → `:8787`), file-based JSON storage.
- **On-chain:** Solana / Anchor program (`onchain/programs/kolpad`) — the trustless core that enforces the floor and trading.
- **Frontend:** framework-free HTML/JS, dark + gradient "noble" UI.
- **Deploy:** Render (Blueprint `render.yaml`) → `oneip.io`.

Every integration **degrades gracefully** — runs in mock/dev mode with no key, real mode once a key is added.

---

## Quick start

```bash
npm run serve      # http://localhost:8787 — full UI + API, no API key needed
```

Then open the terminal (`/`), launch (`/launch`), feed (`/feed`), coin (`/coin`), and admin (`/admin`).

---

## Trust model (honest)

- ✅ **Trustless** once `onchain/` is deployed: all funds, the 20% floor, trading, and redemption.
- 🟡 **Centralized by choice:** social verification is a signed attestation; path to decentralize is a multisig/DAO attester or zkTLS proofs.
- ⚠️ The off-chain registry currently issues placeholder mints with no real liquidity pool — real tokens + pools arrive when `onchain/` is deployed.

---

<div align="center">

<img src="web/assets/logo_icon.png" alt="oneIP app icon" width="72" />

**oneIP** — built for creators, owned by no one.

</div>
