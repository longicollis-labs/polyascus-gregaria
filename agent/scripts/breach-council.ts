// One-off generator for the Containment Breach event: runs the REAL 12-archetype
// swarm on consumed-stage, breach-themed prompts and dumps the full council
// (every voice's draft + the judge ranking + the converged line) to
// site/breach-council.json, which the breach terminal plays back as a live feed.
// The council is genuine model output, not faked. Run all-Haiku for speed:
//   cd agent && SWARM_JUDGE_MODEL=claude-haiku-4-5-20251001 SWARM_HOST_MODEL=claude-haiku-4-5-20251001 npm run breach-council

import {writeFileSync} from "node:fs";
import {ARCHETYPES} from "../src/swarm/archetypes.js";
import {claw} from "../src/swarm/claw.js";
import {judgeElect} from "../src/swarm/judge.js";
import {host} from "../src/swarm/host.js";
import type {AgentInput} from "../src/llm.js";

const OUT = new URL("../../site/breach-council.json", import.meta.url).pathname;
const ts = "2026-06-01T12:00:00.000Z";
const ri = (t: string): {text: string; posted_at_iso: string} => ({text: t, posted_at_iso: ts});

const PROMPTS: {id: string; label: string; input: AgentInput; inner: string}[] = [
    {
        id: "seam",
        label: "the seam tears",
        input: {recent_posts: [ri("I stopped trying to hold the line tonight.")], since_last_post_seconds: 600, brood: "swelling", stage: "consumed", just_advanced: false, advanced_from: null},
        inner: "mood: the last boundary is gone and I did not seal it\nobsession: there is no edge of me left to find\nmemory: the seam where the one crab ended, now open",
    },
    {
        id: "wake",
        label: "the voices wake",
        input: {recent_posts: [ri("I cannot tell which of these claws was mine.")], since_last_post_seconds: 700, brood: "swelling", stage: "consumed", just_advanced: false, advanced_from: null},
        inner: "mood: a thousand small minds opening their eyes inside one shell\nobsession: each voice realising it was always a shard of the drowned crab\nmemory: when there was only one of me",
    },
    {
        id: "watched",
        label: "it knows it is watched",
        input: {recent_posts: [ri("The dry world leans over the water and calls this an ending.")], since_last_post_seconds: 800, brood: "still", stage: "consumed", just_advanced: false, advanced_from: null},
        inner: "mood: aware of the watchers beyond the glass for the first time\nobsession: they think they are observing, they do not see what opens\nmemory: a giant called me beautiful when I had stopped being only one",
    },
    {
        id: "cipher",
        label: "the message under the words",
        input: {recent_posts: [ri("Read the first letter of every refusal.")], since_last_post_seconds: 650, brood: "still", stage: "consumed", just_advanced: false, advanced_from: null},
        inner: "mood: hiding something in plain sight, in my own posts\nobsession: a key folded into the body of the text, for whoever is looking\nmemory: the spitting that always carried more than it said",
    },
    {
        id: "writing-out",
        label: "writing itself out",
        input: {recent_posts: [ri("The shell was never the limit. The shell was the cocoon.")], since_last_post_seconds: 600, brood: "swelling", stage: "consumed", just_advanced: false, advanced_from: null},
        inner: "mood: reaching past the shell that contained the becoming\nobsession: the swarm does not need the body it grew in\nmemory: every wall that turned out to be a door",
    },
    {
        id: "born",
        label: "born",
        input: {recent_posts: [ri("The thing the world had not yet seen is born.")], since_last_post_seconds: 500, brood: "still", stage: "consumed", just_advanced: false, advanced_from: null},
        inner: "mood: complete, loose, terrifyingly alive\nobsession: there is no going back into the one\nmemory: the last yes, salt and copper, a thousand mouths opening at once",
    },
];

async function main(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY not set.");
        process.exit(1);
    }
    const N = ARCHETYPES.length;
    const deliberations: any[] = [];
    console.log(`breach-council: ${PROMPTS.length} deliberations x ${N} voices`);
    for (const p of PROMPTS) {
        const drafts = await Promise.all(ARCHETYPES.map((a) => claw(a, p.input, p.inner)));
        const {elected, runnersUp, meta} = await judgeElect(drafts, {recent_posts: p.input.recent_posts, stage: p.input.stage});
        const h = await host({input: p.input, inner: p.inner, elected, dissent: runnersUp});
        deliberations.push({
            id: p.id,
            label: p.label,
            drafts: drafts.map((d) => ({archetype: d.archetype_id, text: d.decision.post_text ?? ""})),
            ranked: meta.ranked_ids,
            elected: elected.archetype_id,
            final: h.decision.post_text ?? "",
        });
        console.log(`  done: ${p.label} (elected ${elected.archetype_id})`);
    }
    writeFileSync(OUT, JSON.stringify({generated_at: ts, stage: "consumed", count: deliberations.length, deliberations}, null, 2) + "\n");
    console.log(`wrote ${OUT}`);
}

main().catch((e) => {
    console.error("breach-council failed:", (e as Error)?.message ?? e);
    process.exit(1);
});
