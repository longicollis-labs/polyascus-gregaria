import {generateObject} from "ai";
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
};

export async function decide(input: AgentInput): Promise<Decision> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const anthropic = createAnthropic({apiKey});
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");

    const {object} = await generateObject({
        model: anthropic(MODEL),
        schema: DecisionSchema,
        system: systemPrompt,
        prompt: JSON.stringify(input, null, 2),
        maxRetries: 2,
    });

    return object;
}
