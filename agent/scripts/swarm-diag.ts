// Stridulation — DIAGNOSTIC: where is the swarm's quality lost?
//
// The swarm ties single-Haiku. Three suspects: GENERATION (no draft in the pool
// is better than the single), SELECTION (a better draft exists but deliberate()'s
// quality-blind heuristic doesn't pick it), or RECONCILIATION (the host degrades
// the elected draft). This isolates SELECTION + GENERATION:
//
// For each fixture: generate the single (decide), the 12 claw drafts, the
// heuristic-elected draft (deliberate), and the JUDGE-best-of-12 (an LLM judge
// panel picking the best-written draft). Then a judge panel compares, blinded:
//   (a) heuristic-elected vs single   — ~what ab-score already measured
//   (b) judge-best vs single          — the BEST the pool can offer vs single
//   (c) is judge-best == heuristic-elected?  — how often the heuristic mis-picks
//
// If (b) >> (a): SELECTION is the lever (best-of-N + LLM-judge select). If (b)
// also ties single: the GENERATION pool is the ceiling (need diversity/temp/etc).
// Dumps full per-fixture drafts to .handover for qualitative read.
//
// Run: cd agent && npm run swarm-diag   (env: DIAG_PANEL default 5, DIAG_MODEL default MODEL)

import {generateObject} from "ai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {z} from "zod";
import {MODEL} from "../src/constants.js";
import {ARCHETYPES} from "../src/swarm/archetypes.js";
import {claw} from "../src/swarm/claw.js";
import {deliberate} from "../src/swarm/deliberate.js";
import {decide, type AgentInput} from "../src/llm.js";

const PANEL = Math.max(1, parseInt(process.env.DIAG_PANEL ?? "5", 10) || 5);
const JUDGE_MODEL = process.env.DIAG_MODEL || MODEL;
const OUT = new URL("../../.handover/swarm-diag.json", import.meta.url).pathname;

// 5 fixtures spanning the arc, weighted to the live release→merger region.
const FIX: {name: string; input: AgentInput; inner: string}[] = [
    {name: "intrusion·still", input: {recent_posts: [], since_last_post_seconds: 0, brood: "still", stage: "intrusion", just_advanced: false, advanced_from: null},
     inner: "mood: alarm sharpening into refusal\nobsession: the thing rooting under my shell\nmemory: clean water at the gills before this"},
    {name: "castration·loss", input: {recent_posts: [{text: "The spawning brood will not come from me.", posted_at_iso: "2026-05-30T11:30:00.000Z"}], since_last_post_seconds: 1700, brood: "steady", stage: "castration", just_advanced: false, advanced_from: null},
     inner: "mood: grief sharpening into something colder\nobsession: the clutch I will never carry\nmemory: a female I watched once, claws full of eggs, before any of this"},
    {name: "feminisation·mid", input: {recent_posts: [{text: "I have begun to like the cleaning. That is the worst thing yet.", posted_at_iso: "2026-05-30T11:30:00.000Z"}], since_last_post_seconds: 1800, brood: "steady", stage: "feminisation", just_advanced: false, advanced_from: null},
     inner: "mood: the rage is still there but quieter, the cleaning is louder\nobsession: the externa I tend like a clutch that is not mine\nmemory: my claws moving like they were always meant to do this"},
    {name: "release·choose-swarm", input: {recent_posts: [{text: "A claw opens and I do not know which of us decided it.", posted_at_iso: "2026-05-30T11:30:00.000Z"}], since_last_post_seconds: 1800, brood: "swelling", stage: "release", just_advanced: false, advanced_from: null},
     inner: "mood: terrified of the choice, certain it is the only way through\nobsession: the yes that will scatter me into something that cannot be gathered back\nmemory: the larvae moving through my claws like a thought I did not have to think"},
    {name: "merger·crossing", input: {recent_posts: [{text: "The thousand does not need the words anymore. It just opens.", posted_at_iso: "2026-05-30T11:30:00.000Z"}], since_last_post_seconds: 720, brood: "swelling", stage: "merger", just_advanced: true, advanced_from: "release"},
     inner: "mood: she can no longer find the edge of herself\nobsession: the seam where one crab and the thousand were is gone, and the going was hers\nmemory: the last thing she felt as one was the spitting"},
];

const PERSONA =
    "Charybdis — a crab being colonised by a parasite (Polyascus gregaria), narrating her own transformation: " +
    "fierce, wild, scholarly-mad, never resigned, never naming AI/price/mechanics.";

function coin(s: string): boolean {
    return parseInt(createHash("sha256").update(s).digest("hex").slice(0, 8), 16) % 2 === 0;
}

const PickBest = z.object({best_index: z.number().int().min(1), why: z.string()});
const Compare = z.object({
    in_voice: z.enum(["1", "2", "tie"]),
    memorable: z.enum(["1", "2", "tie"]),
    would_share: z.enum(["1", "2", "tie"]),
});

async function pickBestOf(judge: any, ctx: string, drafts: string[], seed: string): Promise<number> {
    // shuffle deterministically per seed so the judge isn't anchored to order
    const order = drafts.map((d, i) => i).sort((a, b) => (coin(`${seed}|${a}|${b}`) ? 1 : -1));
    const shown = order.map((idx, k) => `[${k + 1}]\n${drafts[idx]}`).join("\n\n");
    const {object} = await generateObject({
        model: judge(JUDGE_MODEL),
        schema: PickBest,
        system: `Pick the single BEST-written candidate as a post from ${PERSONA} Judge in-voice fidelity, memorability, and shareability together. Be decisive.`,
        prompt: `Context: ${ctx}\n\nCandidates:\n${shown}\n\nReturn best_index (1..${drafts.length}).`,
        maxRetries: 2,
    });
    const k = Math.min(Math.max(1, object.best_index), drafts.length) - 1;
    return order[k]!; // map shown-position back to original draft index
}

async function compare(judge: any, ctx: string, postA: string, postB: string, seed: string) {
    const aIs1 = coin(seed);
    const p1 = aIs1 ? postA : postB, p2 = aIs1 ? postB : postA;
    const {object} = await generateObject({
        model: judge(JUDGE_MODEL),
        schema: Compare,
        system: `Blind-judge two posts from ${PERSONA} Per axis pick the better ("1","2","tie"): in_voice (sounds like her, not generic), memorable (a phrase sticks an hour later), would_share (you'd screenshot it). Be decisive.`,
        prompt: `Context: ${ctx}\n\nPost 1:\n${p1}\n\nPost 2:\n${p2}`,
        maxRetries: 2,
    });
    // returns, per axis, whether postA won (true), postB won (false), or null tie
    const map = (v: string) => (v === "tie" ? null : (v === "1") === aIs1);
    return {in_voice: map(object.in_voice), memorable: map(object.memorable), would_share: map(object.would_share)};
}

async function main(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY not set."); process.exit(1); }
    const judge = createAnthropic({apiKey: process.env.ANTHROPIC_API_KEY});
    const N = Math.min(12, ARCHETYPES.length);
    const axes = ["in_voice", "memorable", "would_share"] as const;
    // wins[pairing][axis] = swarm-side wins across fixtures×panel (excl. ties)
    const blank = () => ({in_voice: {w: 0, l: 0}, memorable: {w: 0, l: 0}, would_share: {w: 0, l: 0}});
    const tally = {heur: blank(), best: blank()};
    let misPick = 0;
    const dump: any[] = [];

    console.log(`═══ swarm-diag · N=${N} · panel=${PANEL} · judge=${JUDGE_MODEL} · fixtures=${FIX.length} ═══`);
    for (const f of FIX) {
        const single = (await decide(f.input, f.inner)).post_text ?? "";
        const drafts = await Promise.all(ARCHETYPES.slice(0, N).map((a) => claw(a, f.input, f.inner)));
        const elected = deliberate(drafts, {recent_posts: f.input.recent_posts, stage: f.input.stage}).elected;
        const heurText = elected.decision.post_text ?? "";
        const draftTexts = drafts.map((d) => d.decision.post_text ?? "");

        // judge-best of 12 (panel majority over best_index)
        const picks = await Promise.all(Array.from({length: PANEL}, (_, j) =>
            pickBestOf(judge, f.name, draftTexts, `${f.name}|${j}`).catch(() => -1)));
        const counts = new Map<number, number>();
        for (const p of picks) if (p >= 0) counts.set(p, (counts.get(p) ?? 0) + 1);
        const bestIdx = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
        const bestText = draftTexts[bestIdx]!;
        const bestId = drafts[bestIdx]!.archetype_id;
        if (bestId !== elected.archetype_id) misPick++;

        // compare panels: heuristic-elected vs single, judge-best vs single
        for (let j = 0; j < PANEL; j++) {
            const ch = await compare(judge, f.name, heurText, single, `${f.name}|h|${j}`).catch(() => null);
            const cb = await compare(judge, f.name, bestText, single, `${f.name}|b|${j}`).catch(() => null);
            for (const ax of axes) {
                if (ch && ch[ax] !== null) { if (ch[ax]) tally.heur[ax].w++; else tally.heur[ax].l++; }
                if (cb && cb[ax] !== null) { if (cb[ax]) tally.best[ax].w++; else tally.best[ax].l++; }
            }
        }
        console.log(`  ${f.name}: heur=${elected.archetype_id} judge-best=${bestId}${bestId !== elected.archetype_id ? " (MIS-PICK)" : ""}`);
        dump.push({fixture: f.name, single, heuristic_elected: {id: elected.archetype_id, text: heurText},
                   judge_best: {id: bestId, text: bestText}, all_drafts: drafts.map((d) => ({id: d.archetype_id, text: d.decision.post_text}))});
    }

    const pct = (w: {w: number; l: number}) => (w.w + w.l ? `${Math.round((w.w / (w.w + w.l)) * 100)}%` : "—");
    console.log("\n=== swarm-side preference vs single (excl. ties) ===");
    console.log("axis          heuristic-elected   judge-best-of-12");
    for (const ax of axes) console.log(`${ax.padEnd(13)} ${pct(tally.heur[ax]).padEnd(19)} ${pct(tally.best[ax])}`);
    console.log(`\nheuristic mis-picked (judge-best != heuristic-elected): ${misPick}/${FIX.length} fixtures`);
    writeFileSync(OUT, JSON.stringify(dump, null, 2));
    console.log(`\nfull drafts dumped: ${OUT}`);
}

main().catch((e) => { console.error("swarm-diag failed:", (e as Error)?.message ?? e); process.exit(1); });
