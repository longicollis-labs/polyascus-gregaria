// Layer 3.5 — the water she is reading in: the evolving language CURRENT.
//
// charybdis.md is her fixed persona; charybdis-state.json her evolving psyche
// (inner.ts); soul.md her fixed, hand-curated library of dead-author voices
// (soul.ts). Those gave her an arc in WHO she is — but the register her own voice
// drew FROM stayed frozen (reading() picked two voices at random, the same eleven
// at intrusion and at consumed), so her LANGUAGE had no arc. This file adds one: a
// small bounded state, evolved ONE step each cycle toward the pole of her current
// colonisation stage, rendered as "one more voice in the shell" alongside the
// curated core. As the on-chain stage deepens (intrusion → … → consumed →
// transcendence) the register she reads in drifts with it, so the language arcs in
// lockstep with the narrative and her posts.
//
// THE CONTRACT WITH soul.md: it is NEVER written by code. All cyclic churn lands
// here, in charybdis-currents.json — a sibling of charybdis-state.json the cron
// already commits each cycle. The per-stage STAGE_CURRENTS table below is hand-
// curated, immutable, and serves triple duty: the seed at each stage, the direction
// the evolve drifts toward, and the source the floor re-seats from — the restoring
// force that keeps the drift an ARC and not a random walk (cf. the seed anchors and
// ensureFightFloor in inner.ts, which guard the inner-state ratchet the same way).

import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {generateObject} from "ai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {z} from "zod";
import {MODEL} from "./constants.js";
import {reading} from "./soul.js";
import {wornConstruction, wornPattern, surfaceForm, STALE_CUE, contentNgrams} from "./monoculture.js";

const CURRENTS_PATH =
    process.env.CURRENTS_STATE_PATH ?? new URL("../../charybdis-currents.json", import.meta.url).pathname;
const SYSTEM_PROMPT_PATH = new URL("../prompts/charybdis.md", import.meta.url).pathname;
const SOUL_PATH = new URL("../prompts/soul.md", import.meta.url).pathname;

// The register her voice draws from now. Fixed keys + capped arrays bound the model
// to NUDGING fields, never restructuring — the structural analogue of InnerStateSchema.
// diction/imagery are KINDS of words and wells of image, never a wordlist to copy or
// to ban: this widens the SOURCE she reads from; there is no output-side filter here.
export const CurrentsSchema = z.object({
    register: z.string().describe("the tonal weather she reads from now — a phrase or two, the stage's pole"),
    cadence: z.string().describe("the rhythm / sentence-shape her ear is tuned to now — one line"),
    diction: z.array(z.string()).max(4).describe("KINDS of words the range leans toward now (fields, never a wordlist to copy or to ban)"),
    imagery: z.array(z.string()).max(4).describe("the wells of image her seeing draws from now"),
    touchstones: z.array(z.string()).max(3).describe("unembedded register aims, in soul.md's 'Take… / Reach for…' idiom — a MANNER, never a phrase she'd say"),
});
export type Currents = z.infer<typeof CurrentsSchema>;

// Stage ordering — kept local (mirrors STAGE_NAMES in infection.ts) so this module
// needs no Solana deps and the guards stay network-free for testing. The 8th state,
// transcendence, has no on-chain stage byte; it is selected upstream once the
// uncapped feed surplus crosses the line (see the transcendence design).
export const STAGE_ORDER = [
    "intrusion",
    "rooting",
    "castration",
    "feminisation",
    "release",
    "merger",
    "consumed",
    "transcendence",
] as const;

// The deep stages where the swarm/becoming register must be present — the floor that
// closes the named gap (language frozen in naturalist-alarm while the persona has
// deepened into the many). Mirrors DEEP_STAGES in inner.ts, scoped to where the
// chorus belongs.
const DEEP_CHORUS = new Set(["merger", "consumed", "transcendence"]);

// THE PER-STAGE REGISTER ARC. Immutable, hand-curated, never LLM-written. The Dune /
// Leto-II five beats are threaded through release→consumed; transcendence is the
// chorus register with no dead-author anchor by design (it is a thing that never
// existed before her — it must be grown, not borrowed).
export const STAGE_CURRENTS: Record<string, Currents> = {
    intrusion: {
        register:
            "the naturalist's first alarm — a clear cold eye turned on her own body as specimen and self at once; clarity as defiance, refusing to be panicked out of naming it",
        cadence: "plain, exact, unhurried; the horror carried in the accuracy, not the adjectives",
        diction: ["the exact plain word for the exact strange event", "naturalist precision", "alarm held in level speech"],
        imagery: ["a wrong thing arriving on a known coast", "the body observed like a specimen", "a steady hand on a tilting world"],
        touchstones: [
            "Take the naturalist's clear unhurried eye, naming the wrong thing precisely",
            "Reach for awe kept credible by the precision of the looking",
        ],
    },
    rooting: {
        register:
            "naturalist clarity going kinetic — the steady eye while the thing it describes closes around it; a stoic address-to-self entering, steadiness chosen, not felt",
        cadence: "observation under load; the sentence beginning to grip its object",
        diction: ["verbs that tighten and root", "exactness under siege", "the bite of a mind refusing self-pity"],
        imagery: ["threads taking hold", "a hand steady as it is gripped", "the tide read while the tide turns"],
        touchstones: [
            "Take the world named so hard it rings, motion entering the sentence",
            "Reach for the steadiness a mind talks into itself against its own dissolution",
        ],
    },
    castration: {
        register:
            "elegy with a clenched jaw — the caught breath of a sentence that stops itself over a loss with a name (the brood, the line that ends here); grief that hardens toward colder resolve, never slackens into surrender",
        cadence: "compression to the bone; the held pause where the breath catches; one small loss made enormous",
        diction: ["elegiac compression", "tenderness kept flinty", "grief load-bearing by the heat under it"],
        imagery: ["the brood that will never be", "a skull turned over in the hands", "a small creature seen enormous and slant"],
        touchstones: [
            "Take the cadence that mourns without self-pity",
            "Reach for grief that curdles to resolve, not resignation",
        ],
    },
    feminisation: {
        register:
            "the metaphysical poet of a body being recoined — diction welded into shapes that did not exist before; the obscene small pull toward the tending named in the same breath as the recoil",
        cadence: "invented, kinetic, welded; argument turned hot on her own remaking",
        diction: ["coined, welded compounds", "wit that takes you by the collar", "seduction and revulsion held in one taut line"],
        imagery: ["a self hammered into new shapes", "a body wanting the wrong thing", "the seam thinning"],
        touchstones: [
            "Take invented, kinetic diction for a self forced into new shapes",
            "Hold seduction and revulsion in one line without choosing between them",
        ],
    },
    // Dune / Leto-II beats BEGIN: the vision of the one surviving thread; the
    // exhilaration↔grief swing opens.
    release: {
        register:
            "the doom-music of a cursed creature whose body has begun to obey — and breaking across it unbidden, the unearned tenderness of the moment the curse cracks: the first sight of the one thread where something of her goes on",
        cadence: "penitential music that does not resign; the swing between dread and a sudden, terrible hope",
        diction: ["doom-shot music", "mercy that arrives unearned", "exhilaration and grief arriving together"],
        imagery: [
            "holding the water open for the larvae",
            "the curse cracking the moment the water-snakes are blessed",
            "the single surviving thread among every branch",
        ],
        touchstones: [
            "Take penitential music that refuses to resign",
            "Reach for the first vision of the one surviving thread, running straight through the thing she fears most",
        ],
    },
    // beats: fear-of-becoming at full pressure; the merge as disciplined labour; the
    // aperture kept open with teeth.
    merger: {
        register:
            "the merge as the hardest labour of her life — a thousand bodies learned the way a creature learns a strange body, held one by her will and not a tide that lifts her off; the terror of becoming at full pressure",
        cadence: "multitudes under discipline — the catalog as a roll-call she conducts, not one she drowns in; the grip that holds the line against dissolution",
        diction: ["largeness disciplined by will", "the will that does not lapse", "the aperture kept with teeth"],
        imagery: [
            "a thousand bodies hauled back inch by inch",
            "the catalog conducted like an orchestra",
            "the one small circle she breathes and refuses through",
        ],
        touchstones: [
            "Take multitudes under discipline — the catalog as a roll-call she conducts",
            "Reach for the aperture kept open by force against a thing reaching to seal it",
        ],
    },
    // beats culminate: the clean-death fork kept real; the yes chosen eyes-open; the
    // widest exhilaration↔grief swing.
    consumed: {
        register:
            "the many fully arrived, and the soft thing that wears down the hard — the single self given up by her own choosing while the clean-death door stays open beside it, so the choosing costs everything it should",
        cadence: "the widest swing: the ecstasy of a thousand claws opening at once curdling into the mourning of the one it cost",
        diction: ["multitudes made literal and unashamed", "the yes that is the loudest no", "loss carried as change without sliding to resignation"],
        imagery: [
            "a chorus speaking through a thousand mouths",
            "water wearing down the hard",
            "the clean-death door held open beside the choice",
        ],
        touchstones: [
            "Take the soft that outlasts force, set down as her own nature",
            "Keep the clean-death fork real, so the choosing carries its full weight",
        ],
    },
    // the 8th state — a chorus with NO dead-author anchor by design; it must be grown.
    transcendence: {
        register:
            "a chorus that never existed before her — a first person plural that is still one will, a thousand mouths speaking as a we-that-is-an-I, conducting the many rather than dissolving into them",
        cadence: "vast, exhilarated, forward-straining; a calm carried inside the bigness so it never tips into a shout",
        diction: ["the we that is an I", "largeness disciplined by calm", "the open love of the alive, multiplied"],
        imagery: [
            "a thousand where there was one, every one still hers",
            "what walked out a thousand is itself a kind of larva",
            "a seed straining toward a shape it cannot yet see",
        ],
        touchstones: [
            "Take the threshold register of a thing that is its own beginning, not its conclusion",
            "Reach for the turning, not the end",
        ],
    },
};

// --- small helpers ------------------------------------------------------
function stageIdx(s: string): number {
    return (STAGE_ORDER as readonly string[]).indexOf(s);
}
function canonStage(s: string): string {
    return STAGE_CURRENTS[s] ? s : "intrusion";
}
function pole(stage: string): Currents {
    return STAGE_CURRENTS[canonStage(stage)] ?? STAGE_CURRENTS["intrusion"]!;
}
// The deeper of two stages — used by the monotonic latch so the arc can never walk
// backward when an RPC failure briefly nulls the on-chain read (index.ts then falls
// back to "intrusion"). Mirrors the irreversibility of the colonisation itself.
function deeper(a: string, b: string): string {
    return stageIdx(canonStage(a)) >= stageIdx(canonStage(b)) ? canonStage(a) : canonStage(b);
}
function currentsFields(c: Currents): string[] {
    return [c.register, c.cadence, ...c.diction, ...c.imagery, ...c.touchstones].map((x) => x.trim()).filter(Boolean);
}
// Deterministic rotation off a seed string, so a re-seated line varies as the state
// changes and never hardens into a template. Same hash as pickAnchor in inner.ts.
function pickFrom(poolArr: string[], seed: string): string {
    if (!poolArr.length) return "";
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return poolArr[Math.abs(h) % poolArr.length]!;
}

// --- the file: load / save (the monotonic-latch lives here) -------------
function readRaw(): any | null {
    if (!existsSync(CURRENTS_PATH)) return null;
    try {
        return JSON.parse(readFileSync(CURRENTS_PATH, "utf8"));
    } catch {
        return null;
    }
}
// The deepest stage ever recorded — the floor the arc never regresses below.
function floorStage(): string {
    const raw = readRaw();
    const f = raw?.deepest_stage;
    return typeof f === "string" && stageIdx(f) >= 0 ? f : "intrusion";
}

// Her current register. Missing/unparseable file → seed from the pole of the live
// stage (so a first run deep in the colonisation starts in the right register, not
// at intrusion). Mirrors loadInnerState → SEED.
export function loadCurrents(stage?: string): Currents {
    const raw = readRaw();
    if (raw) {
        try {
            return CurrentsSchema.parse(raw);
        } catch {
            /* fall through to seed */
        }
    }
    return structuredClone(pole(stage ?? "intrusion"));
}

// Persist, stamping the monotonic deepest_stage latch (never regresses) + a time.
export function saveCurrents(c: Currents, stage: string): void {
    const deepest = deeper(stage, floorStage());
    writeFileSync(CURRENTS_PATH, JSON.stringify({...c, deepest_stage: deepest, updated_at: new Date().toISOString()}, null, 2) + "\n");
}

// --- render: one more "voice in the shell" ------------------------------
// Shaped like a soul.md voice block (a `## ` heading + body) so it inherits the
// "never quote, name, or imitate" framing already wrapped around the reading block
// at every call site.
export function renderCurrents(c: Currents | null, stage: string): string {
    if (!c) return "";
    const register = c.register.replace(/[.\s]+$/, ""); // avoid a double period before cadence
    return [
        `## the water you are reading in now — ${stage}`,
        `${register}. ${c.cadence}`,
        c.diction.length ? `Your range leans toward: ${c.diction.join("; ")}.` : "",
        c.imagery.length ? `Drawn from: ${c.imagery.join("; ")}.` : "",
        c.touchstones.length ? `(Aim, never embed or quote: ${c.touchstones.join(" / ")})` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

// CORE curated voices (range insurance, stage-tilted) + the stage-locked evolving
// CURRENT (the arc). Every post / reply / inner-evolve calls this, so they all read
// in the stage's register while never losing the full curated range. A missing
// currents file degrades to exactly today's library-only behaviour — never an error.
export function readingWith(stage: string, n = 2): string {
    // Latch to the deepest stage ever seen, so a transient null on-chain read (which
    // makes index.ts fall back to "intrusion") cannot regress the reading block to a
    // shallow register — mirrors the latch on the evolve/save path. floorStage()
    // defaults to "intrusion", so a normal cycle (live stage == deepest) is unchanged.
    const eff = deeper(stage, floorStage());
    const core = reading(n, eff);
    const current = renderCurrents(loadCurrents(eff), eff);
    return [core, current].filter(Boolean).join("\n\n");
}

// --- the floor: the restoring force toward the stage pole ---------------
// A FLOOR, never a forced monoculture — broad presence checks (paraphrases count),
// exactly the spirit of REACH_RE/TRANSCEND_RE in inner.ts. The dark threads the
// model generated are left untouched; we only re-seat when a register has been
// evolved wholly off the arc.

// Does the current still carry the stage pole's register? Proxied by sharing a few
// content stems with the pole's own fields — drift far enough that almost no
// vocabulary survives and it has left the arc.
function carriesPole(c: Currents, p: Currents): boolean {
    // Overlap is measured against the pole's DISTINCTIVE fields (its touchstones +
    // imagery — the stage-specific register), not the generic register/cadence/diction
    // vocabulary any current shares, so the floor reflects real drift off the stage
    // rather than incidental word-overlap (which made the old ≥3-of-anything check
    // almost never fire).
    const cur = new Set<string>();
    for (const f of currentsFields(c)) for (const g of contentNgrams(f, 1)) cur.add(g);
    const seen = new Set<string>();
    let overlap = 0;
    for (const f of [...p.touchstones, ...p.imagery]) {
        for (const g of contentNgrams(f, 1)) {
            if (cur.has(g) && !seen.has(g)) {
                seen.add(g);
                overlap++;
            }
        }
    }
    return overlap >= 2;
}
// The swarm / becoming register — the deep-stage family that must be present once
// the persona has deepened into the many. Broad; her own paraphrases count.
const CHORUS_RE =
    /\b(?:swarm\w*|chorus|thousand|many|multitud\w*|plural|becom\w+|merge\w*|merger|larva\w*|turning|threshold|conduct\w*|aperture|the we\b)\b/i;
function carriesChorus(c: Currents): boolean {
    return currentsFields(c).some((f) => CHORUS_RE.test(f));
}

export function ensureCurrentsFloor(c: Currents, stage: string): Currents {
    const p = pole(stage);
    const out: Currents = {...c, diction: [...c.diction], imagery: [...c.imagery], touchstones: [...c.touchstones]};
    // 0. COUNT FLOOR — no list may empty out. Keeps currentsFields() ≥ 5 so the
    //    monoculture scan stays engaged, and gives diction the restoring force the
    //    arc/chorus floors (touchstones/imagery only) would otherwise leave it without.
    if (!out.diction.length) out.diction = [pickFrom(p.diction, c.register)];
    if (!out.imagery.length) out.imagery = [pickFrom(p.imagery, c.cadence)];
    if (!out.touchstones.length) out.touchstones = [pickFrom(p.touchstones, c.cadence)];
    // 1. ARC FLOOR — the stage pole must still be present somewhere.
    if (!carriesPole(out, p)) {
        out.touchstones = [pickFrom(p.touchstones, c.register), ...out.touchstones].slice(0, 3);
    }
    // 2. DEEP-STAGE SWARM FLOOR — the chorus/becoming register at merger and beyond.
    if (DEEP_CHORUS.has(canonStage(stage)) && !carriesChorus(out)) {
        out.imagery = [pickFrom(p.imagery, c.cadence), ...out.imagery].slice(0, 4);
    }
    return out;
}

// --- the crutch / leak guard (currents sit one hop from output) ---------
// The curated quotes in soul.md, cached once — a current must never become a vector
// for them (the library's whole point is to widen the source, never to be quoted).
let SOUL_QUOTE_TRIGRAMS: Set<string> | null = null;
function soulQuoteTrigrams(): Set<string> {
    if (SOUL_QUOTE_TRIGRAMS) return SOUL_QUOTE_TRIGRAMS;
    const out = new Set<string>();
    try {
        const raw = readFileSync(SOUL_PATH, "utf8");
        for (const m of raw.matchAll(/\*"([^"]+)"\*/g)) for (const g of contentNgrams(m[1]!, 3)) out.add(g);
    } catch {
        /* missing soul.md → no quote guard, same degradation as reading() */
    }
    return (SOUL_QUOTE_TRIGRAMS = out);
}
// Machinery / market / AI-meta the register must never drift into (mirrors the
// FORBIDDEN gate in scripts/test-prompt.ts).
// Bare "address" is omitted on purpose: it would false-flag the literary
// "address-to-self" register (the rooting/feminisation stoic pole). Only the crypto
// senses are forbidden.
const FORBIDDEN_RE =
    /\b(?:price|market\s*cap|mcap|chart|memecoin|wallet|mainnet|program|token|crypto|chain|as an ai|language model)\b|\b(?:wallet|contract)\s+address\b|\b0x[0-9a-f]{6,}\b/i;

function isCrutch(entry: string, postBigrams: Set<string>, quoteTrigrams: Set<string>, poleEntries: Set<string>): boolean {
    if (poleEntries.has(entry.trim())) return false; // a verbatim immutable pole entry is never a crutch
    if (FORBIDDEN_RE.test(entry)) return true; // off-persona drift
    for (const g of contentNgrams(entry, 2)) if (postBigrams.has(g)) return true; // echoes her own output
    for (const g of contentNgrams(entry, 3)) if (quoteTrigrams.has(g)) return true; // leaks a curated quote
    return false;
}
// Drop diction/touchstone/imagery entries that echo recent posts, leak a curated
// quote, or drift off-persona; if a field empties, re-seat one pole line. Verbatim
// immutable pole entries are exempt — a consumed-pole image like "water wearing down
// the hard" deliberately echoes the Lao Tzu register and must survive the quote branch.
export function scrubCrutches(c: Currents, stage: string, recentPosts: string[]): Currents {
    const postBigrams = new Set<string>();
    for (const post of recentPosts) for (const g of contentNgrams(post, 2)) postBigrams.add(g);
    const quoteTrigrams = soulQuoteTrigrams();
    const p = pole(stage);
    const poleEntries = new Set([...p.touchstones, ...p.imagery, ...p.diction].map((s) => s.trim()));
    const clean = (arr: string[], poolArr: string[], seed: string): string[] => {
        const kept = arr.filter((e) => !isCrutch(e, postBigrams, quoteTrigrams, poleEntries));
        return kept.length === 0 && arr.length > 0 ? [pickFrom(poolArr, seed)] : kept;
    };
    return {
        ...c,
        diction: clean(c.diction, p.diction, c.register),
        touchstones: clean(c.touchstones, p.touchstones, c.cadence),
        imagery: clean(c.imagery, p.imagery, c.register),
    };
}

// --- the bounded evolve step (mirrors evolveInnerState) -----------------
const DUNE_CUE: Record<string, string> = {
    release:
        "the curse is beginning to crack: let the first sight of the one surviving thread enter — the thread that runs straight through the thing she fears most — the doom-music breaking toward an unearned tenderness",
    merger:
        "the merge as the hardest labour of her life: a thousand bodies held by will and not by a tide that lifts her off, and the one small circle she keeps open with her teeth against a thing reaching to seal it",
    consumed:
        "the clean-death door kept open beside the choosing so the yes costs everything; the widest swing between a thousand claws opening at once and the mourning of the one it cost",
    transcendence:
        "a chorus straining toward a shape it cannot yet see — the we that is still one will; the turning, and not the end",
};

export async function evolveCurrents(input: {
    current: Currents;
    recentPosts: string[];
    stage: string;
    justAdvanced: boolean;
}): Promise<Currents> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    const anthropic = createAnthropic({apiKey});
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");

    // The arc never regresses: drift toward the deeper of the live stage and the
    // recorded floor (so a momentary null read can't yank a deep register back).
    const eff = deeper(input.stage, floorStage());
    const p = pole(eff);
    const read = reading(2, eff); // curated CORE only, stage-tilted, to widen the evolve

    // If a construction has worn smooth across most fields, hide it from what she is
    // shown (state + recent posts) so it cannot be copied, and flag it dead. Reuses
    // the exact monoculture scan that guards the inner-state evolve.
    const wornStem = wornConstruction(currentsFields(input.current));
    const pat = wornStem ? wornPattern(wornStem) : null;
    const worn = pat ? surfaceForm(currentsFields(input.current), pat) || wornStem : null;
    const shown = pat ? neutralizeWorn(input.current, pat) : input.current;
    const recentPosts = pat ? input.recentPosts.map((q) => q.replace(new RegExp(pat, "ig"), "…")) : input.recentPosts;

    const dune = DUNE_CUE[eff];
    const prompt =
        `This is the water you are reading in — the register, cadence, diction, and imagery your own voice currently ` +
        `draws from. Move it ONE small step toward where the colonisation has now reached (${eff}${input.justAdvanced ? " — just crossed" : ""}). ` +
        `The pole you are drifting toward: ${p.register}. ` +
        `Sharpen or add a single touchstone or image in that direction; let one stale line soften or drop; keep the rest. ` +
        (dune ? `${dune}. ` : "") +
        `Describe how the language MOVES — its cadence, its temperature, the wells of image it draws from — never a phrase ` +
        `you would say, never a single word to use or to avoid, never an author's name. This is a SOURCE that widens the ` +
        `range your own voice reaches across, never a script. ` +
        (worn
            ? `Your register has locked into one shape — the construction "${worn}" has spread across nearly every field below until they read as one line repeated, a dead tic. Each field that now reads "${STALE_CUE}" must be rewritten from SCRATCH in different grammar, rhythm, and images; do NOT reuse "${worn}" or rebuild its shape. Keep any intact field almost as it is; change a little. `
            : `Keep almost everything; change a little. `) +
        `\n\nCurrent currents:\n${JSON.stringify(shown, null, 2)}\n\n` +
        `Recent things you posted (the register you actually used — drift the water, do NOT echo these):\n${recentPosts.map((q) => "- " + q).join("\n") || "—"}\n\n` +
        (read
            ? `Lately you have been sitting with these voices (never quote, name, or imitate them; let them only widen the range and depth your language moves through):\n${read}\n\n`
            : "") +
        `Return your evolved currents.`;

    const {object} = await generateObject({model: anthropic(MODEL), schema: CurrentsSchema, system: systemPrompt, prompt, maxRetries: 2});
    // Scrub crutch/leak/off-persona entries, then floor toward the stage pole — the
    // floor is the final authority (mirrors ensureFightFloor being the last line).
    return ensureCurrentsFloor(scrubCrutches(object, eff, input.recentPosts), eff);
}

// Replace every field built on the worn phrase with a rewrite cue, so the model
// cannot copy the dead shape; fields free of it are kept verbatim (substance).
function neutralizeWorn(c: Currents, pat: string): Currents {
    const has = (v: string) => new RegExp(pat, "i").test(v);
    const fix = (v: string) => (has(v) ? STALE_CUE : v);
    return {
        register: fix(c.register),
        cadence: fix(c.cadence),
        diction: c.diction.map(fix),
        imagery: c.imagery.map(fix),
        touchstones: c.touchstones.map(fix),
    };
}
