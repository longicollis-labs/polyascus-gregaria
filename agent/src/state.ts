// Unified vitals across both life stages. The runtime decides the phase:
//   • the program's parasite account exists  → adult (real mass/decay/vault)
//   • else a pump.fun mint is configured      → larval (creator fees, no decay)
//   • else                                     → unborn

import {
    BPS,
    EAT_RATE_BPS_PER_HOUR,
    LAMPORTS_PER_SOL,
    MOLT_THRESHOLD_SOL,
    PUMP_MINT,
    UNTOUCHED_LIFESPAN_SECONDS,
} from "./constants.js";
import {connection, hostBalanceSol, mintPda, readParasite} from "./program.js";
import {readPumpTelemetry} from "./pumpfun.js";

export type Phase = "unborn" | "larval" | "adult" | "dead";

export type Vitals = {
    phase: Phase;
    reserve_sol: number; // adult: the mass. larval: pool SOL (the brood's shape).
    supply_tokens: number;
    vault_sol: number | null; // adult: host vault. larval: accrued fees (off-telemetry → null).
    price_sol_per_token: number;
    market_cap_usd: number | null;
    lifetime_seconds: number;
    projected_time_to_death_seconds: number | null; // null in larval — no decay yet
    decay_is_real: boolean;
    is_dead: boolean;
    gathered_sol: number | null; // larval: host-wallet SOL hoarded toward the molt
    molt_threshold_sol: number | null; // larval: SOL the metamorphosis will cost her
    molt_ready: boolean; // larval: she has gathered enough to split the shell
};

const lamports = (bn: {toString(): string}) => Number(bn.toString()) / LAMPORTS_PER_SOL;

async function solUsd(): Promise<number | null> {
    try {
        const res = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        );
        const data = (await res.json()) as any;
        const p = data?.solana?.usd;
        return typeof p === "number" ? p : null;
    } catch {
        return null;
    }
}

export async function readVitals(): Promise<Vitals> {
    const acct = await readParasite();

    // ── Adult: the externa is live. Everything is real. ──
    if (acct) {
        const real = lamports(acct.realLamports);
        const vault = lamports(acct.hostVaultLamports);

        let supplyTokens = 0;
        try {
            const s = await connection.getTokenSupply(mintPda());
            supplyTokens = s.value.uiAmount ?? 0;
        } catch {
            /* mint not readable; leave 0 */
        }

        // Marginal price, mirroring the on-chain curve: vSOL / vToken.
        const vSol = real + 1; // VIRTUAL_SOL_INIT = 1 SOL
        const vTok = 10_000_000 - supplyTokens; // VIRTUAL_TOKEN_INIT = 10M
        const price = vTok > 0 ? vSol / vTok : 0;

        const bornAt = Number(acct.bornAt.toString());
        const termAt = Number(acct.terminatedAt.toString());
        const now = Math.floor(Date.now() / 1000);
        const lifetime = bornAt === 0 ? 0 : acct.dead ? termAt - bornAt : now - bornAt;

        const usd = await solUsd();
        const mcap = usd ? supplyTokens * price * usd : null;

        return {
            phase: acct.dead ? "dead" : "adult",
            reserve_sol: real,
            supply_tokens: supplyTokens,
            vault_sol: vault,
            price_sol_per_token: price,
            market_cap_usd: mcap,
            lifetime_seconds: lifetime,
            projected_time_to_death_seconds: acct.dead || real === 0 ? 0 : UNTOUCHED_LIFESPAN_SECONDS,
            decay_is_real: true,
            is_dead: acct.dead,
            gathered_sol: null,
            molt_threshold_sol: null,
            molt_ready: false,
        };
    }

    // ── Larval: the cyprid on pump.fun. No decay, no death. ──
    if (PUMP_MINT) {
        const t = await readPumpTelemetry();
        const gathered = await hostBalanceSol();
        return {
            phase: "larval",
            reserve_sol: t.liquidity_sol,
            supply_tokens: t.supply_tokens,
            vault_sol: null, // creator-fee balance isn't on DexScreener; the host claims blind
            price_sol_per_token: t.price_sol_per_token,
            market_cap_usd: t.market_cap_usd,
            lifetime_seconds: 0,
            projected_time_to_death_seconds: null,
            decay_is_real: false,
            is_dead: false,
            gathered_sol: gathered,
            molt_threshold_sol: MOLT_THRESHOLD_SOL,
            molt_ready: gathered !== null && gathered >= MOLT_THRESHOLD_SOL,
        };
    }

    // ── Unborn: nothing attached yet. ──
    return {
        phase: "unborn",
        reserve_sol: 0,
        supply_tokens: 0,
        vault_sol: 0,
        price_sol_per_token: 0,
        market_cap_usd: null,
        lifetime_seconds: 0,
        projected_time_to_death_seconds: null,
        decay_is_real: false,
        is_dead: false,
        gathered_sol: null,
        molt_threshold_sol: null,
        molt_ready: false,
    };
}

// Kept for symmetry with the decay narration; mirrors EAT_RATE.
export const HOURLY_DECAY_FRACTION = EAT_RATE_BPS_PER_HOUR / BPS;
