import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {LOG_PATH} from "./constants.js";
import type {Phase} from "./state.js";

export type LogEntry = {
    ts: string;
    observations: string;
    deliberation: string;
    post_text: string | null;
    posted_tweet_id: string | null;
    action_kind: "none" | "pulse" | "claim" | "feed";
    action_amount_sol: number;
    action_tx_sig: string | null;
    // The on-chain colonisation stage at this run (0..=6), for advance detection.
    stage_index: number | null;
    vitals_snapshot: {
        phase: Phase;
        reserve_sol: number;
        supply_tokens: number;
        vault_sol: number | null;
        market_cap_usd: number | null;
        lifetime_seconds: number;
        is_dead: boolean;
    };
    // Stridulation T-006: optional swarm deliberation metadata. Present only on
    // runs where SWARM_ENABLED=1 wired through claw → deliberate → host. Absent
    // (JSON.stringify drops undefined keys) on single-LLM runs — so this field
    // is purely additive. The scriptorium (T-008/T-009) reads it for per-post
    // permalinks; the receipt hash (T-011/T-012) hashes the canonical sub-fields.
    // `tripped` strings are the canonical HostResult.tripped values
    // ("tic" | "morning" | "epiphany" | "opener"); kept as string[] here so
    // log.ts stays independent of the swarm layer.
    // `fed_at_post` is the cumulative SOL fed to the infection at post time,
    // captured here so the scriptorium (T-012) can recompute the receipt hash
    // client-side byte-for-byte against receipt.ts's canonical encoding.
    // Undefined when the chain read failed at log-write time (rare — same
    // condition that nulls `stage_index`); the client-side hash gates on it.
    swarm?: {
        n: number;
        elected_archetype_id: string;
        drafts: {
            archetype_id: string;
            post_text: string;
            ms: number;
            tokens: number;
        }[];
        scores: {
            archetype_id: string;
            total: number;
            freshness: number;
            affinity: number;
            length_fit: number;
            tic_pass: boolean;
        }[];
        // The quality selection: how the judge panel ranked the drafts (best-first
        // archetype_ids). `scores` above is only the heuristic pre-filter; this is
        // the chooser the scriptorium shows. "fallback" method = no judge (≤1
        // survivor or no API key) and ranked_ids is just the elected.
        judge?: {
            method: string;
            model: string;
            panel: number;
            ranked_ids: string[];
        };
        host: {
            ms: number;
            tokens: number;
            tripped: string[];
        };
        fed_at_post?: number;
    };
};

export function readLog(): LogEntry[] {
    if (!existsSync(LOG_PATH)) return [];
    const raw = readFileSync(LOG_PATH, "utf8");
    if (raw.trim().length === 0) return [];
    return JSON.parse(raw) as LogEntry[];
}

export function appendLog(entry: LogEntry): void {
    const current = readLog();
    current.push(entry);
    writeFileSync(LOG_PATH, JSON.stringify(current, null, 2) + "\n");
}

export function recentPosts(log: LogEntry[], n: number): {text: string; posted_at_iso: string}[] {
    return log
        .filter((e) => e.post_text && e.post_text.length > 0)
        .slice(-n)
        .map((e) => ({text: e.post_text!, posted_at_iso: e.ts}));
}

export function secondsSince(log: LogEntry[], predicate: (e: LogEntry) => boolean): number | null {
    const matches = log.filter(predicate);
    if (matches.length === 0) return null;
    const last = matches[matches.length - 1]!;
    return Math.floor((Date.now() - new Date(last.ts).getTime()) / 1000);
}

export function vaultGrowth24h(log: LogEntry[], currentVault: number | null): number {
    if (currentVault === null) return 0;
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const oldEntries = log.filter((e) => new Date(e.ts).getTime() < cutoff);
    if (oldEntries.length === 0) return currentVault;
    const prior = oldEntries[oldEntries.length - 1]!.vitals_snapshot.vault_sol ?? 0;
    return Math.max(0, currentVault - prior);
}
