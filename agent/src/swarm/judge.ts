// Stridulation — QUALITY selection for the swarm (replaces deliberate()'s
// quality-blind election as the chooser; deliberate() stays as the pre-filter).
//
// WHY: a blind A/B diagnostic (npm run swarm-diag) showed the 12-draft pool
// already contains drafts that beat single-Haiku ~80/72/80 (in-voice/memorable/
// would-share), but deliberate()'s heuristic (freshness+affinity+length, never
// quality) mis-picked the best draft 5/5 fixtures and shipped drafts that only
// tie single (and score 20% on memorability). Selection was the bottleneck.
//
// judgeElect(): (1) PRE-FILTER with deliberate()'s heuristics as hard guardrails
// (drop tic-trips / stale openers / wrong length); (2) a PANEL of judges on a
// STRONGER model each rank the survivors over a shuffled order; (3) aggregate by
// Borda count → elected + runners-up (top-K for the host to synthesise across).
// Pairwise/listwise relative judging (not pointwise 1-10) and order-shuffling
// per judge mitigate the pointwise-tie + position-bias failure modes from the
// LLM-judge literature. Falls back to deliberate()'s election if the API key is
// absent or ≤1 draft survives — never silent, never throws on a normal pool.
//
// keepBetter(): the anti-blandification safety — A/B the host's polish against
// the elected raw draft (order-swapped judge); ship whichever wins. A polish
// step can regress to the bland mean; this guarantees we never ship a polished
// beat that's worse than the raw gem the judge chose.
//
// Operator-protected voice-level code; NEVER on the live path until
// SWARM_ENABLED=1 (default OFF). Models configurable via env.

import {generateObject} from "ai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {createHash} from "node:crypto";
import {z} from "zod";
import {MODEL} from "../constants.js";
import {deliberate, type Score} from "./deliberate.js";
import type {ClawDraft} from "./claw.js";
import {finalizePost, type AgentInput} from "../llm.js";

// The judge/aggregator should be STRONGER than the Haiku generators — selection
// is where extra capability pays off (verifier literature: +14–40% on best-of-N).
export const JUDGE_MODEL = process.env.SWARM_JUDGE_MODEL || "claude-sonnet-4-6";
const JUDGE_PANEL = Math.max(1, parseInt(process.env.SWARM_JUDGE_PANEL ?? "3", 10) || 3);

const PERSONA =
    "Charybdis — a crab being colonised by a parasite (Polyascus gregaria), narrating her own " +
    "transformation: fierce, wild, scholarly-mad, never resigned, never naming AI/price/mechanics.";

export type JudgeResult = {
    elected: ClawDraft;
    /** Best alternatives after the elected, best-first (top-K for the host). */
    runnersUp: ClawDraft[];
    /** deliberate()'s heuristic scores, preserved for the log/scriptorium. */
    scores: Score[];
    /** How the election was made + the judge's ranking, for ops/scriptorium. */
    meta: {method: "judge" | "fallback"; model: string; panel: number; ranked_ids: string[]};
};

function coin(s: string): boolean {
    return parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16) % 2 === 0;
}

const RankSchema = z.object({
    ranked: z.array(z.number().int()).min(1).describe("candidate numbers, BEST first; include at least the top 3"),
});

/** Choose the best draft (and runners-up) from the pool by a stronger-model judge panel. */
export async function judgeElect(
    drafts: readonly ClawDraft[],
    ctx: {recent_posts: AgentInput["recent_posts"]; stage: string},
): Promise<JudgeResult> {
    const delib = deliberate(drafts, ctx);

    // PRE-FILTER: deliberate()'s heuristics as hard guardrails, not the chooser.
    const scoreOf = new Map(delib.scores.map((s) => [s.archetype_id, s]));
    const survivors = drafts.filter((d) => {
        const s = scoreOf.get(d.archetype_id);
        return s && s.tic_pass && s.freshness > 0 && s.length_fit > 0;
    });
    const pool = survivors.length >= 2 ? survivors : drafts.slice();

    const fallback = (): JudgeResult => ({
        elected: delib.elected,
        runnersUp: delib.dissent.slice(0, 2),
        scores: delib.scores,
        meta: {method: "fallback", model: "none", panel: 0, ranked_ids: [delib.elected.archetype_id]},
    });

    if (pool.length === 1)
        return {elected: pool[0]!, runnersUp: [], scores: delib.scores, meta: {method: "fallback", model: "none", panel: 0, ranked_ids: [pool[0]!.archetype_id]}};
    if (!process.env.ANTHROPIC_API_KEY) return fallback();

    const judge = createAnthropic({apiKey: process.env.ANTHROPIC_API_KEY});
    const texts = pool.map((d) => d.decision.post_text ?? "");
    const ctxLine = `stage: ${ctx.stage}`;

    // Borda points per pool index, summed across the panel.
    const points = new Array(pool.length).fill(0);
    const ballots = await Promise.all(
        Array.from({length: JUDGE_PANEL}, async (_, j) => {
            // shuffle presentation per judge to defuse position bias
            const order = pool.map((_d, i) => i).sort((a, b) => (coin(`${ctx.stage}|${a}|${b}|${j}`) ? 1 : -1));
            const shown = order.map((idx, k) => `[${k + 1}]\n${texts[idx]}`).join("\n\n");
            try {
                const {object} = await generateObject({
                    model: judge(JUDGE_MODEL),
                    schema: RankSchema,
                    system:
                        `Rank these candidate posts from ${PERSONA} BEST first, judging in-voice fidelity, ` +
                        `memorability, and shareability together (favour a sharp, specific, memorable line over a safe one). ` +
                        `Return candidate numbers best-first.`,
                    prompt: `Context: ${ctxLine}\n\nCandidates:\n${shown}\n\nRank best-first (numbers 1..${pool.length}).`,
                    maxRetries: 2,
                });
                return object.ranked.map((shownPos) => order[shownPos - 1]).filter((x): x is number => x != null);
            } catch {
                return [];
            }
        }),
    );
    let anyBallot = false;
    for (const ranked of ballots) {
        if (!ranked.length) continue;
        anyBallot = true;
        ranked.forEach((poolIdx, rank) => {
            points[poolIdx] += pool.length - rank; // higher = better
        });
    }
    if (!anyBallot) return fallback();

    const ordered = pool.map((d, i) => ({d, p: points[i]})).sort((a, b) => b.p - a.p);
    return {
        elected: ordered[0]!.d,
        runnersUp: ordered.slice(1, 3).map((o) => o.d),
        scores: delib.scores,
        meta: {method: "judge", model: JUDGE_MODEL, panel: JUDGE_PANEL, ranked_ids: ordered.map((o) => o.d.archetype_id)},
    };
}

const ABSchema = z.object({
    in_voice: z.enum(["1", "2", "tie"]),
    memorable: z.enum(["1", "2", "tie"]),
    would_share: z.enum(["1", "2", "tie"]),
});

/**
 * Anti-blandification: compare the host's polish (1) against the elected raw draft (2).
 * Returns whichever wins on the most axes (raw wins ties — never blandify a chosen gem).
 */
export async function keepBetter(
    polished: string,
    raw: string,
    stage: string,
): Promise<{text: string; kept: "polished" | "raw"}> {
    const rawFinal = finalizePost(raw); // strip marks + 280-cap so a kept raw is post-ready
    if (!polished.trim()) return {text: rawFinal, kept: "raw"};
    if (!rawFinal.trim() || !process.env.ANTHROPIC_API_KEY) return {text: polished, kept: "polished"};
    const judge = createAnthropic({apiKey: process.env.ANTHROPIC_API_KEY});
    const polFirst = coin(`${stage}|keepbetter|${polished.length}`);
    const p1 = polFirst ? polished : rawFinal, p2 = polFirst ? rawFinal : polished;
    try {
        const {object} = await generateObject({
            model: judge(JUDGE_MODEL),
            schema: ABSchema,
            system:
                `Blind-judge two posts from ${PERSONA} Per axis pick the better ("1","2","tie"): ` +
                `in_voice, memorable, would_share. Be decisive.`,
            prompt: `Context: stage ${stage}\n\nPost 1:\n${p1}\n\nPost 2:\n${p2}`,
            maxRetries: 2,
        });
        let polWins = 0, rawWins = 0;
        for (const ax of ["in_voice", "memorable", "would_share"] as const) {
            const v = object[ax];
            if (v === "tie") continue;
            const polishedWon = (v === "1") === polFirst;
            if (polishedWon) polWins++; else rawWins++;
        }
        // ship raw unless polish strictly wins more axes (preserve the gem on a tie)
        return polWins > rawWins ? {text: polished, kept: "polished"} : {text: rawFinal, kept: "raw"};
    } catch {
        return {text: polished, kept: "polished"};
    }
}
