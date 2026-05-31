// Stridulation — HARDENED gate scorer for ab-swarm runs.
//
// The single-human/single-AI A/B pass (the rating half of T-016) is noise-
// dominated: across three independent seeds the verdict swung 1/3 -> 3/3 -> 0/3.
// That is generation variance + single-rater variance on only 20 fixtures.
// This scorer attacks all three:
//   1. PANEL  — J independent judge calls per fixture (majority vote) → kills
//               per-fixture rating variance that one rater can't escape.
//   2. POOL   — ingests EVERY ab-swarm-*-key.json you point it at, so multiple
//               generation runs aggregate into one estimate (larger n).
//   3. CI     — reports a Wilson 95% interval per axis and PASSES only if the
//               LOWER bound clears 60% on >=2 axes. A lucky point estimate of
//               60% with a wide interval no longer passes.
//
// It scores the posts already stored in the key files (single.post / swarm.post),
// so it never regenerates — cheap and reproducible. Each judge sees the two posts
// in a deterministically-blinded order (hash of run|fixture|judge), never told
// which is the swarm.
//
// IMPORTANT: this is an AI-judge PROXY for cheap, reproducible iteration — NOT a
// replacement for the human taste panel the gate was designed as. A stronger judge
// model than the thing under test is advisable (set JUDGE_MODEL). Humans remain the
// final arbiter before any SWARM_ENABLED=1 flip.
//
// Run:  cd agent && npm run ab-score                          # all runs in .handover
//       cd agent && JUDGE_PANEL=7 npm run ab-score key1.json key2.json
// Env:  JUDGE_PANEL (default 5, odd), JUDGE_MODEL (default MODEL), ANTHROPIC_API_KEY.

import {generateObject} from "ai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {readFileSync, readdirSync} from "node:fs";
import {createHash} from "node:crypto";
import {z} from "zod";
import {MODEL} from "../src/constants.js";

const PANEL = Math.max(1, parseInt(process.env.JUDGE_PANEL ?? "5", 10) || 5);
const JUDGE_MODEL = process.env.JUDGE_MODEL || MODEL;
const HANDOVER = new URL("../../.handover", import.meta.url).pathname;
const AXES = ["in_voice", "memorable", "would_share"] as const;
type Axis = (typeof AXES)[number];

const Vote = z.object({
    in_voice: z.enum(["1", "2", "tie"]),
    memorable: z.enum(["1", "2", "tie"]),
    would_share: z.enum(["1", "2", "tie"]),
});

type Fixture = {name: string; single: {post: string}; swarm: {post: string}};
type Key = {seed: string; fixtures: Fixture[]};

// even/odd coin from a stable hash → reproducible per (run,fixture,judge) order.
function coin(s: string): boolean {
    return parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16) % 2 === 0;
}

// Wilson score interval (95%) for k successes of n.
function wilson(k: number, n: number, z = 1.96): [number, number] {
    if (n === 0) return [0, 0];
    const p = k / n, d = 1 + (z * z) / n;
    const c = (p + (z * z) / (2 * n)) / d;
    const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [c - h, c + h];
}

const RUBRIC =
    "You are blind-judging two short in-character posts from Charybdis — a crab being colonised by a parasite " +
    "(Polyascus gregaria), who narrates her own transformation: fierce, wild, scholarly-mad, never resigned, never " +
    "naming AI/price/mechanics. For each axis pick the better post (\"1\", \"2\", or \"tie\"):\n" +
    "- in_voice: sounds like Charybdis (claw-swarm, scholarly-mad, fierce) and NOT generic LLM prose.\n" +
    "- memorable: you'd remember a phrase from it an hour later.\n" +
    "- would_share: you'd screenshot or quote it.\n" +
    "Judge only the writing. Be decisive; reserve \"tie\" for genuine ties.";

async function judgeOne(judge: (m: string) => any, ctx: string, p1: string, p2: string): Promise<z.infer<typeof Vote>> {
    const {object} = await generateObject({
        model: judge(JUDGE_MODEL),
        schema: Vote,
        system: RUBRIC,
        prompt: `Context: ${ctx}\n\nPost 1:\n${p1}\n\nPost 2:\n${p2}`,
        maxRetries: 2,
    });
    return object;
}

async function main(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY not set.");
        process.exit(1);
    }
    const judge = createAnthropic({apiKey: process.env.ANTHROPIC_API_KEY});

    const args = process.argv.slice(2);
    const keyFiles = args.length
        ? args
        : readdirSync(HANDOVER)
              .filter((f) => /^ab-swarm-.*-key\.json$/.test(f))
              .map((f) => `${HANDOVER}/${f}`)
              .sort();
    if (!keyFiles.length) {
        console.error("no ab-swarm-*-key.json found in .handover (or pass paths as args)");
        process.exit(1);
    }

    console.log(`═══ ab-score · panel=${PANEL} · judge=${JUDGE_MODEL} · runs=${keyFiles.length} ═══`);

    // pooled fixture-verdict counts across every run, and per-run point estimates.
    const pooled: Record<Axis, {swarm: number; single: number; tie: number}> = {
        in_voice: {swarm: 0, single: 0, tie: 0},
        memorable: {swarm: 0, single: 0, tie: 0},
        would_share: {swarm: 0, single: 0, tie: 0},
    };
    const perRun: {seed: string; pref: Record<Axis, string>}[] = [];

    for (const kf of keyFiles) {
        const key: Key = JSON.parse(readFileSync(kf, "utf8"));
        const runId = kf.split("/").pop()!;
        const runCount: Record<Axis, {swarm: number; single: number; tie: number}> = {
            in_voice: {swarm: 0, single: 0, tie: 0},
            memorable: {swarm: 0, single: 0, tie: 0},
            would_share: {swarm: 0, single: 0, tie: 0},
        };

        for (let i = 0; i < key.fixtures.length; i++) {
            const fx = key.fixtures[i]!;
            // J judges in parallel; each gets a deterministically-blinded order.
            const votes = await Promise.all(
                Array.from({length: PANEL}, (_, j) => {
                    const swarmIsP1 = coin(`${runId}|${i}|${j}`);
                    const p1 = swarmIsP1 ? fx.swarm.post : fx.single.post;
                    const p2 = swarmIsP1 ? fx.single.post : fx.swarm.post;
                    return judgeOne(judge, fx.name, p1, p2).then((v) => ({v, swarmIsP1})).catch(() => null);
                }),
            );
            // majority across the panel, per axis → one fixture verdict.
            for (const ax of AXES) {
                let s = 0, h = 0;
                for (const r of votes) {
                    if (!r) continue;
                    const pick = r.v[ax];
                    if (pick === "tie") continue;
                    const pickedSwarm = (pick === "1") === r.swarmIsP1;
                    if (pickedSwarm) s++; else h++;
                }
                const verdict = s > h ? "swarm" : h > s ? "single" : "tie";
                runCount[ax][verdict]++;
                pooled[ax][verdict]++;
            }
        }
        const pref: Record<Axis, string> = {} as any;
        for (const ax of AXES) {
            const {swarm, single} = runCount[ax];
            pref[ax] = swarm + single ? `${Math.round((swarm / (swarm + single)) * 100)}%` : "—";
        }
        perRun.push({seed: key.seed, pref});
        console.log(`  ${runId}: in-voice ${pref.in_voice} · memorable ${pref.memorable} · would-share ${pref.would_share}`);
    }

    console.log("\n=== POOLED (fixture verdicts across all runs; Wilson 95% CI; PASS iff CI-low ≥ 60%) ===");
    let passes = 0;
    for (const ax of AXES) {
        const {swarm, single, tie} = pooled[ax];
        const n = swarm + single;
        const [lo, hi] = wilson(swarm, n);
        const ok = lo >= 0.6;
        passes += ok ? 1 : 0;
        console.log(
            `${ax.padEnd(12)}: swarm ${swarm}/${n} = ${((swarm / n) * 100).toFixed(1)}%  ` +
                `CI [${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}]  (ties ${tie})  ${ok ? "PASS" : "fail"}`,
        );
    }
    console.log(`\nAxes with CI-low ≥ 60%: ${passes}/3 → ${passes >= 2 ? "ROBUST PASS" : "NOT a robust pass"}`);
    console.log(
        "\nNote: AI-judge proxy (judge=" + JUDGE_MODEL + "), not the human panel — use for cheap iteration; humans decide the live flip.",
    );
}

main().catch((e) => {
    console.error("ab-score failed:", (e as Error)?.message ?? e);
    process.exit(1);
});
