import {DRY_RUN} from "./constants.js";
import {appendLog, readLog, recentPosts, secondsSince, type LogEntry} from "./log.js";
import {decide, type AgentInput} from "./llm.js";
import {readVitals} from "./state.js";
import {postTweet} from "./x.js";

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

async function main(): Promise<void> {
    const vitals = await readVitals();
    const log = readLog();
    const brood = describeBrood(vitals.market_cap_usd, lastMcap(log));

    const input: AgentInput = {
        recent_posts: recentPosts(log, 6),
        since_last_post_seconds: secondsSince(log, (e) => !!e.posted_tweet_id),
        brood,
    };
    console.log("brood:", brood, "(phase:", vitals.phase + ")");

    const decision = await decide(input);
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
    console.log("done");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
