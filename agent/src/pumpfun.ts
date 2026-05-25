// Larval phase — the cyprid on pump.fun.
//
// Read-only market telemetry via DexScreener; the host's economic verbs via
// PumpPortal's local (self-signed) transaction API:
//   • collectCreatorFee  → claim accrued creator fees (the proto-keepalive)
//   • buy                → buyback, the larval analogue of feed (brood-care)
//
// No decay, no termination here: the externa has not formed. Those become real
// only at metamorphosis, when the program account is initialized.

import {VersionedTransaction} from "@solana/web3.js";
import {DEXSCREENER_BASE, PUMPPORTAL_BASE, PUMP_MINT} from "./constants.js";
import {connection, hostKeypair} from "./program.js";

export type PumpTelemetry = {
    price_sol_per_token: number;
    market_cap_usd: number | null;
    liquidity_sol: number; // SOL side of the pool — the brood's current shape
    supply_tokens: number;
};

/** Read the larval shell's market state from DexScreener. */
export async function readPumpTelemetry(): Promise<PumpTelemetry> {
    const res = await fetch(`${DEXSCREENER_BASE}/latest/dex/tokens/${PUMP_MINT}`);
    if (!res.ok) throw new Error(`dexscreener ${res.status}`);
    const data = (await res.json()) as any;
    const pairs: any[] = data?.pairs ?? [];
    if (pairs.length === 0) {
        return {price_sol_per_token: 0, market_cap_usd: null, liquidity_sol: 0, supply_tokens: 0};
    }
    // Prefer the pump.fun / highest-liquidity pair.
    const pair =
        pairs.find((p) => (p.dexId ?? "").toLowerCase().includes("pump")) ??
        pairs.sort((a, b) => (b?.liquidity?.usd ?? 0) - (a?.liquidity?.usd ?? 0))[0];

    const priceNative = Number(pair?.priceNative ?? 0); // token priced in SOL
    const marketCap = Number(pair?.marketCap ?? pair?.fdv ?? 0) || null;
    const liquiditySol = Number(pair?.liquidity?.quote ?? 0); // SOL side
    // marketCap / priceUsd ≈ circulating supply; fall back to nominal 1B if absent.
    const priceUsd = Number(pair?.priceUsd ?? 0);
    const supply = priceUsd > 0 && marketCap ? marketCap / priceUsd : 0;

    return {
        price_sol_per_token: priceNative,
        market_cap_usd: marketCap,
        liquidity_sol: liquiditySol,
        supply_tokens: supply,
    };
}

/** POST a PumpPortal local action, sign with the host key, broadcast. */
async function sendLocal(body: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${PUMPPORTAL_BASE}/trade-local`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`pumpportal ${res.status}: ${await res.text()}`);
    const tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
    tx.sign([hostKeypair()]);
    return connection.sendTransaction(tx);
}

/** Claim accrued creator fees. pump.fun settles all at once; no mint needed. */
export async function collectCreatorFee(): Promise<string> {
    const host = hostKeypair();
    return sendLocal({
        publicKey: host.publicKey.toBase58(),
        action: "collectCreatorFee",
        priorityFee: 0.000001,
        pool: "pump",
    });
}

/** Buy back into the brood — the larval analogue of feed. `sol` denominated SOL. */
export async function buyback(sol: number): Promise<string> {
    const host = hostKeypair();
    return sendLocal({
        publicKey: host.publicKey.toBase58(),
        action: "buy",
        mint: PUMP_MINT,
        amount: sol,
        denominatedInSol: "true",
        slippage: 10,
        priorityFee: 0.000001,
        pool: "auto",
    });
}
