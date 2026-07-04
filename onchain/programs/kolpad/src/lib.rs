//! oneIP.io launchpad — Solana / Anchor reference implementation.
//!
//! Core mechanic "constitution" (locked 2026-06-28, user chose direction A = OPEN POOL):
//!   1. BUY splits 80% -> bonding-curve reserve, 20% -> program-owned floor-vault PDA (no
//!      withdrawal authority). -> a launch "can't go to zero".
//!   2. SELL on the curve charges a 2% tax that goes INTO the floor vault, so dumping strictly
//!      RAISES the floor-per-token for remaining holders. (Chosen over a hard "sell max 90%"
//!      cap, which is trivially bypassable and reads as a honeypot.)
//!   3. REDEEM (`redeem_floor`) is the always-open exit: burn your tokens for a strictly
//!      proportional share of the vault. Whales can't break it; the market never has to halt.
//!   4. ANTI-RUG: mint authority = launch PDA (only the curve mints, no premint), and the mint
//!      has NO freeze authority -> not a honeypot, renders in every wallet/DEX.
//!   5. VERIFICATION is a centralized signed attestation: `verify_token` requires the platform
//!      `attester` (in Config) to sign. Flips a `verified` flag + social count only; never touches
//!      funds. The off-chain board pushes only verified launches.
//!
//! Economics (step-2, locked 2026-06-28): the 20% floor belongs to HOLDERS — neither the platform
//! nor the creator can withdraw it (redemption only). The creator earns from (a) holding tokens they
//! bought fairly (no premint/presale), (b) Pro + fan subscriptions off-chain, and (c) a 0.50% cut of
//! every trade. The 1.25% total trade fee is split PLATFORM_FEE_BPS 0.75% / CREATOR_FEE_BPS 0.50% —
//! taken from the platform fee, NOT carved out of the 2% floor tax (the floor stays at full strength).
//! A one-time **0.1 SOL launch fee** (`LAUNCH_FEE_LAMPORTS`) is paid to the fee_recipient on
//! `create_token` (anti-spam + platform). When the curve fills (~85 SOL, `GRADUATE_LAMPORTS`),
//! `graduate` flips `graduated` → new curve buys stop and trading moves to **Raydium** (migration
//! CPI is a reference stub); the floor vault + `redeem_floor` persist forever, so the guarantee survives.
//!
//! Deliberately NOT implemented (user rejected after honest review): an auto circuit-breaker that
//! halts trading on a -70%/24h crash (needs transfer-freeze = honeypot + a closed pool + false-
//! triggers on normal memecoin volatility) and a 10% platform-frozen-180-day reserve (centralized
//! custody = trust/regulatory hole). The 20% floor vault + redemption already deliver the goal.
//!
//! NOTE: requires the Solana/Anchor toolchain to build (`anchor build`). The money math lives in
//! the dependency `kolpad-curve`, which is unit-tested standalone (`cargo test -p kolpad-curve`).
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};
use anchor_spl::metadata::{
    create_metadata_accounts_v3, update_metadata_accounts_v2, mpl_token_metadata::types::DataV2,
    CreateMetadataAccountsV3, UpdateMetadataAccountsV2, Metadata,
};
use kolpad_curve as curve;

declare_id!("5SVSaKceFdzdynnuGJDFy74tspXDDxJccWRXh6B1NUdG");

const TRADE_FEE_BPS: u128 = 125;                 // 1.25% total trade fee (unchanged), split platform/creator below
const PLATFORM_FEE_BPS: u128 = 75;               // 0.75% -> platform revenue
const CREATOR_FEE_BPS: u128 = 50;                // 0.50% -> the launch creator (earns on their coin's volume; NOT from the floor)
const SELL_TAX_BPS: u128 = 200;                  // 2% sell tax -> floor vault (dumping RAISES the floor for holders)
const FLOOR_BPS: u128 = 2000;                    // 20% — 4x rise.rich
const VIRTUAL_SOL: u64 = 2_000_000_000;          // 2 SOL virtual curve offset
const INIT_TOKENS: u64 = 1_000_000_000_000_000;  // 1e9 tokens @ 6 decimals
const LAUNCH_FEE_LAMPORTS: u64 = 100_000_000;    // 0.1 SOL one-time launch fee (anti-spam + platform)
const GRADUATE_LAMPORTS: u64 = 85_000_000_000;   // ~85 SOL real curve reserve -> graduate to Raydium
pub const MIN_SOCIALS: u8 = 3;

#[program]
pub mod kolpad {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>, attester: Pubkey, fee_recipient: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.attester = attester;
        c.fee_recipient = fee_recipient;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    // `uri` is the IPFS/Arweave metadata-JSON URI (logo, name, website, socials). Writing it via
    // Metaplex Token Metadata is what makes every wallet/explorer/DEX render the coin identically.
    // Fairness: mint authority is the launch PDA (only the bonding curve mints — no human premint),
    // and the mint is created with NO freeze authority (anchor omits it) — nobody can freeze holders.
    pub fn create_token(ctx: Context<CreateToken>, name: String, symbol: String, uri: String) -> Result<()> {
        require!(name.len() <= 32 && symbol.len() <= 10, KolErr::TooLong);
        require!(uri.len() <= 200, KolErr::TooLong);
        let bump = ctx.bumps.launch;
        {
            let l = &mut ctx.accounts.launch;
            l.creator = ctx.accounts.creator.key();
            l.mint = ctx.accounts.mint.key();
            l.name = name.clone();
            l.symbol = symbol.clone();
            l.sol_reserve = VIRTUAL_SOL;
            l.token_reserve = INIT_TOKENS;
            l.real_curve_lamports = 0;
            l.floor_lamports = 0;
            l.supply = 0;
            l.social_count = 0;
            l.verified = false;
            l.graduated = false;
            l.bump = bump;
            l.vault_bump = ctx.bumps.floor_vault;
        }

        // one-time launch fee (anti-spam + platform revenue) -> the configured fee_recipient
        pay_in(&ctx.accounts.system_program, &ctx.accounts.creator, &ctx.accounts.fee_recipient, LAUNCH_FEE_LAMPORTS)?;

        // CPI: create the on-chain Metaplex metadata account. The launch PDA is the mint &
        // update authority, so it signs with its seeds.
        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[b"launch", mint_key.as_ref(), &[bump]];
        create_metadata_accounts_v3(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                CreateMetadataAccountsV3 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    mint_authority: ctx.accounts.launch.to_account_info(),
                    update_authority: ctx.accounts.launch.to_account_info(),
                    payer: ctx.accounts.creator.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                    rent: ctx.accounts.rent.to_account_info(),
                },
                &[seeds],
            ),
            DataV2 { name, symbol, uri, seller_fee_basis_points: 0, creators: None, collection: None, uses: None },
            true,  // is_mutable
            true,  // update_authority_is_signer
            None,  // collection_details
        )?;
        Ok(())
    }

    pub fn buy(ctx: Context<Buy>, lamports_in: u64, min_tokens_out: u64) -> Result<()> {
        let l = &mut ctx.accounts.launch;
        require!(!l.graduated, KolErr::Graduated); // after graduation, trading moves to Raydium
        let (fee, to_floor, to_curve) = curve::split_buy(lamports_in as u128, TRADE_FEE_BPS, FLOOR_BPS);
        let platform_fee = lamports_in as u128 * PLATFORM_FEE_BPS / curve::BPS;
        let creator_fee = fee - platform_fee; // platform + creator == total trade fee, exact
        let tokens_out = curve::buy_tokens_out(l.sol_reserve as u128, l.token_reserve as u128, to_curve);
        require!(tokens_out >= min_tokens_out as u128, KolErr::Slippage);

        // pull SOL from the buyer (system account, signer): platform fee, creator fee, floor, curve
        pay_in(&ctx.accounts.system_program, &ctx.accounts.buyer, &ctx.accounts.fee_recipient, platform_fee as u64)?;
        pay_in(&ctx.accounts.system_program, &ctx.accounts.buyer, &ctx.accounts.creator, creator_fee as u64)?;
        pay_in(&ctx.accounts.system_program, &ctx.accounts.buyer, &ctx.accounts.floor_vault.to_account_info(), to_floor as u64)?;
        pay_in(&ctx.accounts.system_program, &ctx.accounts.buyer, &l.to_account_info(), to_curve as u64)?;

        l.sol_reserve += to_curve as u64;
        l.token_reserve -= tokens_out as u64;
        l.real_curve_lamports += to_curve as u64;
        l.floor_lamports += to_floor as u64;
        l.supply += tokens_out as u64;

        // mint to buyer; mint authority is the launch PDA
        let seeds: &[&[u8]] = &[b"launch", l.mint.as_ref(), &[l.bump]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.buyer_token.to_account_info(),
                    authority: l.to_account_info(),
                },
                &[seeds],
            ),
            tokens_out as u64,
        )?;
        Ok(())
    }

    /// Open-pool sell on the bonding curve. The 2% sell tax is routed INTO the floor vault, so a
    /// dump strictly RAISES the floor-per-token for everyone who stays — the anti-dump mechanism
    /// the user chose instead of a (bypassable, honeypot-flavored) hard "can only sell 90%" cap.
    pub fn sell_market(ctx: Context<SellMarket>, token_amount: u64, min_lamports_out: u64) -> Result<()> {
        let l = &mut ctx.accounts.launch;
        let gross = curve::sell_sol_out(l.sol_reserve as u128, l.token_reserve as u128, token_amount as u128);
        require!(gross as u64 <= l.real_curve_lamports, KolErr::CurveInsolvent);
        let platform_fee = gross * PLATFORM_FEE_BPS / curve::BPS; // 0.75% -> platform
        let creator_fee = gross * CREATOR_FEE_BPS / curve::BPS;   // 0.50% -> creator
        let floor_tax = gross * SELL_TAX_BPS / curve::BPS;        // 2% -> floor vault, raises the floor
        let out = gross - platform_fee - creator_fee - floor_tax; // seller receives the remainder
        require!(out >= min_lamports_out as u128, KolErr::Slippage);

        // burn seller's tokens
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.seller_token.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            token_amount,
        )?;

        l.sol_reserve -= gross as u64;
        l.token_reserve += token_amount;
        l.real_curve_lamports -= gross as u64;
        l.supply -= token_amount;
        l.floor_lamports += floor_tax as u64;             // the tax now backs the floor

        // distribute `gross` out of the curve reserve: platform fee + creator fee + floor tax + seller
        pay_out(&l.to_account_info(), &ctx.accounts.fee_recipient, platform_fee as u64)?;
        pay_out(&l.to_account_info(), &ctx.accounts.creator, creator_fee as u64)?;
        pay_out(&l.to_account_info(), &ctx.accounts.floor_vault.to_account_info(), floor_tax as u64)?;
        pay_out(&l.to_account_info(), &ctx.accounts.seller.to_account_info(), out as u64)?;
        Ok(())
    }

    /// THE anti-rug exit — always redeemable for your proportional share of the locked floor,
    /// no matter how dead the market is. Floor price is unchanged by this op.
    pub fn redeem_floor(ctx: Context<RedeemFloor>, token_amount: u64) -> Result<()> {
        let l = &mut ctx.accounts.launch;
        let payout = curve::redeem_floor_lamports(l.floor_lamports as u128, l.supply as u128, token_amount as u128);

        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.holder_token.to_account_info(),
                    authority: ctx.accounts.holder.to_account_info(),
                },
            ),
            token_amount,
        )?;

        l.floor_lamports -= payout as u64;
        l.supply -= token_amount;

        // pay from the floor vault PDA (program-owned, no other withdrawal path exists)
        pay_out(&ctx.accounts.floor_vault.to_account_info(), &ctx.accounts.holder.to_account_info(), payout as u64)?;
        Ok(())
    }

    /// Centralized signed attestation: only the platform `attester` may flip verification.
    /// Cannot touch funds. The board pushes only launches with `verified == true`.
    pub fn verify_token(ctx: Context<VerifyToken>, social_count: u8) -> Result<()> {
        require!(social_count >= MIN_SOCIALS, KolErr::NotEnoughSocials);
        let l = &mut ctx.accounts.launch;
        l.social_count = social_count;
        l.verified = true;
        Ok(())
    }

    /// Platform insurance / anyone can reinforce a floor. One-way.
    pub fn top_up_floor(ctx: Context<TopUpFloor>, lamports: u64) -> Result<()> {
        pay_in(&ctx.accounts.system_program, &ctx.accounts.payer, &ctx.accounts.floor_vault.to_account_info(), lamports)?;
        ctx.accounts.launch.floor_lamports += lamports;
        Ok(())
    }

    /// Graduate to a public DEX once the curve has filled (~85 SOL real reserve). Permissionless:
    /// anyone can trigger it once the threshold is met. Flips `graduated`, which stops new curve
    /// buys (trading moves to Raydium). The floor vault + `redeem_floor` stay live forever, so the
    /// 20% floor guarantee survives graduation.
    ///
    /// REFERENCE STUB: the actual Raydium pool-creation + liquidity-migration CPI goes here. It is
    /// omitted because it is Raydium-version-specific and can't be unit-tested standalone; the
    /// economic invariants (floor, redemption) are independent of where the market trades.
    pub fn graduate(ctx: Context<Graduate>) -> Result<()> {
        {
            let l = &mut ctx.accounts.launch;
            require!(!l.graduated, KolErr::AlreadyGraduated);
            require!(l.real_curve_lamports >= GRADUATE_LAMPORTS, KolErr::BelowGraduationThreshold);
            l.graduated = true;
        }

        // FAIRNESS LOCK-IN at graduation (Flap-style "fair & final" signals). Both authorities are
        // the launch PDA, which signs with its seeds. Safe to revoke mint here because `buy` — the
        // only minter — is disabled once `graduated` is set above, so supply is now fixed.
        let mint_key = ctx.accounts.launch.mint;
        let bump = ctx.accounts.launch.bump;
        let seeds: &[&[u8]] = &[b"launch", mint_key.as_ref(), &[bump]];

        // 1) revoke mint authority -> None: no tokens can ever be minted again (fixed supply forever).
        token::set_authority(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                token::SetAuthority {
                    account_or_mint: ctx.accounts.mint.to_account_info(),
                    current_authority: ctx.accounts.launch.to_account_info(),
                },
                &[seeds],
            ),
            anchor_spl::token::spl_token::instruction::AuthorityType::MintTokens,
            None,
        )?;

        // 2) make the Metaplex metadata immutable: name / symbol / logo URI can never be changed.
        update_metadata_accounts_v2(
            CpiContext::new_with_signer(
                ctx.accounts.token_metadata_program.to_account_info(),
                UpdateMetadataAccountsV2 {
                    metadata: ctx.accounts.metadata.to_account_info(),
                    update_authority: ctx.accounts.launch.to_account_info(),
                },
                &[seeds],
            ),
            None,        // new_update_authority — keep as the (now powerless) PDA
            None,        // data — unchanged
            None,        // primary_sale_happened — unchanged
            Some(false), // is_mutable -> false (immutable)
        )?;

        // TODO(raydium): CPI -> create the AMM pool, seed it from the curve reserve, lock LP.
        Ok(())
    }
}

// ---- helpers ----

fn pay_in<'info>(
    system_program: &Program<'info, System>,
    from: &Signer<'info>,
    to: &AccountInfo<'info>,
    amount: u64,
) -> Result<()> {
    if amount == 0 { return Ok(()); }
    system_program::transfer(
        CpiContext::new(
            system_program.to_account_info(),
            system_program::Transfer { from: from.to_account_info(), to: to.clone() },
        ),
        amount,
    )
}

/// Move lamports out of a program-owned account by direct debit (no signer needed).
fn pay_out<'info>(from: &AccountInfo<'info>, to: &AccountInfo<'info>, amount: u64) -> Result<()> {
    if amount == 0 { return Ok(()); }
    **from.try_borrow_mut_lamports()? -= amount;
    **to.try_borrow_mut_lamports()? += amount;
    Ok(())
}

// ---- accounts ----

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub attester: Pubkey,
    pub fee_recipient: Pubkey,
    pub bump: u8,
}
impl Config { pub const SPACE: usize = 8 + 32 * 3 + 1; }

#[account]
pub struct TokenLaunch {
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub name: String,
    pub symbol: String,
    pub sol_reserve: u64,
    pub token_reserve: u64,
    pub real_curve_lamports: u64,
    pub floor_lamports: u64,
    pub supply: u64,
    pub social_count: u8,
    pub verified: bool,
    pub graduated: bool,
    pub bump: u8,
    pub vault_bump: u8,
}
impl TokenLaunch { pub const SPACE: usize = 8 + 32 + 32 + (4 + 32) + (4 + 10) + 8 * 5 + 1 + 1 + 1 + 1 + 1; }

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(init, payer = authority, space = Config::SPACE, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateToken<'info> {
    #[account(
        init, payer = creator, space = TokenLaunch::SPACE,
        seeds = [b"launch", mint.key().as_ref()], bump
    )]
    pub launch: Account<'info, TokenLaunch>,
    // No `mint::freeze_authority` -> the mint is created with freeze authority = None (fair: no
    // one can freeze holders). Mint authority is the launch PDA -> only the bonding curve mints.
    #[account(
        init, payer = creator, mint::decimals = 6, mint::authority = launch,
    )]
    pub mint: Account<'info, Mint>,
    /// CHECK: Metaplex Token Metadata PDA (seeds "metadata", metadata_program, mint). Validated by the CPI.
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// CHECK: program-owned SOL vault PDA; holds the locked floor. No data, no withdrawal path.
    #[account(
        init, payer = creator, space = 8, seeds = [b"vault", mint.key().as_ref()], bump
    )]
    pub floor_vault: AccountInfo<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = fee_recipient)]
    pub config: Account<'info, Config>,
    /// CHECK: platform fee recipient (must equal config.fee_recipient) — receives the launch fee.
    #[account(mut)]
    pub fee_recipient: AccountInfo<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub token_metadata_program: Program<'info, Metadata>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut, seeds = [b"launch", mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, TokenLaunch>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", mint.key().as_ref()], bump = launch.vault_bump)]
    /// CHECK: floor vault PDA
    pub floor_vault: AccountInfo<'info>,
    #[account(mut)]
    pub buyer_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: fee recipient from config
    #[account(mut)]
    pub fee_recipient: AccountInfo<'info>,
    /// CHECK: the launch creator — receives the 0.5% creator fee. Constrained to launch.creator.
    #[account(mut, address = launch.creator)]
    pub creator: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SellMarket<'info> {
    #[account(mut, seeds = [b"launch", mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, TokenLaunch>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", mint.key().as_ref()], bump = launch.vault_bump)]
    /// CHECK: floor vault PDA — receives the 2% sell tax
    pub floor_vault: AccountInfo<'info>,
    #[account(mut)]
    pub seller_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub seller: Signer<'info>,
    /// CHECK: fee recipient
    #[account(mut)]
    pub fee_recipient: AccountInfo<'info>,
    /// CHECK: the launch creator — receives the 0.5% creator fee. Constrained to launch.creator.
    #[account(mut, address = launch.creator)]
    pub creator: AccountInfo<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct RedeemFloor<'info> {
    #[account(mut, seeds = [b"launch", mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, TokenLaunch>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", mint.key().as_ref()], bump = launch.vault_bump)]
    /// CHECK: floor vault PDA
    pub floor_vault: AccountInfo<'info>,
    #[account(mut)]
    pub holder_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub holder: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct VerifyToken<'info> {
    #[account(mut, seeds = [b"launch", launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, TokenLaunch>,
    #[account(seeds = [b"config"], bump = config.bump, has_one = attester)]
    pub config: Account<'info, Config>,
    /// The platform attester must sign — this is the centralized verification step.
    pub attester: Signer<'info>,
}

#[derive(Accounts)]
pub struct TopUpFloor<'info> {
    #[account(mut, seeds = [b"launch", mint.key().as_ref()], bump = launch.bump)]
    pub launch: Account<'info, TokenLaunch>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"vault", mint.key().as_ref()], bump = launch.vault_bump)]
    /// CHECK: floor vault PDA
    pub floor_vault: AccountInfo<'info>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Graduate<'info> {
    #[account(mut, seeds = [b"launch", launch.mint.as_ref()], bump = launch.bump)]
    pub launch: Account<'info, TokenLaunch>,
    // mint + metadata are locked down at graduation (revoke mint authority, set metadata immutable).
    #[account(mut, address = launch.mint)]
    pub mint: Account<'info, Mint>,
    /// CHECK: Metaplex metadata PDA for the mint; validated by the update_metadata CPI.
    #[account(mut)]
    pub metadata: UncheckedAccount<'info>,
    /// Permissionless trigger — anyone can graduate a launch that has met the threshold.
    pub cranker: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub token_metadata_program: Program<'info, Metadata>,
}

#[error_code]
pub enum KolErr {
    #[msg("slippage exceeded")]
    Slippage,
    #[msg("curve insolvent")]
    CurveInsolvent,
    #[msg("need at least 3 bound socials")]
    NotEnoughSocials,
    #[msg("name or symbol too long")]
    TooLong,
    #[msg("trading has graduated to the public DEX")]
    Graduated,
    #[msg("already graduated")]
    AlreadyGraduated,
    #[msg("curve has not reached the graduation threshold")]
    BelowGraduationThreshold,
}
