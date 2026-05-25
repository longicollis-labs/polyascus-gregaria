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
    vitals_snapshot: {
        phase: Phase;
        reserve_sol: number;
        supply_tokens: number;
        vault_sol: number | null;
        market_cap_usd: number | null;
        lifetime_seconds: number;
        is_dead: boolean;
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
