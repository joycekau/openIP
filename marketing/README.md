# OneIP.io — Marketing & Social Media Kit

Social content for **OneIP.io** — *"tokenize your influence."* A **Solana** creator-IP / KOL **token launchpad** + gmgn-style **trading terminal** + **creator social platform**. Every coin ships with a **20% floor treasury** (it can't go to zero), verified socials across Phantom/Solflare/Backpack/Jupiter/Solscan, a creator feed, and a Pro AI-clone auto-reply. Non-custodial (Phantom), mobile, 7 languages.

```
marketing/
├── social-calendar/oneip_365_social_calendar.xlsx   # 365 days: caption · hashtags · AI image prompt · platform · time
└── scripts/build_oneip_calendar.py                  # regenerate: python3 marketing/scripts/build_oneip_calendar.py OneIP
```

## Positioning (source of truth = this repo's README / project docs)
Lead with **"tokenize your influence"** and the **20% floor** (the anti-rug differentiator vs meme launchpads). Segments: **creators/KOLs** (launch a coin + feed + AI clone), **traders** (gmgn-style terminal + KOL smart-money tracker), **fans/holders** (buy, hold, redeem the floor). Built for SE-Asia creator networks; dark-and-gold "noble" brand look.

## Quick start
1. Open the calendar. 2. Copy Caption + Hashtags → X/Telegram. 3. Paste the Image Prompt into Grok/Gemini/Cora AI. 4. Post at the suggested time.

## ⚠️ Compliance
Not financial advice; token trading is risky. The **20% floor** is a treasury backstop that reduces downside — **not** a guarantee of price/returns. Never promise gains. Some on-chain features run on **Solana devnet (mainnet pending)** — don't claim mainnet features that aren't live. Never post API keys/secrets. Domain `oneip.io` confirmed.

## Regenerate
```bash
pip install openpyxl && python3 marketing/scripts/build_oneip_calendar.py OneIP
```
