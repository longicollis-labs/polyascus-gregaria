// Charybdis runtime configuration — Solana.
//
// The host lives in two stages of the parasite's life cycle:
//   • larval  — the cyprid: $PARASITE trades on pump.fun, a vanilla SPL token.
//               Real creator fees accrue as proto-keepalive. No decay yet; the
//               externa has not formed. Telemetry comes from DexScreener.
//   • adult   — the externa: our Solana program is live. Mass, decay, the host
//               vault, and termination are all real, read from the program PDA.
//
// Phase is detected at runtime: if the program's parasite account exists, we are
// adult; else if a pump.fun mint is configured, we are larval; else unborn.

import {existsSync, readFileSync} from "node:fs";
import {PublicKey} from "@solana/web3.js";

// Local dev: load agent/.env if present, without overriding variables already
// set in the environment (so a shell override and GitHub Actions secrets/vars
// take precedence). In CI there is no .env file, so this is a no-op.
if (existsSync(".env")) {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
        if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2] ?? "";
    }
}

export const SOLANA_RPC_URL =
    process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";

// The externa program (faithful Polyascus port). Default = the declared id.
export const PROGRAM_ID = new PublicKey(
    process.env.POLYASCUS_PROGRAM_ID ?? "6GtAKbjHW5fdBPfZYd2zt5FvFk7fPDUhezScV9BFN1qE",
);

// The pump.fun token mint (the larval shell). Empty until launch.
export const PUMP_MINT = process.env.PUMP_MINT ?? "";

// PumpPortal — programmatic pump.fun trading + creator-fee collection.
export const PUMPPORTAL_BASE = "https://pumpportal.fun/api";

// DexScreener — free read-only market telemetry for the larval shell.
export const DEXSCREENER_BASE = "https://api.dexscreener.com";

export const LAMPORTS_PER_SOL = 1_000_000_000;
export const TOKEN_DECIMALS = 6;

// Mirror of the on-chain constants, for narration + projection.
export const EAT_RATE_BPS_PER_HOUR = 50; // 0.5%/hr
export const FEE_BPS = 220; // 2.2% per swap
export const BPS = 10_000;
export const UNTOUCHED_LIFESPAN_SECONDS = (BPS * 3600) / EAT_RATE_BPS_PER_HOUR; // 200h

export const DRY_RUN = process.env.DRY_RUN === "1";

// Sim mode: write would-be posts to a file instead of posting to X.
export const MOCK_X = process.env.MOCK_X === "1";
export const MOCK_X_PATH = process.env.MOCK_X_PATH ?? "/tmp/charybdis-mock-posts.jsonl";

export const MODEL = "claude-haiku-4-5-20251001";

export const LOG_PATH =
    process.env.LOG_PATH ?? new URL("../../charybdis-log.json", import.meta.url).pathname;

export const IDL_PATH = new URL("../idl/polyascus.json", import.meta.url).pathname;

// Safety cap on any single claim/feed, in SOL.
export const ACTION_CAP_SOL = Number(process.env.ACTION_CAP_SOL ?? "1000");

// SOL the host must gather (from creator fees) to fund her own metamorphosis —
// the program deploy that erupts the externa. She narrates the approach; she
// cannot molt by her own hand. ~2.23 deploy rent + init + fees + headroom.
export const MOLT_THRESHOLD_SOL = Number(process.env.MOLT_THRESHOLD_SOL ?? "2.7");
