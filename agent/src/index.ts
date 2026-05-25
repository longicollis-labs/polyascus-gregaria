import {DRY_RUN} from "./constants.js";
import {appendLog, readLog, recentPosts, secondsSince, type LogEntry} from "./log.js";
import {decide, type AgentInput} from "./llm.js";
import {readStage, STAGE_NAMES} from "./infection.js";
import {readVitals} from "./state.js";
import {postTweet} from "./x.js";
import {readFileSync, existsSync} from "node:fs";
import {loadInnerState, saveInnerState, evolveInnerState, renderInner} from "./inner.js";

// Most recent market cap recorded in the log, for the brood-motion signal.
function lastMcap(log: LogEntry[]): number | null {
    for (let i = log.length - 1; i >= 0; i--) {
        const m = log[i]!.vitals_snapshot.market_cap_usd;
        if (typeof m === "number" && m > 0) return m;
    }
    return null;
}

// One word for the brood's motion — the only outside signal Charybdis gets.
function describeBrood(cur: number | null, prev: number | null): AgentInput["brood"] {
    if (cur == null || cur === 0) return "still";
    if (prev == null || prev === 0) return "steady";
    if (cur >= prev * 1.05) return "swelling";
    if (cur <= prev * 0.95) return "thinning";
    return "steady";
}

// Her recent replies + the dry-world voices she answered, fed into self-evolution.
function recentRepliesAndVoices(): {replies: string[]; voices: {handle: string; said: string}[]} {
    const path = new URL("../../replies-log.json", import.meta.url).pathname;
    if (!existsSync(path)) return {replies: [], voices: []};
    try {
        const log = JSON.parse(readFileSync(path, "utf8"));
        const entries = (Object.values(log.answered ?? {}) as any[]).filter((e) => e && e.reply).slice(-6);
        return {
            replies: entries.map((e) => e.reply),
            voices: entries.filter((e) => e.author && e.said).map((e) => ({handle: e.author, said: e.said})),
        };
    } catch {
        return {replies: [], voices: []};
    }
}

async function main(): Promise<void> {
    const vitals = await readVitals();
    const log = readLog();
    const brood = describeBrood(vitals.market_cap_usd, lastMcap(log));
    const inf = await readStage();

    // Detect a stage advance since her last recorded run → she narrates the crossing.
    const curStageIdx = inf?.stage ?? null;
    let lastStageIdx: number | null = null;
    for (let i = log.length - 1; i >= 0; i--) {
        const s = log[i]!.stage_index;
        if (typeof s === "number") {
            lastStageIdx = s;
            break;
        }
    }
    const justAdvanced = curStageIdx != null && lastStageIdx != null && curStageIdx > lastStageIdx;

    const input: AgentInput = {
        recent_posts: recentPosts(log, 6),
        since_last_post_seconds: secondsSince(log, (e) => !!e.posted_tweet_id),
        brood,
        stage: inf?.name ?? "intrusion",
        just_advanced: justAdvanced,
        advanced_from: justAdvanced && lastStageIdx != null ? STAGE_NAMES[lastStageIdx]! : null,
    };
    console.log(
        "stage:",
        inf?.name ?? "intrusion",
        justAdvanced ? `(JUST CROSSED from ${STAGE_NAMES[lastStageIdx!]})` : "",
        "| brood:",
        brood,
        "(phase:",
        vitals.phase + ")",
    );

    const inner = loadInnerState();
    const decision = await decide(input, renderInner(inner));
    console.log("decision:", decision);

    // She is a narrator; she does not act on-chain. Claims/feeds are operator-run.
    let postedTweetId: string | null = null;
    if (decision.post_text && decision.post_text.trim().length > 0) {
        if (DRY_RUN) {
            console.log("[DRY] would post:", decision.post_text);
            postedTweetId = "DRY_RUN";
        } else {
            try {
                postedTweetId = await postTweet(decision.post_text);
                console.log("posted:", postedTweetId);
            } catch (err) {
                console.error("post failed:", err);
            }
        }
    }

    appendLog({
        ts: new Date().toISOString(),
        observations: decision.observations,
        deliberation: decision.deliberation,
        post_text: decision.post_text || null,
        posted_tweet_id: postedTweetId,
        action_kind: "none",
        action_amount_sol: 0,
        action_tx_sig: null,
        stage_index: curStageIdx,
        vitals_snapshot: {
            phase: vitals.phase,
            reserve_sol: vitals.reserve_sol,
            supply_tokens: vitals.supply_tokens,
            vault_sol: vitals.vault_sol,
            market_cap_usd: vitals.market_cap_usd,
            lifetime_seconds: vitals.lifetime_seconds,
            is_dead: vitals.is_dead,
        },
    });

    // Self-evolution: nudge her inner state one bounded step from this cycle.
    if (!DRY_RUN) {
        try {
            const {replies, voices} = recentRepliesAndVoices();
            const posts = input.recent_posts.map((p) => p.text);
            if (decision.post_text) posts.push(decision.post_text);
            const evolved = await evolveInnerState({
                current: inner,
                recentPosts: posts.slice(-6),
                recentReplies: replies,
                recentVoices: voices,
                stage: input.stage,
                justAdvanced: input.just_advanced,
            });
            saveInnerState(evolved);
            console.log("inner state evolved");
        } catch (e) {
            console.error("evolve failed:", (e as Error)?.message || e);
        }
    }
    console.log("done");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
