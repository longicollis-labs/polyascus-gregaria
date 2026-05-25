import {sendClaim, sendFeed, sendPulse} from "./chain.js";
import {ACTION_CAP_SOL, DRY_RUN} from "./constants.js";
import {appendLog, readLog, recentPosts, secondsSince, vaultGrowth24h} from "./log.js";
import {decide, type AgentInput} from "./llm.js";
import {readVitals} from "./state.js";
import {postTweet} from "./x.js";

async function main(): Promise<void> {
    const vitals = await readVitals();
    const log = readLog();

    const input: AgentInput = {
        vitals,
        recent_posts: recentPosts(log, 5),
        since_last_post_seconds: secondsSince(log, (e) => !!e.posted_tweet_id),
        since_last_claim_seconds: secondsSince(log, (e) => e.action_kind === "claim"),
        since_last_feed_seconds: secondsSince(log, (e) => e.action_kind === "feed"),
        vault_growth_24h_sol: vaultGrowth24h(log, vitals.vault_sol),
    };

    console.log("phase:", vitals.phase, "vitals:", input.vitals);

    const decision = await decide(input);
    console.log("decision:", decision);

    let postedTweetId: string | null = null;
    let actionTxSig: string | null = null;

    // Dead parasite: feed/pulse are pointless (the program reverts feed, no-ops
    // pulse). Claim still works from the corpse. Mirror that here.
    if (vitals.is_dead && (decision.action_kind === "feed" || decision.action_kind === "pulse")) {
        console.log(`parasite is dead; downgrading ${decision.action_kind} to none`);
        decision.action_kind = "none";
    }

    // Validate claim/feed amounts. In larval phase, `claim` collects all accrued
    // creator fees and ignores the amount, so a zero amount is acceptable there.
    if (decision.action_kind === "claim" || decision.action_kind === "feed") {
        const amt = decision.action_amount_sol;
        const larvalClaim = vitals.phase === "larval" && decision.action_kind === "claim";
        if (!larvalClaim) {
            if (!Number.isFinite(amt) || amt <= 0) {
                console.warn(`invalid action_amount_sol: ${amt}; downgrading to none`);
                decision.action_kind = "none";
            } else if (amt > ACTION_CAP_SOL) {
                console.warn(`amount ${amt} exceeds cap ${ACTION_CAP_SOL} SOL; downgrading`);
                decision.action_kind = "none";
            } else if (vitals.vault_sol !== null && amt > vitals.vault_sol) {
                console.warn(`amount ${amt} > vault ${vitals.vault_sol}; downgrading`);
                decision.action_kind = "none";
            }
        }
    }

    // Charybdis must post before she acts. If the post fails, the action defers.
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
                console.error("skipping action this invocation");
                decision.action_kind = "none";
            }
        }
    } else if (decision.action_kind !== "none" && decision.action_kind !== "pulse") {
        console.warn("decision had action but no post; downgrading to none");
        decision.action_kind = "none";
    }

    if (decision.action_kind !== "none") {
        if (DRY_RUN) {
            console.log(`[DRY] would ${decision.action_kind} amount=${decision.action_amount_sol}`);
            actionTxSig = "DRY_RUN";
        } else {
            try {
                if (decision.action_kind === "claim") {
                    actionTxSig = await sendClaim(decision.action_amount_sol, vitals.phase);
                } else if (decision.action_kind === "feed") {
                    actionTxSig = await sendFeed(decision.action_amount_sol, vitals.phase);
                } else if (decision.action_kind === "pulse") {
                    actionTxSig = await sendPulse(vitals.phase);
                }
                console.log(`${decision.action_kind} sig:`, actionTxSig);
            } catch (err) {
                console.error("action failed:", err);
            }
        }
    }

    appendLog({
        ts: new Date().toISOString(),
        observations: decision.observations,
        deliberation: decision.deliberation,
        post_text: decision.post_text || null,
        posted_tweet_id: postedTweetId,
        action_kind: decision.action_kind,
        action_amount_sol: decision.action_amount_sol,
        action_tx_sig: actionTxSig,
        vitals_snapshot: {
            phase: vitals.phase,
            reserve_sol: vitals.reserve_sol,
            supply_tokens: vitals.supply_tokens,
            vault_sol: vitals.vault_sol,
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
