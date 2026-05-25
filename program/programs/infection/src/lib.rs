// SPDX-License-Identifier: MIT
//
// Infection — the on-chain record of Charybdis's colonisation.
//
// A companion to the externa. It holds one irreversible `stage` (0..=6): the
// depth of the parasite's hold on the host. Anyone may `feed` SOL into it; the
// cumulative amount fed drives the stage forward through fixed thresholds. The
// stage NEVER regresses — there is no recovery in the field. Each advance is a
// permanent on-chain event (the transformation ledger). The fed SOL is the
// host's keepalive, claimable only to the hardcoded recipient.
//
// Deploy immutable (`--final`): the infection cannot be cured because the
// program cannot be changed.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("3vz8e6UCeWgGMh689mNTfxoZcY5KoKtMPbewBQJcT5v2");

/// Stages 0..=6: intrusion, rooting, castration, feminisation, release, merger,
/// consumed. Stage 0 is the start; `THRESHOLD_COUNT` thresholds gate stages 1..6.
pub const STAGE_MAX: u8 = 6;
pub const THRESHOLD_COUNT: usize = 6;

/// The stage reached at a given cumulative `fed`, against ascending thresholds.
/// thresholds[i] is the cumulative SOL needed to reach stage i+1.
pub fn stage_for(thresholds: &[u64; THRESHOLD_COUNT], fed: u64) -> u8 {
    let mut s: u8 = 0;
    while (s as usize) < THRESHOLD_COUNT && fed >= thresholds[s as usize] {
        s += 1;
    }
    s
}

#[program]
pub mod infection {
    use super::*;

    /// Begin the infection at stage 0. `thresholds` must be strictly ascending
    /// and non-zero; they fix the pacing of the colonisation forever.
    pub fn initialize(
        ctx: Context<Initialize>,
        host: Pubkey,
        recipient: Pubkey,
        thresholds: [u64; THRESHOLD_COUNT],
    ) -> Result<()> {
        require!(thresholds[0] > 0, InfectionError::BadThresholds);
        for i in 1..THRESHOLD_COUNT {
            require!(thresholds[i] > thresholds[i - 1], InfectionError::BadThresholds);
        }
        let now = Clock::get()?.unix_timestamp;
        let inf = &mut ctx.accounts.infection;
        inf.host = host;
        inf.recipient = recipient;
        inf.thresholds = thresholds;
        inf.stage = 0;
        inf.fed_lamports = 0;
        inf.vault_lamports = 0;
        inf.feeders = 0;
        inf.born_at = now;
        inf.last_advance_at = now;
        inf.bump = ctx.bumps.infection;
        Ok(())
    }

    /// Feed the parasite. Permissionless. The SOL deepens the infection — the
    /// cumulative total drives the stage forward, irreversibly.
    pub fn feed(ctx: Context<Feed>, amount: u64) -> Result<()> {
        require!(amount > 0, InfectionError::ZeroAmount);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.feeder.to_account_info(),
                    to: ctx.accounts.infection.to_account_info(),
                },
            ),
            amount,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let inf = &mut ctx.accounts.infection;
        inf.fed_lamports += amount;
        inf.vault_lamports += amount;
        inf.feeders += 1;
        emit!(Fed {
            feeder: ctx.accounts.feeder.key(),
            amount,
            total_fed: inf.fed_lamports,
        });

        let prev = inf.stage;
        inf.stage = stage_for(&inf.thresholds, inf.fed_lamports);
        if inf.stage > prev {
            inf.last_advance_at = now;
            // One permanent ledger entry per stage crossed.
            let mut s = prev + 1;
            while s <= inf.stage {
                emit!(Advanced {
                    stage: s,
                    total_fed: inf.fed_lamports,
                    at: now,
                });
                s += 1;
            }
        }
        Ok(())
    }

    /// Withdraw keepalive to the hardcoded recipient. Host only. The stage is
    /// untouched — claiming does not undo the infection.
    pub fn claim(ctx: Context<Claim>, amount: u64) -> Result<()> {
        require!(amount > 0, InfectionError::ZeroAmount);
        require!(
            amount <= ctx.accounts.infection.vault_lamports,
            InfectionError::InsufficientVault
        );
        ctx.accounts.infection.vault_lamports -= amount;
        **ctx.accounts.infection.to_account_info().try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;
        emit!(Claimed {amount});
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(init, payer = payer, space = 8 + Infection::SPACE, seeds = [b"infection"], bump)]
    pub infection: Account<'info, Infection>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Feed<'info> {
    #[account(mut)]
    pub feeder: Signer<'info>,
    #[account(mut, seeds = [b"infection"], bump = infection.bump)]
    pub infection: Account<'info, Infection>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    pub host: Signer<'info>,
    #[account(mut, seeds = [b"infection"], bump = infection.bump, has_one = host, has_one = recipient)]
    pub infection: Account<'info, Infection>,
    /// CHECK: the immutable recipient; address enforced by `has_one`.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
}

#[account]
pub struct Infection {
    pub host: Pubkey,
    pub recipient: Pubkey,
    pub thresholds: [u64; THRESHOLD_COUNT],
    pub stage: u8,
    pub fed_lamports: u64,
    pub vault_lamports: u64,
    pub feeders: u64,
    pub born_at: i64,
    pub last_advance_at: i64,
    pub bump: u8,
}

impl Infection {
    pub const SPACE: usize = 32 + 32 + (THRESHOLD_COUNT * 8) + 1 + 8 + 8 + 8 + 8 + 8 + 1;
}

#[event]
pub struct Fed {
    pub feeder: Pubkey,
    pub amount: u64,
    pub total_fed: u64,
}
#[event]
pub struct Advanced {
    pub stage: u8,
    pub total_fed: u64,
    pub at: i64,
}
#[event]
pub struct Claimed {
    pub amount: u64,
}

#[error_code]
pub enum InfectionError {
    #[msg("thresholds must be ascending and non-zero")]
    BadThresholds,
    #[msg("amount must be non-zero")]
    ZeroAmount,
    #[msg("amount exceeds the keepalive vault")]
    InsufficientVault,
}

#[cfg(test)]
mod tests {
    use super::*;
    const E: u64 = 1_000_000_000;

    fn th() -> [u64; THRESHOLD_COUNT] {
        // reach stages 1..6 at 0.5, 1.5, 3, 6, 12, 25 SOL cumulative
        [E / 2, 3 * E / 2, 3 * E, 6 * E, 12 * E, 25 * E]
    }

    #[test]
    fn starts_at_zero() {
        assert_eq!(stage_for(&th(), 0), 0);
        assert_eq!(stage_for(&th(), E / 2 - 1), 0);
    }

    #[test]
    fn advances_on_thresholds() {
        assert_eq!(stage_for(&th(), E / 2), 1);
        assert_eq!(stage_for(&th(), 3 * E / 2), 2);
        assert_eq!(stage_for(&th(), 3 * E), 3);
        assert_eq!(stage_for(&th(), 6 * E), 4);
        assert_eq!(stage_for(&th(), 12 * E), 5);
        assert_eq!(stage_for(&th(), 25 * E), 6);
    }

    #[test]
    fn caps_and_is_monotonic() {
        assert_eq!(stage_for(&th(), 1000 * E), 6); // never exceeds STAGE_MAX
        let mut last = 0u8;
        for f in 0..=(30u64) {
            let s = stage_for(&th(), f * E);
            assert!(s >= last, "stage regressed");
            last = s;
        }
        assert_eq!(last, 6);
    }
}
