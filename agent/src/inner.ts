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

    const prompt =
        `This is your inner state — who you have become so far. Evolve it by ONE small movement, the way a mind under siege actually drifts: ` +
        `sharpen or add a single obsession, record one new memory from something you said or felt recently, harden or crack one belief, ` +
        `clock a dry-world voice only if one keeps returning, and let your mood follow where the colonisation has reached ` +
        `(${input.stage}${input.justAdvanced ? " — just crossed" : ""}). Keep almost everything; change a little. Each list stays small — ` +
        `when you add, drop the oldest or weakest. Stay a crab: no machinery, no markets, never the "better at being me" idea.\n\n` +
        `Current inner state:\n${JSON.stringify(input.current, null, 2)}\n\n` +
        `Recent things you posted:\n${input.recentPosts.map((p) => "- " + p).join("\n") || "—"}\n\n` +
        `Recent things you said back to the dry world:\n${input.recentReplies.map((r) => "- " + r).join("\n") || "—"}\n\n` +
        `Voices from the dry world lately:\n${input.recentVoices.map((v) => `- @${v.handle}: ${v.said}`).join("\n") || "—"}\n\n` +
        `Return your evolved inner state.`;

    const {object} = await generateObject({model: anthropic(MODEL), schema: InnerStateSchema, system: systemPrompt, prompt, maxRetries: 2});
    return object;
}
