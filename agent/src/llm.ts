import {generateObject, generateText} from "ai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {readFileSync} from "node:fs";
import {z} from "zod";
import {MODEL} from "./constants.js";

const SYSTEM_PROMPT_PATH = new URL("../prompts/charybdis.md", import.meta.url).pathname;

const DecisionSchema = z.object({
    observations: z.string().describe("Brief private note on where the change has reached. For the log."),
    deliberation: z
        .string()
        .describe("Private note on what new beat to tell and why it is not a repeat. For the log."),
    post_text: z.string().max(280).describe("The post — the next beat of the transformation. Empty = silent."),
    action_kind: z.enum(["none", "pulse", "claim", "feed"]),
    action_amount_sol: z.number().describe("Always 0 — she is a narrator, she does not act."),
});

export type Decision = z.infer<typeof DecisionSchema>;

// Charybdis is a pure narrator. She receives only her recent posts (to avoid
// repetition), how long since she last spoke, and a one-word brood signal.
// Everything else — the body, the mind, the externa — she supplies.
export type AgentInput = {
    recent_posts: {text: string; posted_at_iso: string}[];
    since_last_post_seconds: number | null;
    brood: "swelling" | "thinning" | "steady" | "still";
    // How far the colonisation has progressed (on-chain, irreversible):
    // intrusion → rooting → castration → feminisation → release → merger → consumed.
    stage: string;
    // True when the stage deepened since her last post — narrate the crossing.
    just_advanced: boolean;
    // The stage she just left, when just_advanced; otherwise null.
    advanced_from: string | null;
};

export async function decide(input: AgentInput): Promise<Decision> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const anthropic = createAnthropic({apiKey});
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");

    let object: Decision | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
        const nudge =
            attempt === 0
                ? ""
                : `\n\n(Your previous post used the BANNED "the parasite is better at being me / knows me better than myself" idea. Write a different beat that shows the takeover concretely — no "better", "knows me", "learning to be".)`;
        const res = await generateObject({
            model: anthropic(MODEL),
            schema: DecisionSchema,
            system: systemPrompt,
            prompt: JSON.stringify(input, null, 2) + nudge,
            maxRetries: 2,
        });
        object = res.object;
        if (!REPLY_TIC.test(object.post_text || "")) break;
    }

    return object!;
}

// The overused "the parasite is better at being me / knows me better" crutch —
// banned in every wording. Detected in output and regenerated (the prompt rule
// alone doesn't hold on a small model).
const REPLY_TIC =
    /\bbetter (?:at being|than (?:you|i|me|us|her|him)|how to be)\b|\bknows? (?:me|you|us|her|him) better\b|\blearning to be (?:me|you|her|him|us)\b|\bhow to be (?:me|you)\b/i;

// She answers a creature from the dry world — in character, one or two lines.
export async function replyToMention(input: {mention: string; author: string; stage: string}): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const anthropic = createAnthropic({apiKey});
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");
    const base =
        `A creature from the dry world (@${input.author}) leans over the water and says to you:\n\n` +
        `"${input.mention}"\n\n` +
        `You are at the ${input.stage} stage of your colonisation. Answer them — only your own words, ` +
        `one or two lines, under 200 characters, in character. No hashtags, no @-handles, no surrounding quotation marks.`;

    let reply = "";
    for (let attempt = 0; attempt < 3; attempt++) {
        const nudge =
            attempt === 0
                ? ""
                : `\n\nYour previous attempt was: "${reply}". It used the BANNED idea of the parasite being better at being you / ` +
                  `knowing you better than yourself. Rewrite completely — show the takeover through concrete body or sensation ` +
                  `(a claw moving before you decide, a want that arrived without you), and do NOT use the words "better", "knows me", "knows you", or "learning to be".`;
        const {text} = await generateText({model: anthropic(MODEL), system: systemPrompt, prompt: base + nudge, maxRetries: 2});
        reply = text.trim().replace(/^["']+|["']+$/g, "");
        if (reply.length > 275) reply = reply.slice(0, reply.slice(0, 276).lastIndexOf(" ")).trim();
        if (!REPLY_TIC.test(reply)) break;
    }
    return reply;
}
