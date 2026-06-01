import {DRY_RUN} from "./constants.js";
import {appendLog, readLog, recentPosts, secondsSince, type LogEntry} from "./log.js";
import {decide, type AgentInput, type Decision} from "./llm.js";
import {readStage, STAGE_NAMES} from "./infection.js";
import {readVitals} from "./state.js";
import {postTweet} from "./x.js";
import {readFileSync, existsSync} from "node:fs";
import {loadInnerState, saveInnerState, evolveInnerState, renderInner} from "./inner.js";
import {loadCurrents, saveCurrents, evolveCurrents} from "./currents.js";
import {ARCHETYPES} from "./swarm/archetypes.js";
import {claw} from "./swarm/claw.js";
import {judgeElect, keepBetter} from "./swarm/judge.js";
import {swarmSizeForStage} from "./swarm/scale.js";
import {maybeGlitch} from "./glitch.js";
import {host} from "./swarm/host.js";
import {loadPursuit, savePursuit, renderPursuit, generatePursuitGoal, advancePursuit, appendWorkEntry} from "./pursuit.js";

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
        recent_posts: recentPosts(log, 20),
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

    // Over-dispatch backstop. The Render trigger paces her to ~20–25 min, but when
    // its CDN-cached log read is stale a just-posted tweet looks invisible and it
    // re-dispatches within minutes — and with cancel-in-progress:false those extra
    // runs queue and post, so two or three near-identical tweets land in a row.
    // This workflow checks out fresh main each run, so the last-post time here is
    // reliable: refuse a *normal* post inside MIN_POST_GAP_S of the last one. A
    // stage crossing is exempt (it must narrate at once) — and once a crossing is
    // logged, a repeat dispatch is no longer "just advanced", so it falls through
    // to this same gate. Complements trigger.mjs's dispatch cooldown but, unlike
    // it, runs on GitHub Actions off latest main, so it needs no external redeploy.
    const MIN_POST_GAP_S = 15 * 60;
    const sinceLastPost = secondsSince(log, (e) => !!e.posted_tweet_id);
    if (!justAdvanced && sinceLastPost != null && sinceLastPost < MIN_POST_GAP_S) {
        console.log(`skip: last post ${Math.round(sinceLastPost / 60)}m ago (< ${MIN_POST_GAP_S / 60}m floor) and no crossing — over-dispatch backstop`);
        return;
    }

    const inner = loadInnerState();
    let innerRendered = renderInner(inner);

    // If pursuit state exists, feed the goal into the prompt so posts WANT it.
    // Folded into innerRendered (the inner-context block passed to both the
    // claw-swarm and the single-LLM decide()), so it nudges both branches without
    // disturbing the swarm/decide branch logic. Null on first run (no state yet);
    // the goal is generated AFTER this cycle's post in the non-blocking block below.
    {
        const pursuit = loadPursuit();
        if (pursuit) {
            innerRendered +=
                "\n\n--- your pursuit (what you are reaching for, together) ---\n" + renderPursuit(pursuit);
        }
    }

    // Stridulation T-005: when SWARM_ENABLED=1, route the post through the
    // claw-swarm (N claws → deliberate → host curator). Default OFF — the live
    // posting path runs the single-LLM decide() unchanged until the operator
    // flips it on, after T-007 swarm-dry + T-016 head-to-head taste-test pass.
    // N is the number of claws (default 3; T-015 will scale toward 12).
    let decision: Decision;
    // Stridulation T-006: when SWARM_ENABLED=1, capture the deliberation for
    // the log so the scriptorium (T-008/T-009) and receipt hash (T-011) have
    // the per-post claws + elected + host metadata. Stays undefined on the
    // single-LLM path, and JSON.stringify drops undefined keys → additive.
    let swarmMeta: LogEntry["swarm"] = undefined;
    // The swarm GROWS with the colonisation (scale.ts): one voice at intrusion,
    // the full council by merger — the medium enacting the one-becomes-many arc.
    // SWARM_N overrides the stage curve (testing). n < 2 means she is still one
    // crab: the single-LLM voice, no council. Default OFF until the operator flips.
    const swarmN =
        process.env.SWARM_ENABLED === "1"
            ? process.env.SWARM_N
                ? Math.max(1, Math.min(parseInt(process.env.SWARM_N, 10) || 1, ARCHETYPES.length))
                : swarmSizeForStage(curStageIdx)
            : 0;
    if (swarmN >= 2) {
        const n = swarmN;
        const archetypes = ARCHETYPES.slice(0, n);
        const drafts = await Promise.all(archetypes.map((a) => claw(a, input, innerRendered)));
        // #1 quality selection: heuristic pre-filter → stronger-model judge panel.
        // #3 top-K runners-up handed to the host to synthesise across.
        const {elected, runnersUp, scores, meta} = await judgeElect(drafts, {recent_posts: input.recent_posts, stage: input.stage});
        const hostResult = await host({input, inner: innerRendered, elected, dissent: runnersUp});
        // #4 anti-blandify: ship the host polish only if it beats the elected raw draft.
        const {text, kept} = await keepBetter(hostResult.decision.post_text ?? "", elected.decision.post_text ?? "", input.stage);
        decision = {...hostResult.decision, post_text: text};
        swarmMeta = {
            n,
            elected_archetype_id: elected.archetype_id,
            drafts: drafts.map((d) => ({
                archetype_id: d.archetype_id,
                post_text: d.decision.post_text ?? "",
                ms: d.ms,
                tokens: d.tokens,
            })),
            scores,
            // The real deliberation: how the judge panel ranked the drafts — the
            // scriptorium shows this as the council's verdict (the `scores` above
            // are only the heuristic pre-filter, not the chooser).
            judge: {method: meta.method, model: meta.model, panel: meta.panel, ranked_ids: meta.ranked_ids},
            host: {
                ms: hostResult.ms,
                tokens: hostResult.tokens,
                tripped: kept === "raw" ? [...hostResult.tripped, "kept-raw"] : [...hostResult.tripped],
            },
            // T-012: captured here so the scriptorium permalink can recompute
            // the receipt hash client-side. Omitted when the chain read failed
            // (inf is null) — the same condition that nulls stage_index.
            fed_at_post: inf?.fed_sol,
        };
        console.log(
            `swarm: stage=${input.stage} N=${n} elected=${elected.archetype_id} kept=${kept} ` +
                `host_tripped=[${hostResult.tripped.join(",")}] ms=${hostResult.ms} tokens=${hostResult.tokens}`,
        );
    } else {
        if (process.env.SWARM_ENABLED === "1")
            console.log(`swarm: ${input.stage} → one voice (she is still one crab)`);
        decision = await decide(input, innerRendered);
    }

    // Occasional textual corruption — the breach bleeding into the post itself: now and
    // then 1–2 words come through "glitched" with combining marks (Zalgo), kept within
    // X's 280-char budget (the glitch is dropped rather than overrun the limit). Applied
    // to her posts only; replies and comments are untouched.
    if (decision.post_text) decision.post_text = maybeGlitch(decision.post_text);
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
        swarm: swarmMeta,
    });

    // --- The swarm's self-chosen pursuit --------------------------------------
    // On first run (no pursuit state), generate the goal in-fiction. Each cycle,
    // append an entry to site/the-work.json and evolve the pursuit one step. The
    // whole block mirrors the evolveInnerState try/catch (below): it runs AFTER the
    // post is logged, so it has decision.post_text, and a throw here logs but does
    // NOT re-throw — the post is already out. All file writes (savePursuit,
    // appendWorkEntry) are guarded by !DRY_RUN; in DRY_RUN nothing is persisted.
    if (!DRY_RUN) {
        try {
            let pursuit = loadPursuit();
            // First run: the swarm chooses its goal.
            if (!pursuit) {
                pursuit = await generatePursuitGoal(input.stage);
                savePursuit(pursuit);
                console.log("pursuit goal generated");
            }
            // Append this cycle's entry to the public artifact (guards inside).
            const entryText = decision.post_text || "";
            if (entryText.trim()) {
                appendWorkEntry(new Date().toISOString(), pursuit.moves, entryText);
            }
            // Evolve the pursuit one bounded step from this entry, then persist.
            const evolved = await advancePursuit(pursuit, entryText, input.stage);
            savePursuit(evolved);
            console.log("pursuit evolved");
        } catch (e) {
            console.error("pursuit failed:", (e as Error)?.message || e);
            // Non-blocking: do not re-throw; the post is already logged.
        }
    }

    // Self-evolution: nudge her inner state one bounded step from this cycle.
    if (!DRY_RUN) {
        try {
            const {replies, voices} = recentRepliesAndVoices();
            const posts = input.recent_posts.map((p) => p.text);
            if (decision.post_text) posts.push(decision.post_text);
            const evolved = await evolveInnerState({
                current: inner,
                recentPosts: posts.slice(-8),
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

        // Language self-evolution: drift the register she reads in one bounded step
        // toward her current stage's pole, so her LANGUAGE arcs in lockstep with the
        // narrative (currents.ts). Isolated in its own try/catch — a currents failure
        // must never block posting or corrupt the inner-state evolve above. Skipped
        // when the on-chain stage was unread this cycle (curStageIdx null): input.stage
        // then falls back to "intrusion", and on a first run that would seed and latch
        // the shallow register. A null read is "no information," not "she regressed."
        if (curStageIdx != null) {
            try {
                const posts = input.recent_posts.map((p) => p.text);
                if (decision.post_text) posts.push(decision.post_text);
                const evolvedCurrents = await evolveCurrents({
                    current: loadCurrents(input.stage),
                    recentPosts: posts.slice(-8),
                    stage: input.stage,
                    justAdvanced: input.just_advanced,
                });
                saveCurrents(evolvedCurrents, input.stage);
                console.log("language current evolved");
            } catch (e) {
                console.error("evolve currents failed:", (e as Error)?.message || e);
            }
        } else {
            console.log("skip language-current evolve: on-chain stage unread this cycle");
        }
    }
    console.log("done");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
