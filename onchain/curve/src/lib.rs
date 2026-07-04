//! Pure floor + bonding-curve math for kolpad — no Solana deps, so `cargo test -p kolpad-curve`
//! proves the money logic on any machine. The Anchor program (programs/kolpad) calls these.
//!
//! Two subsystems share one supply:
//!   MARKET — constant-product (x*y=k) curve for price discovery / the upside.
//!   FLOOR  — a locked treasury (20% of every buy) that backs a guaranteed redemption price.
//!
//! Guarantee (see tests): floor price can never be pushed to zero by selling, and never
//! decreases from a market sell or a floor redemption — it only ratchets up as the token is bought.

pub const BPS: u128 = 10_000;
pub const PRICE_SCALE: u128 = 1_000_000_000; // 1e9, lamports-per-token fixed point

/// Split an incoming buy into (fee, to_floor, to_curve).
pub fn split_buy(amount: u128, fee_bps: u128, floor_bps: u128) -> (u128, u128, u128) {
    let fee = amount * fee_bps / BPS;
    let net = amount - fee;
    let to_floor = net * floor_bps / BPS;
    let to_curve = net - to_floor;
    (fee, to_floor, to_curve)
}

/// Constant-product buy: tokens minted for `sol_in` added to the curve.
pub fn buy_tokens_out(sol_reserve: u128, token_reserve: u128, sol_in: u128) -> u128 {
    let k = sol_reserve * token_reserve;
    let new_sol = sol_reserve + sol_in;
    let new_tok = k / new_sol;
    token_reserve - new_tok
}

/// Constant-product sell: lamports out for `tokens_in` returned to the curve.
pub fn sell_sol_out(sol_reserve: u128, token_reserve: u128, tokens_in: u128) -> u128 {
    let k = sol_reserve * token_reserve;
    let new_tok = token_reserve + tokens_in;
    let new_sol = k / new_tok;
    sol_reserve - new_sol
}

/// Guaranteed floor price (lamports per token, 1e9-scaled) = floor_lamports / supply.
pub fn floor_price_scaled(floor_lamports: u128, supply: u128) -> u128 {
    if supply == 0 { return 0; }
    floor_lamports * PRICE_SCALE / supply
}

/// Proportional payout for redeeming `amount` tokens against the floor treasury.
pub fn redeem_floor_lamports(floor_lamports: u128, supply: u128, amount: u128) -> u128 {
    if supply == 0 { return 0; }
    floor_lamports * amount / supply
}

#[cfg(test)]
mod tests {
    use super::*;

    const FEE_BPS: u128 = 125;     // 1.25%
    const SELL_TAX_BPS: u128 = 200; // 2% sell tax -> floor
    const FLOOR_BPS: u128 = 2000;  // 20%
    const VIRTUAL_SOL: u128 = 2_000_000_000;            // 2 SOL virtual
    const INIT_TOKENS: u128 = 1_000_000_000_000_000;    // 1e9 tokens @ 6 decimals

    struct Pad { sol: u128, tok: u128, floor: u128, supply: u128 }
    impl Pad {
        fn new() -> Self { Pad { sol: VIRTUAL_SOL, tok: INIT_TOKENS, floor: 0, supply: 0 } }
        fn buy(&mut self, lamports: u128) {
            let (_fee, to_floor, to_curve) = split_buy(lamports, FEE_BPS, FLOOR_BPS);
            let out = buy_tokens_out(self.sol, self.tok, to_curve);
            self.sol += to_curve; self.tok -= out; self.floor += to_floor; self.supply += out;
        }
        fn sell_market(&mut self, tokens: u128) {
            // gross leaves the curve; the 2% sell tax is redirected from the seller INTO the floor.
            let gross = sell_sol_out(self.sol, self.tok, tokens);
            let floor_tax = gross * SELL_TAX_BPS / BPS;
            let new_tok = self.tok + tokens;
            let new_sol = (self.sol * self.tok) / new_tok;
            self.sol = new_sol; self.tok = new_tok; self.supply -= tokens;
            self.floor += floor_tax;
        }
        fn redeem_floor(&mut self, tokens: u128) {
            let payout = redeem_floor_lamports(self.floor, self.supply, tokens);
            self.floor -= payout; self.supply -= tokens;
        }
        fn floor_price(&self) -> u128 { floor_price_scaled(self.floor, self.supply) }
    }

    #[test]
    fn locks_exactly_20_percent() {
        let (_fee, to_floor, to_curve) = split_buy(10_000_000_000, FEE_BPS, FLOOR_BPS);
        let net = 10_000_000_000u128 * 9875 / 10000;
        assert_eq!(to_floor, net * 2000 / 10000);
        assert_eq!(to_floor + to_curve, net);
    }

    #[test]
    fn floor_never_zero_and_only_ratchets_up_on_buys() {
        let mut p = Pad::new();
        let mut last = 0u128;
        for _ in 0..6 {
            p.buy(10_000_000_000);
            let f = p.floor_price();
            assert!(f > 0, "floor must never be zero");
            assert!(f >= last, "floor must not decrease across buys");
            last = f;
        }
    }

    #[test]
    fn whale_dump_cannot_lower_the_floor() {
        let mut p = Pad::new();
        p.buy(5_000_000_000);
        p.buy(5_000_000_000);
        let before = p.floor_price();
        p.buy(50_000_000_000);
        let whale_tokens = INIT_TOKENS - p.tok - (p.supply - (INIT_TOKENS - p.tok)); // = tokens whale holds
        // simpler: track supply delta — sell back everything the last buy minted
        let _ = whale_tokens;
        // sell back an amount equal to the whale's holdings (recompute): supply now includes whale's
        // For the invariant we just dump a large chunk and confirm the floor does not fall.
        let dump = p.supply / 2;
        p.sell_market(dump);
        let after = p.floor_price();
        assert!(after >= before, "market dump must not lower the floor");
        assert!(after > 0);
    }

    #[test]
    fn sell_tax_raises_floor_per_token() {
        // Constitution rule 2: a dump must strictly RAISE the floor-per-token for those who stay,
        // because the 2% sell tax flows into the floor vault while supply shrinks.
        let mut p = Pad::new();
        p.buy(10_000_000_000);
        p.buy(10_000_000_000);
        let before = p.floor_price();
        p.sell_market(p.supply / 3);
        let after = p.floor_price();
        assert!(after > before, "the 2% sell tax must raise floor-per-token on a dump");
    }

    #[test]
    fn floor_redeem_is_floor_neutral() {
        let mut p = Pad::new();
        p.buy(10_000_000_000);
        p.buy(10_000_000_000);
        let before = p.floor_price();
        let half = p.supply / 2;
        p.redeem_floor(half);
        let after = p.floor_price();
        let diff = if after > before { after - before } else { before - after };
        assert!(diff <= 2, "proportional redemption is floor-neutral within rounding");
    }
}
