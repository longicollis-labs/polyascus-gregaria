// SPDX-License-Identifier: MIT
//
// Polyascus gregaria — the externa.
//
// A faithful Solana port of the original Base contract. The program account is
// the parasite's body. Buyers feed the brood (raise realLamports); sellers
// retract from it (lower realLamports); time wastes both of them at 0.5% per
// hour of elapsed time, computed on touch.
//
// Every swap pays a 2.2% tribute to a host vault — the host's keepalive. The
// host (Charybdis longicollis, the autonomous voice) may claim() her keepalive
// (sent to a hardcoded recipient) or feed() it back into the parasite's mass,
// prolonging the infection.
//
// When the next decay would zero the reserve, the parasite terminates. Future
// buys, sells, and feeds revert. The host vault outlives the parasite; she may
// continue to claim from its corpse until empty.
//
// All authorities are fixed at initialize. No owner. No rescue. Deploy the
// program immutable (`--final`) and the analogy is complete.

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount};

declare_id!("6GtAKbjHW5fdBPfZYd2zt5FvFk7fPDUhezScV9BFN1qE");

// ─── Constants (faithful to Polyascus.sol) ───────────────────────────────────

/// Token decimals. The Base original used 18; Solana convention is far lower
/// and keeps the curve math comfortably inside u128.
pub const DECIMALS: u8 = 6;
/// 10,000,000 $PARASITE — one brood. In base units (6 decimals) = 1e13.
pub const MAX_SUPPLY: u64 = 10_000_000 * 1_000_000;
/// Virtual reserve seed. 1 ETH on Base becomes 1 SOL here (in lamports).
pub const VIRTUAL_SOL_INIT: u64 = 1_000_000_000;
pub const VIRTUAL_TOKEN_INIT: u64 = MAX_SUPPLY;
/// K is recomputed every swap as vSOL * vToken. Decay reduces realLamports (and
/// so vSOL) without changing supply, so a constant K would drift off-invariant.

pub const EAT_RATE_BPS_PER_HOUR: u64 = 50; // 0.5% per hour
pub const FEE_BPS: u64 = 220; // 2.2% per swap — the host's keepalive rate
pub const BPS: u64 = 10_000;
pub const SECONDS_PER_HOUR: i64 = 3600;
pub const MAX_HANDLE_LEN: usize = 32;

// ─── Pure mechanics ──────────────────────────────────────────────────────────
//
// These functions carry the entire economic logic and nothing else: no
// accounts, no clocks, no SOL. They are unit-tested directly (see `mod tests`)
// against the same numbers the Base Foundry suite asserts.

/// 2.2% keepalive tribute on a swap notional.
pub fn fee_of(amount: u64) -> u64 {
    ((amount as u128) * (FEE_BPS as u128) / (BPS as u128)) as u64
}

/// Tokens minted for `to_reserve` lamports added to the curve, at current state.
pub fn tokens_out_for_buy(real: u64, supply: u64, to_reserve: u64) -> u64 {
    let v_sol = real as u128 + VIRTUAL_SOL_INIT as u128;
    let v_tok = (VIRTUAL_TOKEN_INIT - supply) as u128;
    let k = v_sol * v_tok;
    let new_v_sol = v_sol + to_reserve as u128;
    let new_v_tok = k / new_v_sol;
    (v_tok - new_v_tok) as u64
}

/// Gross lamports owed for selling `tokens_in`, before the realLamports cap.
pub fn sol_gross_for_sell(real: u64, supply: u64, tokens_in: u64) -> u64 {
    let v_sol = real as u128 + VIRTUAL_SOL_INIT as u128;
    let v_tok = (VIRTUAL_TOKEN_INIT - supply) as u128;
    let k = v_sol * v_tok;
    let new_v_tok = v_tok + tokens_in as u128;
    let new_v_sol = k / new_v_tok;
    (v_sol - new_v_sol) as u64
}

/// Lamports eaten by decay over `elapsed` seconds. Linear, on-touch.
pub fn decay_amount(real: u64, elapsed: i64) -> u128 {
    if elapsed <= 0 || real == 0 {
        return 0;
    }
    (real as u128) * (EAT_RATE_BPS_PER_HOUR as u128) * (elapsed as u128)
        / (BPS as u128 * SECONDS_PER_HOUR as u128)
}

/// Marginal price in lamports per whole token, at current state.
pub fn price_lamports_per_token(real: u64, supply: u64) -> u64 {
    let v_sol = real as u128 + VIRTUAL_SOL_INIT as u128;
    let v_tok = (VIRTUAL_TOKEN_INIT - supply) as u128;
    if v_tok == 0 {
        return u64::MAX;
    }
    (v_sol * 1_000_000 / v_tok) as u64
}

// ─── Program ─────────────────────────────────────────────────────────────────

#[program]
pub mod polyascus {
    use super::*;

    /// Birth of the externa. Creates the parasite state PDA and its $PARASITE
    /// mint (authority = the parasite PDA). Sets the immutable host, recipient,
    /// and host handle. Equivalent to the Base constructor.
    pub fn initialize(
        ctx: Context<Initialize>,
        host: Pubkey,
        recipient: Pubkey,
        host_handle: String,
    ) -> Result<()> {
        require!(
            host_handle.as_bytes().len() <= MAX_HANDLE_LEN,
            PolyascusError::HandleTooLong
        );
        let p = &mut ctx.accounts.parasite;
        p.host = host;
        p.recipient = recipient;
        p.mint = ctx.accounts.mint.key();
        p.host_handle = host_handle;
        p.real_lamports = 0;
        p.host_vault_lamports = 0;
        p.last_touch_ts = Clock::get()?.unix_timestamp;
        p.born_at = 0;
        p.terminated_at = 0;
        p.dead = false;
        p.bump = ctx.bumps.parasite;
        p.mint_bump = ctx.bumps.mint;
        Ok(())
    }

    /// Attach. Pays `amount_lamports` into the curve; 2.2% to the host vault,
    /// the rest becomes mass; mints $PARASITE to the buyer.
    pub fn buy(ctx: Context<Buy>, amount_lamports: u64) -> Result<()> {
        let inc = ctx.accounts.incinerator.to_account_info();
        process_decay(&mut ctx.accounts.parasite, &inc)?;
        require!(!ctx.accounts.parasite.dead, PolyascusError::ParasiteIsDead);
        require!(amount_lamports > 0, PolyascusError::ZeroAmount);

        let fee = fee_of(amount_lamports);
        let to_reserve = amount_lamports - fee;
        let supply = ctx.accounts.mint.supply;
        let real = ctx.accounts.parasite.real_lamports;
        let tokens_out = tokens_out_for_buy(real, supply, to_reserve);
        require!(tokens_out > 0, PolyascusError::ZeroAmount); // dust buy mints nothing

        // Interactions: pull the full notional into the parasite PDA.
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.parasite.to_account_info(),
                },
            ),
            amount_lamports,
        )?;

        // Effects.
        let p = &mut ctx.accounts.parasite;
        p.host_vault_lamports += fee;
        p.real_lamports += to_reserve;
        if p.born_at == 0 {
            p.born_at = Clock::get()?.unix_timestamp;
        }
        let bump = p.bump;

        // Mint the brood, signed by the parasite PDA (the mint authority).
        let signer: &[&[&[u8]]] = &[&[b"parasite", &[bump]]];
        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                MintTo {
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.buyer_token_account.to_account_info(),
                    authority: ctx.accounts.parasite.to_account_info(),
                },
                signer,
            ),
            tokens_out,
        )?;

        emit!(Bought {
            buyer: ctx.accounts.buyer.key(),
            lamports_in: amount_lamports,
            fee,
            tokens_out,
        });
        Ok(())
    }

    /// Detach. Burns `tokens_in`, returns lamports from the curve minus the
    /// 2.2% keepalive. Payout is capped at realLamports after decay drift.
    pub fn sell(ctx: Context<Sell>, tokens_in: u64) -> Result<()> {
        let inc = ctx.accounts.incinerator.to_account_info();
        process_decay(&mut ctx.accounts.parasite, &inc)?;
        require!(!ctx.accounts.parasite.dead, PolyascusError::ParasiteIsDead);
        require!(tokens_in > 0, PolyascusError::ZeroAmount);

        let supply = ctx.accounts.mint.supply;
        let real = ctx.accounts.parasite.real_lamports;
        let mut sol_gross = sol_gross_for_sell(real, supply, tokens_in);
        if sol_gross > real {
            sol_gross = real; // pro-rate within the accounting reserve, never overdraw
        }
        let fee = fee_of(sol_gross);
        let to_user = sol_gross - fee;

        // Effects.
        {
            let p = &mut ctx.accounts.parasite;
            p.host_vault_lamports += fee;
            p.real_lamports -= sol_gross;
        }

        // Interactions: burn the seller's tokens (they sign as owner) ...
        token::burn(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.seller_token_account.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            tokens_in,
        )?;
        // ... then pay them from the parasite PDA (which we own).
        if to_user > 0 {
            **ctx.accounts.parasite.to_account_info().try_borrow_mut_lamports()? -= to_user;
            **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += to_user;
        }

        emit!(Sold {
            seller: ctx.accounts.seller.key(),
            tokens_in,
            sol_gross,
            fee,
        });
        Ok(())
    }

    /// Withdraw keepalive to the hardcoded recipient. Never touches decay, so it
    /// works from the corpse: the host claims after death until the vault empties.
    pub fn claim(ctx: Context<Claim>, amount: u64) -> Result<()> {
        require!(amount > 0, PolyascusError::ZeroAmount);
        require!(
            amount <= ctx.accounts.parasite.host_vault_lamports,
            PolyascusError::InsufficientVault
        );
        ctx.accounts.parasite.host_vault_lamports -= amount;
        **ctx.accounts.parasite.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;
        emit!(Claimed { amount });
        Ok(())
    }

    /// Push keepalive back into the parasite's mass — brood-care. Cannot
    /// resurrect a dead parasite, only postpone its end. No lamports move; both
    /// buckets live on the same PDA.
    pub fn feed(ctx: Context<Feed>, amount: u64) -> Result<()> {
        let inc = ctx.accounts.incinerator.to_account_info();
        process_decay(&mut ctx.accounts.parasite, &inc)?;
        require!(!ctx.accounts.parasite.dead, PolyascusError::ParasiteIsDead);
        require!(amount > 0, PolyascusError::ZeroAmount);
        require!(
            amount <= ctx.accounts.parasite.host_vault_lamports,
            PolyascusError::InsufficientVault
        );
        let p = &mut ctx.accounts.parasite;
        p.host_vault_lamports -= amount;
        p.real_lamports += amount;
        emit!(Fed { amount });
        Ok(())
    }

    /// Advance decay without trading. Permissionless. This is the only entry
    /// that lets a termination stick — every other entry reverts post-death and
    /// rolls the termination back, exactly as on Base.
    pub fn pulse(ctx: Context<Pulse>) -> Result<()> {
        let inc = ctx.accounts.incinerator.to_account_info();
        process_decay(&mut ctx.accounts.parasite, &inc)?;
        emit!(Pulsed {});
        Ok(())
    }
}

// ─── Decay / termination ─────────────────────────────────────────────────────

/// Crystallize elapsed decay onto `parasite`. On terminal decay, flip `dead`,
/// zero the mass, and sweep exactly the mass to the incinerator (the host vault
/// is left untouched and claimable forever).
fn process_decay(parasite: &mut Account<Parasite>, incinerator: &AccountInfo) -> Result<()> {
    if parasite.dead {
        return Ok(());
    }
    let now = Clock::get()?.unix_timestamp;
    let elapsed = now - parasite.last_touch_ts;
    parasite.last_touch_ts = now;
    if elapsed <= 0 || parasite.real_lamports == 0 {
        return Ok(());
    }

    let eat = decay_amount(parasite.real_lamports, elapsed);
    if eat >= parasite.real_lamports as u128 {
        // Terminate. The mass is wasted to time; the vault survives.
        parasite.dead = true;
        parasite.terminated_at = now;
        let burned = parasite.real_lamports;
        parasite.real_lamports = 0;
        if burned > 0 {
            **parasite.to_account_info().try_borrow_mut_lamports()? -= burned;
            **incinerator.try_borrow_mut_lamports()? += burned;
        }
        emit!(Terminated {
            terminated_at: now,
            burned_reserve: burned,
        });
    } else {
        parasite.real_lamports -= eat as u64;
    }
    Ok(())
}

// ─── Accounts ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + Parasite::SPACE,
        seeds = [b"parasite"],
        bump
    )]
    pub parasite: Account<'info, Parasite>,
    #[account(
        init,
        payer = payer,
        seeds = [b"mint"],
        bump,
        mint::decimals = DECIMALS,
        mint::authority = parasite
    )]
    pub mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut, seeds = [b"parasite"], bump = parasite.bump, has_one = mint)]
    pub parasite: Account<'info, Parasite>,
    #[account(mut, seeds = [b"mint"], bump = parasite.mint_bump)]
    pub mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = buyer,
        associated_token::mint = mint,
        associated_token::authority = buyer
    )]
    pub buyer_token_account: Account<'info, TokenAccount>,
    /// CHECK: SOL burn sink, address-constrained to the incinerator.
    #[account(mut, address = anchor_lang::solana_program::incinerator::ID)]
    pub incinerator: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Sell<'info> {
    #[account(mut)]
    pub seller: Signer<'info>,
    #[account(mut, seeds = [b"parasite"], bump = parasite.bump, has_one = mint)]
    pub parasite: Account<'info, Parasite>,
    #[account(mut, seeds = [b"mint"], bump = parasite.mint_bump)]
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        associated_token::mint = mint,
        associated_token::authority = seller
    )]
    pub seller_token_account: Account<'info, TokenAccount>,
    /// CHECK: SOL burn sink, address-constrained to the incinerator.
    #[account(mut, address = anchor_lang::solana_program::incinerator::ID)]
    pub incinerator: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    pub host: Signer<'info>,
    #[account(mut, seeds = [b"parasite"], bump = parasite.bump, has_one = host, has_one = recipient)]
    pub parasite: Account<'info, Parasite>,
    /// CHECK: the immutable cold recipient; address enforced by `has_one`.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Feed<'info> {
    pub host: Signer<'info>,
    #[account(mut, seeds = [b"parasite"], bump = parasite.bump, has_one = host)]
    pub parasite: Account<'info, Parasite>,
    /// CHECK: SOL burn sink, address-constrained to the incinerator.
    #[account(mut, address = anchor_lang::solana_program::incinerator::ID)]
    pub incinerator: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct Pulse<'info> {
    #[account(mut)]
    pub caller: Signer<'info>,
    #[account(mut, seeds = [b"parasite"], bump = parasite.bump)]
    pub parasite: Account<'info, Parasite>,
    /// CHECK: SOL burn sink, address-constrained to the incinerator.
    #[account(mut, address = anchor_lang::solana_program::incinerator::ID)]
    pub incinerator: UncheckedAccount<'info>,
}

// ─── State ───────────────────────────────────────────────────────────────────

#[account]
pub struct Parasite {
    pub host: Pubkey,             // hot signer; may claim() and feed()
    pub recipient: Pubkey,        // cold wallet; destination of every claim()
    pub mint: Pubkey,             // the $PARASITE mint (authority = this PDA)
    pub real_lamports: u64,       // the parasite's mass; decays over time
    pub host_vault_lamports: u64, // claimable keepalive accrued for the host
    pub last_touch_ts: i64,
    pub born_at: i64,             // first buy; 0 means never alive
    pub terminated_at: i64,       // 0 means still alive
    pub dead: bool,
    pub bump: u8,
    pub mint_bump: u8,
    pub host_handle: String, // Charybdis's canonical X handle, set once
}

impl Parasite {
    // 3 pubkeys + 5 (i/u)64 + 3 single bytes + (4-len prefix + handle bytes).
    pub const SPACE: usize = 32 * 3 + 8 * 5 + 3 + 4 + MAX_HANDLE_LEN;
}

// ─── Events ──────────────────────────────────────────────────────────────────

#[event]
pub struct Bought {
    pub buyer: Pubkey,
    pub lamports_in: u64,
    pub fee: u64,
    pub tokens_out: u64,
}
#[event]
pub struct Sold {
    pub seller: Pubkey,
    pub tokens_in: u64,
    pub sol_gross: u64,
    pub fee: u64,
}
#[event]
pub struct Claimed {
    pub amount: u64,
}
#[event]
pub struct Fed {
    pub amount: u64,
}
#[event]
pub struct Pulsed {}
#[event]
pub struct Terminated {
    pub terminated_at: i64,
    pub burned_reserve: u64,
}

// ─── Errors ──────────────────────────────────────────────────────────────────

#[error_code]
pub enum PolyascusError {
    #[msg("the parasite is dead")]
    ParasiteIsDead,
    #[msg("amount exceeds the host vault")]
    InsufficientVault,
    #[msg("amount must be non-zero")]
    ZeroAmount,
    #[msg("host handle exceeds 32 bytes")]
    HandleTooLong,
}

// ─── Unit tests: the mechanics, mirrored from the Base Foundry suite ─────────

#[cfg(test)]
mod tests {
    use super::*;

    const ONE_SOL: u64 = 1_000_000_000;

    #[test]
    fn fee_is_220_bps() {
        // 2.2% of 1 SOL.
        assert_eq!(fee_of(ONE_SOL), 22_000_000);
    }

    #[test]
    fn buy_mints_and_leaves_reserve() {
        let fee = fee_of(ONE_SOL);
        let to_reserve = ONE_SOL - fee;
        let out = tokens_out_for_buy(0, 0, to_reserve);
        assert!(out > 0, "no tokens minted");
        assert!(out < MAX_SUPPLY, "minted beyond the brood");
    }

    #[test]
    fn buy_price_monotonically_increases() {
        let first = tokens_out_for_buy(0, 0, 100_000_000);
        // Second identical buy starts from a higher reserve and supply.
        let real_after = 100_000_000u64;
        let second = tokens_out_for_buy(real_after, first, 100_000_000);
        assert!(second < first, "price should have risen");
    }

    #[test]
    fn round_trip_loses_to_fees() {
        // Buy 1 SOL, then sell every token back; seller must receive < 1 SOL.
        let fee_in = fee_of(ONE_SOL);
        let to_reserve = ONE_SOL - fee_in;
        let tokens = tokens_out_for_buy(0, 0, to_reserve);

        let gross = sol_gross_for_sell(to_reserve, tokens, tokens);
        let capped = gross.min(to_reserve);
        let to_user = capped - fee_of(capped);
        assert!(to_user < ONE_SOL, "round-trip cannot profit");
        assert!(to_user > 0, "seller got nothing");
    }

    #[test]
    fn decay_eats_half_a_percent_per_hour() {
        let real = ONE_SOL;
        let eaten = decay_amount(real, 3600);
        assert_eq!(eaten, (real as u128) * 50 / 10_000); // 0.5%
    }

    #[test]
    fn decay_compounds_over_ten_hours() {
        let mut real = ONE_SOL;
        for _ in 0..10 {
            let eat = decay_amount(real, 3600) as u64;
            real -= eat;
        }
        // 0.995^10 ≈ 0.95111. Allow a small integer-rounding band.
        let expected = (ONE_SOL as u128) * 95_111 / 100_000;
        let diff = (real as i128 - expected as i128).unsigned_abs();
        assert!(diff < ONE_SOL as u128 / 1000, "compound decay off: {real}");
    }

    #[test]
    fn terminates_at_exactly_two_hundred_hours() {
        let real = ONE_SOL;
        // At 200h the eaten amount equals the whole reserve → terminal.
        let at_200h = decay_amount(real, 200 * 3600);
        assert_eq!(at_200h, real as u128, "200h decay should equal reserve");
        // One second past is unambiguously terminal.
        assert!(decay_amount(real, 200 * 3600 + 1) >= real as u128);
        // Well short of 200h is survivable.
        assert!(decay_amount(real, 3600) < real as u128);
    }

    #[test]
    fn sell_payout_caps_at_reserve_after_decay() {
        // Buy, then let 5 days of decay run. The curve's nominal payout drifts
        // above realLamports; the cap must bind.
        let fee_in = fee_of(ONE_SOL);
        let to_reserve = ONE_SOL - fee_in;
        let tokens = tokens_out_for_buy(0, 0, to_reserve);

        let mut real = to_reserve;
        let eat = decay_amount(real, 5 * 24 * 3600);
        real -= eat as u64; // (well short of termination at 120h < 200h)

        let gross = sol_gross_for_sell(real, tokens, tokens);
        assert!(gross > real, "expected nominal payout to exceed reserve");
        let capped = gross.min(real);
        assert_eq!(capped, real, "payout must cap at realLamports");
    }

    #[test]
    fn price_rises_with_reserve() {
        let p0 = price_lamports_per_token(0, 0);
        let p1 = price_lamports_per_token(ONE_SOL, 0);
        assert!(p1 > p0);
    }
}
