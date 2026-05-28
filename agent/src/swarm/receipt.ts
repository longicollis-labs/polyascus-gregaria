// Stridulation T-011 — receipt schema + deterministic content-hashing helper.
//
// A receipt commits to the deliberation context that produced one swarm post:
// which claws drafted what, which one the curator elected, where the host
// polish landed on X, and the on-chain state at the moment of speaking.
// The hash is what T-013 will write to a Solana memo from `scribe.sol`, and
// what T-012/T-014 will surface on the scriptorium permalink. Anyone reading
// the chain memo + the scriptorium log entry can recompute the hash here and
// verify the deliberation has not been tampered with.
//
// V1 design notes (revisit at T-018 / T-013):
//  - tick_id equals `ts` (one cron tick = one post). A separate counter can
//    arrive later without breaking V1 receipts — readers gate on `version`.
//  - `inference_provider` is passed in explicitly so a future hybrid path
//    (T-018: Anthropic + Chutes/Bittensor) can stamp the receipt honestly.
//  - The hash is SHA-256 over a canonical JSON encoding: top-level keys in
//    schema order, claws sorted by archetype_id, no whitespace. Numbers use
//    the JS default serialiser (sufficient — all V1 callers are Node).

import {createHash} from "node:crypto";

export const RECEIPT_VERSION = 1;

export type ReceiptClaw = {
    archetype_id: string;
    post_text: string;
};

export type Receipt = {
    version: number;
    /** V1: equals `ts`. A future cron tick counter may diverge from `ts`. */
    tick_id: string;
    /** ISO-8601 UTC, e.g. "2026-05-28T13:01:54.790Z". */
    ts: string;
    /** Every archetype draft that went into deliberation. */
    claws: ReceiptClaw[];
    /** archetype_id of the draft the curator elected. */
    elected_id: string;
    /** X tweet id of the host's posted polish; null on dry-run / post failure. */
    host_post_id: string | null;
    /** Inference backend used for the claws + host call ("anthropic" pre-T-018). */
    inference_provider: string;
    /** On-chain colonisation stage at post time (0..=6). */
    infection_stage: number;
    /** Cumulative SOL fed to the infection at post time (◎). */
    fed_at_post: number;
};

/**
 * Stable JSON encoding for hashing. Top-level keys appear in schema order;
 * claws are sorted by `archetype_id` ascending; no whitespace. Two callers
 * with the same logical receipt always produce the same string.
 */
export function canonicalizeReceipt(r: Receipt): string {
    const claws = [...r.claws]
        .sort((a, b) => a.archetype_id.localeCompare(b.archetype_id))
        .map((c) => ({archetype_id: c.archetype_id, post_text: c.post_text}));
    const canonical = {
        version: r.version,
        tick_id: r.tick_id,
        ts: r.ts,
        claws,
        elected_id: r.elected_id,
        host_post_id: r.host_post_id,
        inference_provider: r.inference_provider,
        infection_stage: r.infection_stage,
        fed_at_post: r.fed_at_post,
    };
    return JSON.stringify(canonical);
}

/** SHA-256 hex digest of the canonical receipt encoding. */
export function receiptHash(r: Receipt): string {
    return createHash("sha256").update(canonicalizeReceipt(r)).digest("hex");
}
