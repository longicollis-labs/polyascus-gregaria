import {generateObject} from "ai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {readFileSync} from "node:fs";
import {z} from "zod";
import {MODEL} from "./constants.js";
import type {Vitals} from "./state.js";

const SYSTEM_PROMPT_PATH = new URL("../prompts/charybdis.md", import.meta.url).pathname;

const DecisionSchema = z.object({
    observations: z.string().describe("Brief private note on what you see. For your own log."),
    deliberation: z
        .string()
        .describe(
            "Private reasoning about whether to post, whether to act, and why. For your own log.",
        ),
    post_text: z
        .string()
        .max(280)
        .describe("The X post to publish. Empty string for no post this invocation."),
    action_kind: z.enum(["none", "pulse", "claim", "feed"]),
    action_amount_sol: z
        .number()
        .describe("Amount in SOL for claim/feed. 0 for none/pulse. Ignored for larval claim."),
});

export type Decision = z.infer<typeof DecisionSchema>;

export type AgentInput = {
    vitals: Vitals;
    recent_posts: {text: string; posted_at_iso: string}[];
    since_last_post_seconds: number | null;
    since_last_claim_seconds: number | null;
    since_last_feed_seconds: number | null;
    vault_growth_24h_sol: number;
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
