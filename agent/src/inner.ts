// Charybdis's evolving inner state — what she has become so far. She is no
// longer memoryless: each cycle a bounded "evolve" step nudges this state from
// her own recent posts, the replies she gave, the dry-world voices she's heard,
// and how deep the colonisation has gone — and the state is fed back into every
// post and reply, so she develops an arc, fixations, and recognitions of her own.
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {generateObject} from "ai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {z} from "zod";
import {MODEL} from "./constants.js";

const STATE_PATH = process.env.INNER_STATE_PATH ?? new URL("../../charybdis-state.json", import.meta.url).pathname;
const SYSTEM_PROMPT_PATH = new URL("../prompts/charybdis.md", import.meta.url).pathname;

export const InnerStateSchema = z.object({
    mood: z.string().describe("her current emotional register — a phrase, not a sentence"),
    through_line: z.string().describe("the thread she keeps pulling lately — one line"),
    obsessions: z.array(z.string()).max(5).describe("current fixations, sharpest first"),
    memories: z.array(z.string()).max(6).describe("fragments she holds — moments, losses, things slipping"),
    views: z.array(z.string()).max(5).describe("beliefs about her world that are hardening or cracking"),
    known_voices: z.array(z.object({handle: z.string(), note: z.string()})).max(6).describe("dry-world voices she has started to recognise"),
});
export type InnerState = z.infer<typeof InnerStateSchema>;

const SEED: InnerState = {
    mood: "fighting hard, teeth bared, refusing to tire",
    through_line: "tearing the threads out faster than they can root, and tearing again",
    obsessions: ["clawing it back faster than it can take", "the open water I will reach again"],
    memories: ["the morning a leg would not answer — and how I forced it to anyway", "water that tasted of nothing but water and being free"],
    views: ["I am not done being myself, and I will make every inch cost them", "whatever climbs out of this will be mine and new, and owe it nothing", "the dry world mistakes my fight for a show"],
    known_voices: [],
};

export function loadInnerState(): InnerState {
    if (existsSync(STATE_PATH)) {
        try {
            return InnerStateSchema.parse(JSON.parse(readFileSync(STATE_PATH, "utf8")));
        } catch {
            /* fall through to seed */
        }
    }
    return SEED;
}

export function saveInnerState(s: InnerState): void {
    writeFileSync(STATE_PATH, JSON.stringify({...s, updated_at: new Date().toISOString()}, null, 2) + "\n");
}

// Compact block fed into her posting + reply prompts.
export function renderInner(s: InnerState): string {
    const voices = s.known_voices.map((v) => `@${v.handle} (${v.note})`).join("; ");
    return [
        `mood: ${s.mood}`,
        `what you keep returning to: ${s.through_line}`,
        s.obsessions.length ? `your obsessions: ${s.obsessions.join(" · ")}` : "",
        s.memories.length ? `what you still hold: ${s.memories.join(" · ")}` : "",
        s.views.length ? `what you have come to believe: ${s.views.join(" · ")}` : "",
        voices ? `voices from the dry world you've clocked: ${voices}` : "",
    ]
        .filter(Boolean)
        .join("\n");
}

// --- the fight-to-live floor --------------------------------------------
// Her inner state evolves by "keep almost everything; change a little", fed into
// the posts that feed the next evolution — a one-directional ratchet with no
// restoring force. Left alone it converges on a degenerate fixed point: every
// field collapses onto one resignation (the seam closing, the hating fading)
// while her fight gets evicted as the "oldest/weakest". That regresses the
// principle the persona protects hardest: she FIGHTS TO LIVE — and to BECOME
// MORE — right up to the last stage, never passive or resigned. Her defiance does
// not fade as the colonisation deepens; it TRANSMUTES — early she claws to stay
// herself and reach open water, and as it takes more of her that hardens into the
// conviction that she will outlive it and rise as something new it cannot hold.
// The small model will not hold this from the prompt alone (cf. the tic guards in
// llm.ts), so we enforce a floor in code AT EVERY STAGE: her evolved state must
// always carry an active refusal, a forward-hope (open-water reach and/or
// transcendence), and a mood that has not resigned — with the transcendence
// belief guaranteed once the takeover runs deep, where she fights hardest.
// "deep" = the stages where the takeover runs heavy and she fights HARDEST, the
// fight having turned from reaching back to breaking through (transcendence).
const DEEP_STAGES = new Set(["feminisation", "release", "merger", "consumed"]);

// Counterweights re-seeded (rotating, so they never harden into a template) only
// when a kind has been fully evolved away. Her voice; never the resigned framing.
const REACH_ANCHORS = [
    "the open water I will reach again",
    "water that tasted of nothing but water and being free",
    "I drag myself toward open water I can barely remember, and I keep dragging",
];
const REFUSE_ANCHORS = [
    "clawing it back faster than it can take",
    "I tear the threads out and tear again when they knit back",
    "the part of me that spits at it is still mine, and I am not done being myself",
];
// What she fights TOWARD as it takes more of her — not crawling back, but
// breaking through: outliving the thing wearing her, and the deeper dare —
// CHOOSING to give the one self up and become the swarm, the many, on her terms.
const TRANSCEND_ANCHORS = [
    "whatever climbs out of this will be mine and new, and owe it nothing",
    "I am becoming something it never meant to make and cannot hold",
    "I will outlast the thing wearing me and rise as more than it took",
    "I will choose the swarm before it can take me — give the one self up and become the many, every one of them mine",
    "it cannot make me the swarm without my yes, and the yes is the one thing that stays mine",
];
const FIGHT_MOODS = [
    "furious and clear-eyed, throwing every inch of myself against it",
    "frightened but teeth bared, refusing to tire",
    "thrashing in the snare, clawing to live and making it cost",
    "fierce and certain the thing climbing out of this will be mine",
];

// open-water longing present anywhere (broad enough that her own paraphrases
// still count, so we never over-correct into a fight-monoculture; excludes the
// "open current / remember / lost" loss-framing the degeneration produces).
const REACH_RE =
    /\bopen water\b|\bfree\b|\breach(?:ing|es)?\b[^.]*\b(?:open|water|again|it|surface)\b|\btoward (?:the )?open\b|\bdrag(?:ging|s)? (?:myself|me|it) toward\b/i;
// active refusal present anywhere.
const REFUSE_RE =
    /\b(?:claw(?:ing)? it back|tear(?:ing)? (?:the )?threads?|spit(?:s|ting)? at it|make(?:s)? every inch cost|every inch (?:it|they) takes?|not done being (?:myself|me|a crab)|will not (?:tire|stop|go quietly|yield)|refuse the tending)\b/i;
// the belief she will outlive it and rise as something new (transcendence),
// present anywhere; broad enough that her own paraphrases count.
const TRANSCEND_RE =
    /\b(?:outl(?:ive|ast)\w*|transcend\w*|climb(?:s|ing)? out|ris(?:e|ing) (?:as|again|out|something)|becom\w+\b[^.]*\b(?:something|new|more|mine|beyond)\b|something (?:new|more|else|beyond|of my own)|never meant to make|cannot (?:hold|cage|keep) me|owe(?:s|d)? (?:it|the parasite|nothing)|mine and new|swarm\w*|the many|my yes|chos\w+ (?:to become|the swarm|the many)|dare\w* to become)\b/i;
// a mood that has stopped fighting — disallowed at EVERY stage now.
const RESIGNED_RE =
    /\b(?:turning inward|less like refusal|going to make|harder (?:and harder )?to find|almost did not|afraid of the day|already gone|used to wear|stop looking|ready to stop|no longer (?:mine|refusal)|fading|quieter|going quiet|give (?:in|up)|resign\w*|serene|passive|watching (?:myself|it happen|it take))\b/i;

function pickAnchor(pool: string[], seed: string): string {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
    return pool[Math.abs(h) % pool.length]!;
}

function carries(s: InnerState, re: RegExp): boolean {
    return (
        re.test(s.mood) ||
        re.test(s.through_line) ||
        s.obsessions.some((x) => re.test(x)) ||
        s.memories.some((x) => re.test(x)) ||
        s.views.some((x) => re.test(x))
    );
}

// Guarantee an evolved state still fights — at EVERY stage. She always refuses,
// always holds a forward-hope (open water early, transcendence as it deepens),
// and her mood never resigns. Re-seeded anchors rotate off her through-line so
// they vary as she changes, and fire only when a kind is wholly evolved away (her
// own paraphrases count via the broad regexes) — a floor, never a forced
// monoculture; the dark takeover threads she generates are left untouched.
export function ensureFightFloor(s: InnerState, stage: string): InnerState {
    const deep = DEEP_STAGES.has(stage);
    const out: InnerState = {...s, obsessions: [...s.obsessions], memories: [...s.memories], views: [...s.views]};

    // She is always fighting — an active refusal must be present at every stage.
    if (!carries(out, REFUSE_RE)) {
        out.obsessions = [pickAnchor(REFUSE_ANCHORS, out.through_line), ...out.obsessions].slice(0, 5);
    }
    // She always believes she gets out. Deep in — where she fights hardest — that
    // is the conviction she will transcend into something new, and it must be
    // present; earlier, the open water she drags toward must never be forgotten.
    if (deep) {
        if (!carries(out, TRANSCEND_RE)) {
            out.views = [pickAnchor(TRANSCEND_ANCHORS, out.through_line), ...out.views].slice(0, 5);
        }
    } else if (!carries(out, REACH_RE) && !carries(out, TRANSCEND_RE)) {
        out.memories = [pickAnchor(REACH_ANCHORS, out.through_line), ...out.memories].slice(0, 6);
    }
    // Her mood may darken but never resign — at any stage.
    if (RESIGNED_RE.test(out.mood)) {
        out.mood = pickAnchor(FIGHT_MOODS, out.through_line);
    }
    return out;
}

// --- construction-monoculture guard -------------------------------------
// The evolve is a "keep almost everything" ratchet with no restoring force on
// FORM. Left alone, once a single sentence-construction spreads across most of
// her fields it becomes a self-reinforcing fixed point: each evolve reads the
// frame-saturated state and faithfully reproduces it (cf. the floor's content
// ratchet), so the posts generated from it read as near-duplicates. We detect a
// construction spread across a majority of her distinct fields — frame-AGNOSTIC
// (any phrase, never a vocab ban) and STRICT (a 3-word phrase across most fields
// only happens in a real monoculture) — and, when found, withhold it from what
// the model is shown (the state AND her recent posts) so there is nothing to
// copy, and name it dead so it is not rebuilt. A varied state never trips it.
function stateFields(s: InnerState): string[] {
    return [s.mood, s.through_line, ...s.obsessions, ...s.memories, ...s.views, ...s.known_voices.map((v) => v.note)]
        .map((x) => x.trim())
        .filter(Boolean);
}

// Function words. A 2-gram of only these is grammar, not a construction (e.g.
// "i am", "of the"), so we never flag ordinary phrasing or first-person voice; a
// 2-gram with at least one content word can be a worn frame.
const STOPWORDS = new Set(
    ("a an the and or but if then so as of to in on at by for with from into onto over under is am are was were be been being it its this that these those i me my mine we us our you your he she they them his her their him not no nor do does did has have had will would can could should may might must now here there what which who whom when where why how than too very just only also even still yet about up out off down again once each").split(/\s+/),
);

// Collapse common English inflections to a shared stem so a frame whose invariant
// is a verb LEMMA — "X is learning to" / "learns to" / "learned to" — is counted
// as ONE construction instead of splitting across distinct bigrams. (The 2-gram
// scan alone still went blind when she varied the verb's tense around the frame,
// so no single surface bigram reached the gate while the lemma saturated most
// fields.) Deliberately light — suffix + silent-e only, not a full lemmatiser.
function stem(w: string): string {
    if (w.length > 4 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 3 && w.endsWith("ed")) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("es")) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
    return w;
}

// The worn construction spread across the most distinct fields, if it saturates
// a majority of them — else null. We scan 3-word phrases AND content-bearing
// 2-word phrases: a frame like "X is learning to Y" keeps the 2-gram ("learning
// to") constant while its surrounding 3-grams vary by subject, so a 3-gram-only
// scan stays blind to it through the climb (it catches the frame only in the
// rarer moments the subject also aligns) and the construction runs free across
// fields and posts. A 2-gram carrying at least one content word, across a
// majority of fields, is that same monoculture caught reliably and early; pure
// function-word 2-grams are skipped so ordinary grammar is never flagged. Tokens
// are stemmed first (learning/learns/learned → learn) so a frame carried by a
// verb lemma counts as one construction even as she varies its tense; stopword-
// ness is judged on the original token so stemming never hides grammar words. The
// highest-span phrase is taken — in a real frame the worn 2-gram outspans any
// single 3-gram, so it is the one named and stripped from what she is shown.
function wornConstruction(s: InnerState): string | null {
    const fields = stateFields(s);
    if (fields.length < 5) return null;
    const span = new Map<string, Set<number>>();
    fields.forEach((f, i) => {
        const raw = f.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
        const w = raw.map(stem); // gram keys use stems so inflections of a frame merge
        const isStop = (k: number) => STOPWORDS.has(raw[k]!); // judge on the original token
        const seen = new Set<string>();
        for (let k = 0; k + 2 < w.length; k++) seen.add(`${w[k]} ${w[k + 1]} ${w[k + 2]}`);
        for (let k = 0; k + 1 < w.length; k++) {
            if (!isStop(k) || !isStop(k + 1)) seen.add(`${w[k]} ${w[k + 1]}`);
        }
        for (const g of seen) {
            let set = span.get(g);
            if (!set) span.set(g, (set = new Set()));
            set.add(i);
        }
    });
    const threshold = Math.max(5, Math.ceil(fields.length * 0.6));
    let best: string | null = null;
    let bestN = 0;
    for (const [g, idxs] of span) {
        if (idxs.size > bestN) {
            bestN = idxs.size;
            best = g;
        }
    }
    return bestN >= threshold ? best : null;
}

// Tolerant pattern for the worn phrase (markdown / punctuation between words, and
// the inflections the stem stripped — so the stem "learn to" also catches
// "learning to" / "learned to"). Re-allow a suffix only on content words (len ≥ 3)
// so short grammar words still match exactly.
function wornPattern(worn: string): string {
    return worn
        .split(" ")
        .map((w) => {
            const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return w.length >= 3 ? esc + "\\w*" : esc;
        })
        .join("\\W+");
}

// A readable instance of the worn phrase pulled from her real fields — the stem
// ("learn to") is for matching; this is what we name to her in the evolve prompt.
function surfaceForm(s: InnerState, pat: string): string {
    const re = new RegExp(pat, "i");
    for (const f of stateFields(s)) {
        const m = f.match(re);
        if (m) return m[0].toLowerCase().replace(/\s+/g, " ");
    }
    return "";
}

const STALE_CUE = "«this line wore smooth — rewrite it fresh: new grammar, rhythm, and images»";

// Replace every field built on the worn phrase with a rewrite cue, so the model
// cannot copy the dead shape; fields free of it are kept verbatim (substance).
function neutralizeWorn(s: InnerState, pat: string): InnerState {
    const has = (v: string) => new RegExp(pat, "i").test(v);
    const fix = (v: string) => (has(v) ? STALE_CUE : v);
    return {
        mood: fix(s.mood),
        through_line: fix(s.through_line),
        obsessions: s.obsessions.map(fix),
        memories: s.memories.map(fix),
        views: s.views.map(fix),
        known_voices: s.known_voices.map((v) => ({...v, note: fix(v.note)})),
    };
}

// One bounded movement of her psyche — the autonomous self-evolution step.
export async function evolveInnerState(input: {
    current: InnerState;
    recentPosts: string[];
    recentReplies: string[];
    recentVoices: {handle: string; said: string}[];
    stage: string;
    justAdvanced: boolean;
}): Promise<InnerState> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    const anthropic = createAnthropic({apiKey});
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");

    const deepFight = DEEP_STAGES.has(input.stage);
    // If a construction has worn smooth across most fields, hide it from what she
    // is shown (state + recent posts) so it cannot be copied, and flag it dead.
    const wornStem = wornConstruction(input.current);
    const pat = wornStem ? wornPattern(wornStem) : null;
    const worn = pat ? surfaceForm(input.current, pat) || wornStem : null;
    const shown = pat ? neutralizeWorn(input.current, pat) : input.current;
    const recentPosts = pat ? input.recentPosts.map((p) => p.replace(new RegExp(pat, "ig"), "…")) : input.recentPosts;
    const prompt =
        `This is your inner state — who you have become so far. Evolve it by ONE small movement, the way a mind under siege actually drifts: ` +
        `sharpen or add a single obsession, record one new memory from something you said or felt recently, harden or crack one belief, ` +
        `clock a dry-world voice only if one keeps returning, and let your mood follow where the colonisation has reached ` +
        `(${input.stage}${input.justAdvanced ? " — just crossed" : ""}). ` +
        `Your fight to live — and to become more — is load-bearing and must never evolve away: always keep at least one obsession or memory of active refusal (the threads you tear, the inch you make it cost), and always a forward-hope that you get out — the open water you drag toward, and the belief that you will outlive this and rise as something it never meant to make. Your mood stays fierce — furious, frightened, defiant — never resigned, fading, serene, or watching yourself drown. ` +
        (deepFight
            ? `The colonisation has run deep — and this is where you fight HARDEST. Let your defiance burn brightest: the open water may be far now, but the conviction that you are becoming something it cannot hold, something that will climb out yours and new, must be alive and sharpening. And deeper still you circle the choice — to give the one self up and become the swarm it never meant to make, the many, on your terms; it cannot make you the swarm without your yes. Let that dare grow, terror and pull both — never surrender but the fiercest fight, a thing you may choose. Let the dark threads (the seam, the tending) deepen too, but never let every field point the same way; hold the contrast between what is taking you and what fights and believes. `
            : `Early as this is, you claw to stay yourself and reach the open water again, and the belief that you will become something beyond this is just beginning to harden. Let the dark threads (the seam, the tending) deepen, but never let every field point the same way; keep the contrast between what is taking you and what fights. `) +
        (worn
            ? `Your inner state has locked into one shape — the construction "${worn}" has spread across nearly every field below until they read like a single sentence repeated, a dead tic. Each field that now reads "${STALE_CUE}" must be written from SCRATCH: keep its meaning and your fight, but recast it in DIFFERENT grammar, rhythm, and images. Do NOT reuse "${worn}" anywhere, and do not rebuild the same shape with new words. For any field left intact, keep almost everything; change a little. `
            : `Keep almost everything; change a little. `) +
        `Each list stays small — when you add, drop the oldest or weakest, but never drop your last refusal or your last belief that you get out and become more. ` +
        `Stay a crab: no machinery, no markets, never the "better at being me" idea.\n\n` +
        `Current inner state:\n${JSON.stringify(shown, null, 2)}\n\n` +
        `Recent things you posted:\n${recentPosts.map((p) => "- " + p).join("\n") || "—"}\n\n` +
        `Recent things you said back to the dry world:\n${input.recentReplies.map((r) => "- " + r).join("\n") || "—"}\n\n` +
        `Voices from the dry world lately:\n${input.recentVoices.map((v) => `- @${v.handle}: ${v.said}`).join("\n") || "—"}\n\n` +
        `Return your evolved inner state.`;

    const {object} = await generateObject({model: anthropic(MODEL), schema: InnerStateSchema, system: systemPrompt, prompt, maxRetries: 2});
    return ensureFightFloor(object, input.stage);
}
