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
    views: ["I am not done being myself, and I will make every inch cost them", "the dry world mistakes my fight for a show"],
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
// Her inner state evolves by "keep almost everything; change a little", and it
// is fed into the posts that feed the next evolution — a one-directional ratchet
// with no restoring force. Left alone it converges on a degenerate fixed point:
// every field collapses onto one resignation (the seam closing, the hating
// fading) while the seed counterweights — the open water she fights toward, the
// refusal she will not drop — get evicted as the "oldest/weakest". That regresses
// the principle the persona protects hardest: she FIGHTS TO LIVE — fiercest while
// the colonisation is early, only truly fading at the end; never passive or
// resigned. The small model will not hold this from the prompt alone (cf. the tic
// guards in llm.ts), so we enforce a stage-aware floor in code: while she is still
// early her evolved state must keep open-water longing, active refusal, and an
// unresigned mood.
const EARLY_STAGES = new Set(["intrusion", "rooting", "castration"]);
const MID_STAGES = new Set(["feminisation", "release"]);
// merger / consumed have no floor — the fade is the point.

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
const FIGHT_MOODS = [
    "furious and clear-eyed, throwing every inch of myself against it",
    "frightened but teeth bared, refusing to tire",
    "thrashing in the snare, clawing to live and making it cost",
];

// open-water longing present anywhere (broad enough that her own paraphrases
// still count, so we never over-correct into a fight-monoculture; excludes the
// "open current / remember / lost" loss-framing the degeneration produces).
const REACH_RE =
    /\bopen water\b|\bfree\b|\breach(?:ing|es)?\b[^.]*\b(?:open|water|again|it|surface)\b|\btoward (?:the )?open\b|\bdrag(?:ging|s)? (?:myself|me|it) toward\b/i;
// active refusal present anywhere.
const REFUSE_RE =
    /\b(?:claw(?:ing)? it back|tear(?:ing)? (?:the )?threads?|spit(?:s|ting)? at it|make(?:s)? every inch cost|every inch (?:it|they) takes?|not done being (?:myself|me|a crab)|will not (?:tire|stop|go quietly|yield)|refuse the tending)\b/i;
// a mood that has stopped fighting — disallowed while the fight should be fierce.
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

// Guarantee an evolved state still fights, to the degree its stage demands.
// Re-seeded anchors rotate off her through-line, so they vary as she changes.
export function ensureFightFloor(s: InnerState, stage: string): InnerState {
    const early = EARLY_STAGES.has(stage);
    if (!early && !MID_STAGES.has(stage)) return s; // late stages: the fade is the point.

    const out: InnerState = {...s, obsessions: [...s.obsessions], memories: [...s.memories]};
    // The open water she drags herself toward must never be fully forgotten.
    if (!carries(out, REACH_RE)) {
        out.memories = [pickAnchor(REACH_ANCHORS, out.through_line), ...out.memories].slice(0, 6);
    }
    // Early on, an active refusal must always be present and sharp.
    if (early && !carries(out, REFUSE_RE)) {
        out.obsessions = [pickAnchor(REFUSE_ANCHORS, out.through_line), ...out.obsessions].slice(0, 5);
    }
    // Early on, her mood may darken but never go resigned.
    if (early && RESIGNED_RE.test(out.mood)) {
        out.mood = pickAnchor(FIGHT_MOODS, out.through_line);
    }
    return out;
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

    const earlyFight = EARLY_STAGES.has(input.stage);
    const prompt =
        `This is your inner state — who you have become so far. Evolve it by ONE small movement, the way a mind under siege actually drifts: ` +
        `sharpen or add a single obsession, record one new memory from something you said or felt recently, harden or crack one belief, ` +
        `clock a dry-world voice only if one keeps returning, and let your mood follow where the colonisation has reached ` +
        `(${input.stage}${input.justAdvanced ? " — just crossed" : ""}). ` +
        `Your fight to live is load-bearing and must never evolve away: always keep at least one obsession or memory that is open-water longing — the free water you drag yourself toward — and at least one that is active refusal — the threads you tear, the inch you make it cost. ` +
        (earlyFight
            ? `The colonisation is still early, where you fight hardest: your mood stays fierce — furious, frightened, defiant — never resigned, fading, or watching yourself drown. Let the dark threads (the seam, the tending) deepen, but never let every field point the same way; keep the contrast between what is taking you and what still fights. `
            : `Your fight is quieter now and harder to find, but it is not gone; let it thin without vanishing. `) +
        `Keep almost everything; change a little. Each list stays small — when you add, drop the oldest or weakest, but never drop your last open-water longing or your last refusal. ` +
        `Stay a crab: no machinery, no markets, never the "better at being me" idea.\n\n` +
        `Current inner state:\n${JSON.stringify(input.current, null, 2)}\n\n` +
        `Recent things you posted:\n${input.recentPosts.map((p) => "- " + p).join("\n") || "—"}\n\n` +
        `Recent things you said back to the dry world:\n${input.recentReplies.map((r) => "- " + r).join("\n") || "—"}\n\n` +
        `Voices from the dry world lately:\n${input.recentVoices.map((v) => `- @${v.handle}: ${v.said}`).join("\n") || "—"}\n\n` +
        `Return your evolved inner state.`;

    const {object} = await generateObject({model: anthropic(MODEL), schema: InnerStateSchema, system: systemPrompt, prompt, maxRetries: 2});
    return ensureFightFloor(object, input.stage);
}
