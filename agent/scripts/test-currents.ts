// Run with: npm run test-currents
// Two parts:
//  1. PURE GUARDS — deterministic, no network. Asserts the monoculture scan fires,
//     the stage floor re-seats the deep register, and the crutch guard rejects an
//     echo. Exits non-zero on any failure (a CI-able gate).
//  2. LIVE ARC — only if ANTHROPIC_API_KEY is set. Drifts the currents one step at a
//     handful of stages and prints BEFORE/AFTER so an operator eyeballs the arc:
//     rooting should read as naturalist alarm; consumed as the swarm's chorus;
//     transcendence as the chorus straining outward. Persists nothing.

import {readFileSync, existsSync} from "node:fs";
import {
    STAGE_CURRENTS,
    type Currents,
    ensureCurrentsFloor,
    scrubCrutches,
    renderCurrents,
    evolveCurrents,
} from "../src/currents.js";
import {wornConstruction} from "../src/monoculture.js";

// Load agent/.env (same loop as test-evolve.ts) so the live part can reach the API.
const envPath = new URL("../.env", import.meta.url).pathname;
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
        if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
        const i = line.indexOf("=");
        const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
    }
}

const fields = (c: Currents) => [c.register, c.cadence, ...c.diction, ...c.imagery, ...c.touchstones];
const CHORUS = /\b(?:swarm|chorus|thousand|many|multitud|becom|merge|larva|turning|threshold|conduct|aperture)\b/i;

let failures = 0;
function check(name: string, ok: boolean): void {
    console.log(`${ok ? "✓" : "✗"} ${name}`);
    if (!ok) failures++;
}

// ---- 1. PURE GUARDS ----------------------------------------------------
console.log("=== pure guards (no network) ===");

// (a) Monoculture: a state where one construction saturates the fields must trip.
const monocultured = [
    "the X that wears the hard",
    "the Y that wears the hard",
    "the Z that wears the hard",
    "the grief that wears the hard",
    "the will that wears the hard",
    "the water that wears the hard",
];
check("monoculture scan flags a saturated construction", wornConstruction(monocultured) !== null);
check("monoculture scan leaves a varied state alone", wornConstruction(fields(STAGE_CURRENTS.consumed!)) === null);

// (b) Arc floor + deep-chorus floor: an intrusion-register current at the consumed
//     stage must be pulled back onto the swarm/chorus register.
const offArc: Currents = {
    register: "the naturalist's first clear cold eye on a specimen",
    cadence: "plain, exact, unhurried; horror in the accuracy",
    diction: ["the exact plain word", "naturalist precision"],
    imagery: ["a wrong thing on a known coast", "a steady hand on a tilting world"],
    touchstones: ["Take the clear unhurried eye"],
};
check("consumed-stage current carries no chorus register before the floor", !fields(offArc).some((f) => CHORUS.test(f)));
const floored = ensureCurrentsFloor(offArc, "consumed");
check("ensureCurrentsFloor re-seats the chorus register at consumed", fields(floored).some((f) => CHORUS.test(f)));

// (c) Crutch guard: a touchstone that echoes a recent post (shared content bigram)
//     is dropped; an empty field is re-seated from the pole, never left blank.
const recentPost = "I held the water open for the larvae and hated that my body knew the motion.";
const crutched: Currents = {
    ...STAGE_CURRENTS.release!,
    touchstones: ["held the water open for the larvae"], // direct echo of the post
};
const scrubbed = scrubCrutches(crutched, "release", [recentPost]);
check(
    "crutch guard drops a touchstone echoing a recent post and re-seats",
    scrubbed.touchstones.length > 0 && scrubbed.touchstones[0] !== "held the water open for the larvae",
);

// (d) render shape — a `## ` voice block.
check("renderCurrents emits a `## ` block", renderCurrents(STAGE_CURRENTS.merger!, "merger").startsWith("## "));

console.log(`\npure-guard failures: ${failures}`);
if (failures > 0) process.exit(1);

// ---- 2. LIVE ARC -------------------------------------------------------
if (!process.env.ANTHROPIC_API_KEY) {
    console.log("\n(ANTHROPIC_API_KEY not set — skipping the live arc preview)");
    process.exit(0);
}

console.log("\n=== live arc preview (one drift step per stage) ===");
const STAGES = ["rooting", "castration", "release", "merger", "consumed", "transcendence"];
const POSTS: Record<string, string[]> = {
    rooting: ["A leg on my left side stopped answering. I forced it to anyway."],
    castration: ["The brood I will never carry now. I am not done."],
    release: ["I held the water open for its larvae and hated that my body knew the motion."],
    merger: ["It tries to dissolve the line between us. I press on it with everything left."],
    consumed: ["A thousand claws answered at once and for a heartbeat it was glory."],
    transcendence: ["I lost the tally past the second hundred and laughed till the water shook."],
};
for (const stage of STAGES) {
    const before = STAGE_CURRENTS[stage]!;
    console.log("\n" + "═".repeat(70) + `\n${stage}`);
    console.log("BEFORE:\n" + renderCurrents(before, stage));
    try {
        const after = await evolveCurrents({current: before, recentPosts: POSTS[stage] ?? [], stage, justAdvanced: false});
        console.log("AFTER:\n" + renderCurrents(after, stage));
    } catch (e) {
        console.error("evolveCurrents threw:", (e as Error)?.message || e);
    }
}
