# kolpad — kol.meme launchpad (Solana / Anchor)

20% floor-backed, social-verified token launches. The on-chain trustless core behind kol.meme.

## What this enforces on-chain

| Guarantee | How |
|---|---|
| **Can't go to zero** | 20% of every buy locked in a program-owned floor vault PDA with **no withdrawal path**. Holders always redeem their proportional share via `redeem_floor`. |
| **Dumping raises the floor** | every sell pays a **2% tax into the floor vault** while supply shrinks → floor-per-token strictly goes up. Chosen over a bypassable "sell max 90%" cap. Proven by `sell_tax_raises_floor_per_token`. |
| **Floor only ratchets up** | sells/redeems never lower it; proven in `curve/` unit tests. |
| **Verified = signed by platform** | `verify_token` requires the `attester` (in Config) to sign. Flips a flag + social count only — **can never touch funds**. |
| **Tradable, open pool** | `buy` / `sell_market` on the bonding curve; standard SPL + Metaplex metadata so it lists on Raydium/Jupiter. No freeze authority, no auto-halt — **not a honeypot**. |

The off-chain board (oneIP.io) pushes only launches where `verified == true` (>= 3 socials).

## Verify the money math now — no Solana toolchain needed

```bash
cargo test -p kolpad-curve
```

`curve/` is pure Rust (zero deps) and proves: exact 20% lock, floor never zero, floor
ratchets up on buys, a whale dump can't lower the floor, and floor-redemption is floor-neutral.

## Build & deploy the full program (needs the toolchain)

```bash
# 1. toolchain (Linux/macOS — on Windows use WSL2, native Anchor is painful)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"   # solana CLI
cargo install --git https://github.com/coral-xyz/anchor avm --force && avm install 0.30.1 && avm use 0.30.1

# 2. build, test on a local validator, deploy
anchor build
anchor test            # runs tests/kolpad.ts against solana-test-validator
anchor deploy --provider.cluster devnet
```

## Instruction set

`initialize(attester, fee_recipient)` · `create_token(name, symbol, uri)` · `buy(lamports_in, min_out)` ·
`sell_market(amount, min_out)` · `redeem_floor(amount)` · `verify_token(social_count)` · `top_up_floor(lamports)` ·
`graduate()`

## Economics

- **20% floor = the holders' money.** Neither platform nor creator can withdraw it — redemption only.
- **Trade fee 1.25%, split `PLATFORM_FEE_BPS` 0.75% / `CREATOR_FEE_BPS` 0.50%.** The creator earns a cut
  of every buy & sell of their coin — aligned with volume, not with dumps.
- **Sell tax 2% → floor** (separate from the fee); the floor stays at full strength.
- **Launch fee 0.1 SOL** (`LAUNCH_FEE_LAMPORTS`) on `create_token` → fee_recipient (anti-spam + platform).
- **Graduation:** when the curve fills (~85 SOL, `GRADUATE_LAMPORTS`), `graduate()` (permissionless) stops
  new curve buys and trading moves to **Raydium** (migration CPI is a reference stub). The floor vault +
  `redeem_floor` persist forever — the 20% guarantee survives graduation.
- The creator's main upside is still holding tokens they bought **fairly** (no premint, no presale) plus
  off-chain Pro ($10/mo AI clone) / Pro+ ($39/mo multi-platform) + fan subscriptions.

## Cross-wallet credibility (logos in every wallet)

`create_token` writes a **Metaplex Token Metadata** account from `uri` — the IPFS/Arweave metadata
JSON (logo `image`, `name`, `external_url`, socials). Then Phantom / Solflare / Backpack / Solscan /
Jupiter all render the coin identically. The off-chain side (oneIP.io) builds that JSON
(`GET /api/coin/metadata`) and pins it + the logo to IPFS (`POST /api/coin/finalize`, Pinata) to get
the `uri`. **Fair by construction:** mint authority = the launch PDA (only the curve mints, no human
premint), and the mint has **no freeze authority** (nobody can freeze holders). Pass the pinned `uri`
into `create_token`, and pass the Metaplex metadata PDA (`["metadata", metadata_program_id, mint]`).

## Trust map (honest)

- ✅ **Trustless:** all funds, the 20% floor, trading, redemption. Platform can't rug.
- 🟡 **Centralized (by your choice):** the `attester` signs verification after checking 3 socials off-chain. Path to decentralize: rotate `attester` to a multisig/DAO, or move to zkTLS social proofs (Reclaim/zkPass) so users prove ownership with zero trust.
