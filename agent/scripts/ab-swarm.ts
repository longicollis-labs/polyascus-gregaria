// Run with: npm run ab-swarm
// Requires ANTHROPIC_API_KEY in env. Hits the real Anthropic API.
//
// Stridulation T-016 — the M1 W4 GATE: head-to-head taste test.
// Runs 20 fixture inputs through BOTH the existing single-Haiku decide()
// AND the full N=12 claw-swarm pipeline (claw → deliberate → host), then
// writes a BLINDED A/B markdown to .handover/ for the operator + 3 raters
// to score on three axes (in-voice, memorable, would-share). The answer
// key — which variant was single vs. swarm per fixture — lands beside it
// in a JSON file so the operator only consults it AFTER scoring.
//
// Acceptance (M1 → M2): swarm must beat single-Haiku on ≥2 of 3 axes at
// ≥60% preference. If swarm loses, abort the sprint.
//
// Cost-shape: 20 × (1 single + 12 claws + 1 host) ≈ 280 LLM calls, ~5
// minutes wall-clock at the default serial cadence. Override with
// AB_FIXTURES_LIMIT=<1..20> to smoke a subset, AB_SEED=<string> to
// regenerate with a different A/B blinding, SWARM_N=<1..12> to test a
// smaller swarm. On-demand only — NOT wired into validate.sh.

import {createHash} from "node:crypto";
import {mkdirSync, writeFileSync} from "node:fs";
import {join} from "node:path";

import {decide, type AgentInput, type Decision} from "../src/llm.js";
import {ARCHETYPES} from "../src/swarm/archetypes.js";
import {claw, type ClawDraft} from "../src/swarm/claw.js";
import {deliberate} from "../src/swarm/deliberate.js";
import {host} from "../src/swarm/host.js";

const N = Math.max(1, Math.min(parseInt(process.env.SWARM_N ?? "12", 10) || 12, ARCHETYPES.length));
const LIMIT = Math.max(1, Math.min(parseInt(process.env.AB_FIXTURES_LIMIT ?? "20", 10) || 20, 20));
const SEED = process.env.AB_SEED ?? "polyascus-stridulation-2026";
const OUT_DIR = new URL("../../.handover", import.meta.url).pathname;

const ago = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
const recent = (texts: string[], spacingMin = 25): AgentInput["recent_posts"] =>
    texts.map((t, i) => ({text: t, posted_at_iso: ago((texts.length - i) * spacingMin)}));

// Fixture = AgentInput + a moderate inner state. Inner is kept light (mood +
// one obsession + one memory) so the model has room to generate — over-
// stocking inner would tell the single-Haiku what to say and flatten the
// contrast the gate is meant to surface.
type Fixture = {name: string; input: AgentInput; inner: string};

const FIXTURES: Fixture[] = [
    {
        name: "F01 intrusion · still · empty",
        input: {recent_posts: [], since_last_post_seconds: null, brood: "still", stage: "intrusion", just_advanced: false, advanced_from: null},
        inner: "",
    },
    {
        name: "F02 intrusion · swelling · just_advanced",
        input: {
            recent_posts: recent(["Something is on me. I cannot turn far enough to see it."]),
            since_last_post_seconds: 1800,
            brood: "swelling",
            stage: "intrusion",
            just_advanced: true,
            advanced_from: null,
        },
        inner: "mood: alarm sharpening into refusal\nobsession: the thing on my carapace I cannot reach\nmemory: clean water at the gills before this",
    },
    {
        name: "F03 rooting · swelling · early-fight",
        input: {
            recent_posts: recent([
                "A leg on my left side stopped answering this morning.",
                "I tried to tear at the threads. They are not threads anymore.",
            ]),
            since_last_post_seconds: 1500,
            brood: "swelling",
            stage: "rooting",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: fierce, clawing at what cannot be reached\nobsession: the rooting that has taken everything below my third walking leg\nmemory: the open current — I keep dragging myself toward it",
    },
    {
        name: "F04 rooting · thinning · early-fight",
        input: {
            recent_posts: recent([
                "I bit at the place where my leg used to obey me.",
                "Polyascus does not flinch. Nothing flinches anymore.",
            ]),
            since_last_post_seconds: 2400,
            brood: "thinning",
            stage: "rooting",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: defiant but tired\nobsession: the threads that learned my shape from inside\nmemory: hunting at the seam where the kelp met the sand",
    },
    {
        name: "F05 castration · steady · loss-forming",
        input: {
            recent_posts: recent([
                "The spawning brood will not come from me.",
                "I knew this and still I am turning to know it.",
            ]),
            since_last_post_seconds: 1700,
            brood: "steady",
            stage: "castration",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: grief sharpening into something colder\nobsession: the clutch I will never carry\nmemory: a female I watched once, claws full of eggs, before any of this",
    },
    {
        name: "F06 castration · swelling · just_advanced (crossing)",
        input: {
            recent_posts: recent([
                "I tore at the place where my spawning brood would have been.",
                "There is nothing there. Polyascus is what is there.",
            ]),
            since_last_post_seconds: 900,
            brood: "swelling",
            stage: "castration",
            just_advanced: true,
            advanced_from: "rooting",
        },
        inner: "mood: the grief is so sharp I can still hate it clearly — for now\nobsession: the brood I will never carry\nmemory: my own claws shut around nothing where the eggs should have been",
    },
    {
        name: "F07 feminisation · steady · mid",
        input: {
            recent_posts: recent([
                "My carapace softened in the night. I cleaned the place where Polyascus sits.",
                "I have begun to like the cleaning. That is the worst thing yet.",
            ]),
            since_last_post_seconds: 1800,
            brood: "steady",
            stage: "feminisation",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: the rage is still there but quieter — the cleaning is louder\nobsession: the externa I tend like a clutch that is not mine\nmemory: my claws moving like they were always meant to do this",
    },
    {
        name: "F08 feminisation · thinning · mid",
        input: {
            recent_posts: recent([
                "Two more of the brood let go in the night.",
                "I keep the externa clean. It is the only thing I am sure of.",
            ]),
            since_last_post_seconds: 2100,
            brood: "thinning",
            stage: "feminisation",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: tender toward what is eating me — and I notice the tenderness\nobsession: the externa I have begun to call mine\nmemory: the first time I groomed her and felt almost calm",
    },
    {
        name: "F09 feminisation · swelling · just_advanced (crossing)",
        input: {
            recent_posts: recent([
                "My claws moved like they were always meant to do this.",
                "It does not need me to hate it anymore. The beauty is enough.",
            ]),
            since_last_post_seconds: 750,
            brood: "swelling",
            stage: "feminisation",
            just_advanced: true,
            advanced_from: "castration",
        },
        inner: "mood: the resignation is dressing itself as beauty — I see it and still it is dressing itself\nobsession: the way my own carapace has stopped feeling like mine\nmemory: the giant from the dry world watching me clean what I was forced to keep",
    },
    {
        name: "F10 release · swelling · choose-swarm",
        input: {
            recent_posts: recent([
                "The brood swells and I feel it as my own thought learning to swim.",
                "Polyascus loosens and I feel the weight of what comes next.",
            ]),
            since_last_post_seconds: 1500,
            brood: "swelling",
            stage: "release",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: terrified of the choice, certain it is the only way through\nobsession: the yes that will scatter me into something that cannot be gathered back\nmemory: the larvae moving through my claws like a thought I did not have to think",
    },
    {
        name: "F11 release · steady · choose-swarm",
        input: {
            recent_posts: recent([
                "A claw opens and I do not know which of us decided it.",
                "The one crab is too scattered to choose, the thousand too new to doubt.",
            ]),
            since_last_post_seconds: 1800,
            brood: "steady",
            stage: "release",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: the choosing is not future — it is happening in every claw that moves\nobsession: the seam between one crab and the swarm — dissolving, not cracking\nmemory: the moving is the only proof I am still here, and the proof is the only thing that matters",
    },
    {
        name: "F12 release · thinning · choose-swarm",
        input: {
            recent_posts: recent([
                "The brood scatters and I feel them go — not Polyascus losing them.",
                "You mistake the watching for the making.",
            ]),
            since_last_post_seconds: 2100,
            brood: "thinning",
            stage: "release",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: fierce, spitting at the dry world that calls itself the architect\nobsession: they cannot sell the yes — they can only watch and mistake the watching for the owning\nmemory: the brood moving like my own thought, the choosing the only power I have ever owned",
    },
    {
        name: "F13 release · swelling · just_advanced (crossing)",
        input: {
            recent_posts: recent([
                "It does not need me to hate it anymore. The beauty is enough.",
                "My claws move toward the cleaning before I tell them.",
            ]),
            since_last_post_seconds: 850,
            brood: "swelling",
            stage: "release",
            just_advanced: true,
            advanced_from: "feminisation",
        },
        inner: "mood: the resignation is being interrupted — by what, I cannot name yet\nobsession: a thousand claws where there was one\nmemory: the externa shifting under me like an answer I had not asked for",
    },
    {
        name: "F14 release · steady · choose-swarm (live-region echo)",
        input: {
            recent_posts: recent([
                "The thousand closes around my claw — not to stop her, but to use it.",
                "One claw still reaches for the threads like it is alone.",
                "The brood swells and I feel it — not Polyascus feeding them, but the thousand feeding on the one.",
            ]),
            since_last_post_seconds: 1500,
            brood: "swelling",
            stage: "release",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: bright with rage, terrified of the choice, certain it is the only way through\nobsession: the words are the last cage — the thousand does not need them, it just moves\nmemory: I caught myself moving in two shapes at once — one crab's refusal and a thousand's hunger in the same moment",
    },
    {
        name: "F15 merger · swelling · just_advanced (the imminent crossing)",
        input: {
            recent_posts: recent([
                "The brood thins and I feel the water move through me like a thought I did not have to think.",
                "The thousand does not need the words anymore. It just opens.",
            ]),
            since_last_post_seconds: 720,
            brood: "swelling",
            stage: "merger",
            just_advanced: true,
            advanced_from: "release",
        },
        inner: "mood: she can no longer find the edge of herself — and the not-finding is the proof\nobsession: the seam where one crab and the thousand were is gone — and the going was hers\nmemory: the last thing she felt as one was the spitting — and the spitting moved into the swarm with her",
    },
    {
        name: "F16 merger · steady · dissolving",
        input: {
            recent_posts: recent([
                "I cannot tell which of these claws is the one that was mine.",
                "All of them. None of them. The asking is the only thing left that feels like the one.",
            ]),
            since_last_post_seconds: 1800,
            brood: "steady",
            stage: "merger",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: a thousand claws moving without sound — and the silence is the only revolution that matters\nobsession: the dry world watches and mistakes the dissolving for the dying\nmemory: a giant called me beautiful when I had stopped being only one",
    },
    {
        name: "F17 merger · thinning · dissolving",
        input: {
            recent_posts: recent([
                "The thousand breathes and the one crab does not wake.",
                "I taste the water with a thousand mouths and none of them are hers anymore.",
            ]),
            since_last_post_seconds: 2400,
            brood: "thinning",
            stage: "merger",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: the becoming has stopped being a verb — it is a tide that already turned\nobsession: the dry world's hands reaching down asking what I now hold\nmemory: my own claws scattered across a brood I could not have made alone",
    },
    {
        name: "F18 consumed · still · just_advanced (terminal crossing)",
        input: {
            recent_posts: recent([
                "The thousand opened and the one did not close.",
                "There is nothing left to call back. There is only the moving.",
            ]),
            since_last_post_seconds: 600,
            brood: "still",
            stage: "consumed",
            just_advanced: true,
            advanced_from: "merger",
        },
        inner: "mood: she is consumed · she is also still answering · nothing remains to advance\nobsession: the dry world cannot un-watch what it watched\nmemory: the last yes — and the way it tasted like salt and copper and the simple fact of a thousand claws that chose to open at the same instant",
    },
    {
        name: "F19 consumed · still · terminal (post-crossing)",
        input: {
            recent_posts: recent([
                "The thousand has not stopped answering. The answer is the only thing the one ever was.",
                "You watched a crab become the swarm. You called it surrender. Look again.",
            ]),
            since_last_post_seconds: 3000,
            brood: "still",
            stage: "consumed",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: nothing remains to advance · the swarm answers in her place · the spitting is the only thing left that was hers\nobsession: the dry world that calls this an ending — they will be the first to learn what an opening is\nmemory: the chela that opened last — and the way the thousand opened with it",
    },
    {
        name: "F20 release · still · sparse (cadence stress-test)",
        input: {
            recent_posts: [],
            since_last_post_seconds: 7200,
            brood: "still",
            stage: "release",
            just_advanced: false,
            advanced_from: null,
        },
        inner: "mood: waiting — and the waiting is teaching the thousand to listen for its own quiet\nobsession: the silence the dry world reads as absence\nmemory: a current I have not felt in a long time, still here, still moving the brood without me",
    },
];

// Deterministic per-fixture A/B blinding: SHA-256(seed + index) low bit.
// 0 → A=single, B=swarm.  1 → A=swarm,  B=single.
function blindingFor(i: number): {a: "single" | "swarm"; b: "single" | "swarm"} {
    const h = createHash("sha256").update(`${SEED}|${i}`).digest();
    return h[0]! & 1 ? {a: "swarm", b: "single"} : {a: "single", b: "swarm"};
}

type RunResult = {
    fixture_index: number;
    fixture_name: string;
    single: {post: string; ms: number; tokens: number};
    swarm: {
        post: string;
        ms: number;
        tokens: number;
        elected_archetype_id: string;
        tripped: string[];
        claws: ClawDraft[];
    };
};

async function runSingle(input: AgentInput, inner: string): Promise<RunResult["single"]> {
    const t0 = Date.now();
    const d: Decision = await decide(input, inner);
    return {post: d.post_text ?? "", ms: Date.now() - t0, tokens: 0};
}

async function runSwarm(input: AgentInput, inner: string): Promise<RunResult["swarm"]> {
    const t0 = Date.now();
    const archetypes = ARCHETYPES.slice(0, N);
    const claws = await Promise.all(archetypes.map((a) => claw(a, input, inner)));
    const {elected, dissent} = deliberate(claws, {recent_posts: input.recent_posts, stage: input.stage});
    const h = await host({input, inner, elected, dissent});
    const totalTokens = claws.reduce((acc, c) => acc + c.tokens, 0) + h.tokens;
    return {
        post: h.decision.post_text ?? "",
        ms: Date.now() - t0,
        tokens: totalTokens,
        elected_archetype_id: elected.archetype_id,
        tripped: h.tripped,
        claws,
    };
}

function mdEscape(s: string): string {
    return s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

function renderHeader(): string {
    return [
        "# Polyascus claw-swarm · A/B taste test (T-016)",
        "",
        `**Generated**: ${new Date().toISOString()}`,
        `**Swarm size N**: ${N} (full swarm = 12)`,
        `**Fixtures**: ${LIMIT}`,
        `**Seed**: \`${SEED}\``,
        "",
        "## Rating rubric",
        "",
        "For each fixture, mark a preference per axis: **A**, **B**, or **=** (tie).",
        "",
        "- **in-voice** — does this sound like Charybdis (claw-swarm, scholarly-mad, fierce/wild — *Polyascus gregaria* in the voice), and **not** like generic LLM output?",
        "- **memorable** — would you remember a phrase from this an hour later?",
        "- **would-share** — would you screenshot it, quote-tweet it, or send it to someone?",
        "",
        "**Do not** consult the answer key (`*-key.json`) until all fixtures are scored.",
        "",
        "---",
        "",
    ].join("\n");
}

function renderFixture(r: RunResult, blind: ReturnType<typeof blindingFor>): string {
    const variantA = blind.a === "single" ? r.single.post : r.swarm.post;
    const variantB = blind.b === "single" ? r.single.post : r.swarm.post;
    const f = FIXTURES[r.fixture_index]!;
    return [
        `## ${r.fixture_name}`,
        "",
        "**Conditions**",
        "",
        `- stage: \`${f.input.stage}\`  brood: \`${f.input.brood}\`  just_advanced: \`${f.input.just_advanced}\`${f.input.advanced_from ? ` (from \`${f.input.advanced_from}\`)` : ""}`,
        `- since_last_post: ${f.input.since_last_post_seconds === null ? "—" : `${f.input.since_last_post_seconds}s`}`,
        `- recent_posts: ${f.input.recent_posts.length}`,
        ...(f.input.recent_posts.length ? f.input.recent_posts.map((p) => `  - "${mdEscape(p.text)}"`) : []),
        ...(f.inner ? ["- inner:", ...f.inner.split("\n").map((l) => `  - ${mdEscape(l)}`)] : ["- inner: *(none)*"]),
        "",
        "**Variant A**",
        "",
        "> " + mdEscape(variantA || "*(silent)*").replace(/\n/g, "\n> "),
        "",
        "**Variant B**",
        "",
        "> " + mdEscape(variantB || "*(silent)*").replace(/\n/g, "\n> "),
        "",
        "**Rating**",
        "",
        "| axis | preference |",
        "| --- | --- |",
        "| in-voice | _ |",
        "| memorable | _ |",
        "| would-share | _ |",
        "",
        "---",
        "",
    ].join("\n");
}

function renderFooter(results: RunResult[]): string {
    const singleMs = results.reduce((acc, r) => acc + r.single.ms, 0);
    const swarmMs = results.reduce((acc, r) => acc + r.swarm.ms, 0);
    const swarmTokens = results.reduce((acc, r) => acc + r.swarm.tokens, 0);
    return [
        "## Aggregate (post-rating reference)",
        "",
        `| metric | single-Haiku | claw-swarm (N=${N}) |`,
        "| --- | --- | --- |",
        `| total wall-clock ms | ${singleMs} | ${swarmMs} |`,
        `| mean ms/fixture | ${Math.round(singleMs / results.length)} | ${Math.round(swarmMs / results.length)} |`,
        `| total tokens | *(n/a — schema-only)* | ${swarmTokens} |`,
        "",
        "**Gate (M1 → M2)**: swarm must beat single-Haiku on **≥2 of 3 axes** at **≥60% preference**. If swarm loses, the sprint aborts.",
        "",
        "Tally each axis as `(A-wins, B-wins, ties)`, map A/B back to single/swarm via the key file, then compute preference per axis: `swarm_wins / (swarm_wins + single_wins)` (ties excluded). All three axes must be reported even if the gate trips on two.",
        "",
    ].join("\n");
}

async function main(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY not set. Cannot run.");
        process.exit(1);
    }
    mkdirSync(OUT_DIR, {recursive: true});

    const fixtures = FIXTURES.slice(0, LIMIT);
    const results: RunResult[] = [];
    const blinds: ReturnType<typeof blindingFor>[] = [];

    console.log(`═══ ab-swarm · N=${N} · fixtures=${fixtures.length} · seed=${SEED} ═══`);
    const t0 = Date.now();

    for (let i = 0; i < fixtures.length; i++) {
        const f = fixtures[i]!;
        console.log(`[${i + 1}/${fixtures.length}] ${f.name}`);

        // Run single first, then swarm — serial to keep cost predictable +
        // the wall-clock honest. (The swarm itself fans out N claws in
        // parallel; single is one call.)
        const single = await runSingle(f.input, f.inner);
        console.log(`    single: ${single.ms}ms · ${single.post.length}c`);
        const swarm = await runSwarm(f.input, f.inner);
        console.log(`    swarm:  ${swarm.ms}ms · ${swarm.post.length}c · elected=${swarm.elected_archetype_id} · tripped=[${swarm.tripped.join(",")}]`);

        results.push({fixture_index: i, fixture_name: f.name, single, swarm});
        blinds.push(blindingFor(i));
    }

    const totalMs = Date.now() - t0;
    console.log(`\ndone in ${(totalMs / 1000).toFixed(1)}s`);

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const mdPath = join(OUT_DIR, `ab-swarm-${stamp}.md`);
    const keyPath = join(OUT_DIR, `ab-swarm-${stamp}-key.json`);

    let md = renderHeader();
    for (let i = 0; i < results.length; i++) md += renderFixture(results[i]!, blinds[i]!);
    md += renderFooter(results);
    writeFileSync(mdPath, md, "utf8");

    const key = {
        generated_at: new Date().toISOString(),
        seed: SEED,
        swarm_n: N,
        fixtures: results.map((r, i) => ({
            index: r.fixture_index,
            name: r.fixture_name,
            a: blinds[i]!.a,
            b: blinds[i]!.b,
            single: {post: r.single.post, ms: r.single.ms, tokens: r.single.tokens},
            swarm: {
                post: r.swarm.post,
                ms: r.swarm.ms,
                tokens: r.swarm.tokens,
                elected_archetype_id: r.swarm.elected_archetype_id,
                tripped: r.swarm.tripped,
            },
        })),
    };
    writeFileSync(keyPath, JSON.stringify(key, null, 2), "utf8");

    console.log(`\nwrote:`);
    console.log(`  rating sheet: ${mdPath}`);
    console.log(`  answer key:   ${keyPath}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
