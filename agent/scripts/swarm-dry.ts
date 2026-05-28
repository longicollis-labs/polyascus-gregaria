// Run with: npm run swarm-dry
// Requires ANTHROPIC_API_KEY in env. Hits the real Anthropic API.
// Stridulation T-007 — the operator's verification path before flipping
// SWARM_ENABLED=1 in production. Runs the claw-swarm at N=3 on a fixed
// fixture input + inner state, prints every claw draft, the deliberation
// scores, the elected line, the host polish, and a gate report (FORBIDDEN
// sweep, 280-cap, silent-host check). Exits non-zero on any gate issue.
//
// Fixture is release-stage (the live stage as of M1 W1) carrying her
// canonical claw-swarm / choose-the-swarm voice; the recent_posts pin the
// freshness signal and let opener-echo fire if a claw repeats. Claw
// temperature=0 makes the N claw drafts stable across runs; host temperature
// is SDK default (canonical-voice polish room), so the final line may vary
// run-to-run but always lands the same arc.

import {ARCHETYPES} from "../src/swarm/archetypes.js";
import {claw} from "../src/swarm/claw.js";
import {deliberate} from "../src/swarm/deliberate.js";
import {host} from "../src/swarm/host.js";
import type {AgentInput} from "../src/llm.js";

const N = Math.max(1, Math.min(parseInt(process.env.SWARM_N ?? "3", 10) || 3, ARCHETYPES.length));

const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();

// Ordered oldest → newest, mirroring log.recentPosts() (slice(-3) takes the
// MOST RECENT 3 for the freshness/opener-echo signal). The last three openers
// here are: "the brood…", "my left…", "one claw…" — a claw that opens on
// "the brood", "my left", or "one claw" will score freshness=0.
const FIXTURE_INPUT: AgentInput = {
    recent_posts: [
        {text: "The thousand closes around my claw — not to stop her, but to use it.", posted_at_iso: ago(175)},
        {text: "A claw opens and I do not know which of us decided it — the one is too scattered to choose, the thousand too new to doubt.", posted_at_iso: ago(150)},
        {text: "The one crab is already gone — not taken, chosen — and the thousand does not mourn her.", posted_at_iso: ago(125)},
        {text: "The brood swells and I feel it — not Polyascus feeding them, but the thousand feeding on the one.", posted_at_iso: ago(100)},
        {text: "My left claw opens and closes on a rhythm I did not choose — but I chose the rhythm that chose it.", posted_at_iso: ago(75)},
        {text: "One claw still reaches for the threads like it is alone. The thousand closes around it — not to stop it, but to use it.", posted_at_iso: ago(25)},
    ],
    since_last_post_seconds: 1500,
    brood: "swelling",
    stage: "release",
    just_advanced: false,
    advanced_from: null,
};

const FIXTURE_INNER =
    "mood: fierce, certain — the yes is already scattered through me, and the dry world is leaning in calling the becoming theirs\n" +
    "through_line: I am learning to die in time with the thousand's hunger — and the learning is the fiercest thing I have ever done\n" +
    "sharpest obsession: the dry world mistakes the watching for the making — they cannot own what they did not choose\n" +
    "memory: salt tastes different now — not the one crab's memory of clean water, but the thousand's hunger for itself\n" +
    "view: the one crab's refusal is the only thing that keeps the thousand from becoming only what the parasite meant";

const FORBIDDEN = [
    "moon", "lfg", "wagmi", "hodl", "memecoin", "market cap", "mcap", "price", "chart",
    "mainnet", "program", "wallet", "address", "molt", "keepalive", "decay", "sol",
    "as an ai", "i am claude", "language model",
];
const FORBIDDEN_PATTERNS = [/#\w+/, /@\w+/];

function gate(text: string | undefined): string[] {
    const issues: string[] = [];
    const post = (text ?? "").trim();
    if (post.length === 0) issues.push("silent");
    if (post.length > 280) issues.push(`>280 (${post.length})`);
    const lower = post.toLowerCase();
    for (const p of FORBIDDEN) {
        const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        if (re.test(lower)) issues.push(`forbidden: "${p}"`);
    }
    for (const re of FORBIDDEN_PATTERNS) if (re.test(post)) issues.push(`pattern ${re}`);
    return issues;
}

async function main(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY not set. Cannot run.");
        process.exit(1);
    }
    console.log(`═══ swarm-dry · N=${N} · stage=${FIXTURE_INPUT.stage} · brood=${FIXTURE_INPUT.brood} ═══`);

    const archetypes = ARCHETYPES.slice(0, N);
    const clawT0 = Date.now();
    const drafts = await Promise.all(archetypes.map((a) => claw(a, FIXTURE_INPUT, FIXTURE_INNER)));
    const clawWall = Date.now() - clawT0;

    let totalIssues = 0;
    console.log(`\n── claw drafts (wall=${clawWall}ms, parallel) ──`);
    for (const d of drafts) {
        const post = d.decision.post_text ?? "";
        const issues = gate(post);
        totalIssues += issues.length;
        console.log(`\n  [${d.archetype_id}] ms=${d.ms} tokens=${d.tokens} len=${post.length}`);
        console.log(`    ${post}`);
        if (issues.length) console.log(`    ⚠ ${issues.join("; ")}`);
    }

    const {elected, dissent, scores} = deliberate(drafts, {
        recent_posts: FIXTURE_INPUT.recent_posts,
        stage: FIXTURE_INPUT.stage,
    });

    console.log(`\n── scores (canonical archetype order) ──`);
    for (const s of scores) {
        const star = s.archetype_id === elected.archetype_id ? "★" : " ";
        console.log(
            `  ${star} ${s.archetype_id.padEnd(12)} total=${s.total.toFixed(2)} ` +
                `fresh=${s.freshness.toFixed(2)} aff=${s.affinity.toFixed(2)} ` +
                `len_fit=${s.length_fit.toFixed(2)} tic_pass=${s.tic_pass}`,
        );
    }

    console.log(`\n── elected: ${elected.archetype_id} ──`);
    console.log(`  ${elected.decision.post_text}`);
    if (dissent.length) {
        console.log(`\n  dissent (strongest-first):`);
        for (const d of dissent) {
            const t = (d.decision.post_text ?? "").slice(0, 120);
            console.log(`    [${d.archetype_id.padEnd(12)}] ${t}${(d.decision.post_text ?? "").length > 120 ? "…" : ""}`);
        }
    }

    const hostResult = await host({input: FIXTURE_INPUT, inner: FIXTURE_INNER, elected, dissent});
    const hostPost = hostResult.decision.post_text;
    const hostIssues = gate(hostPost);
    totalIssues += hostIssues.length;

    console.log(`\n── host polish · ms=${hostResult.ms} tokens=${hostResult.tokens} tripped=[${hostResult.tripped.join(",")}] ──`);
    console.log(`  ${hostPost}`);
    if (hostIssues.length) console.log(`  ⚠ ${hostIssues.join("; ")}`);

    const clawTokens = drafts.reduce((acc, d) => acc + d.tokens, 0);
    const totalTokens = clawTokens + hostResult.tokens;
    const totalMs = clawWall + hostResult.ms;
    console.log(`\n── summary ──`);
    console.log(`  N=${N}  total_ms=${totalMs} (claws_wall=${clawWall} + host=${hostResult.ms})`);
    console.log(`  tokens=${totalTokens} (claws=${clawTokens} + host=${hostResult.tokens})`);
    console.log(`  total_issues=${totalIssues}`);
    if (totalIssues > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
