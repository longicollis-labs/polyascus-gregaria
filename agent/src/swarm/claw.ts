// Stridulation — one CLAW of the swarm.
//
// A claw runs a single LLM call with the canonical Charybdis system prompt
// PLUS one archetype's facet fragment appended, producing a raw draft
// (Decision). It deliberately does NOT run the tic-retry loop, opener-echo
// guard, stripMarks, or length cap — those are the host curator's job
// (host.ts, T-004), which selects + polishes the elected draft. Drafts
// therefore represent the unguarded VOICE of one archetype, not a
// post-ready post.
//
// The archetype fragment is the per-claw discriminant. Temperature is no longer
// pinned to 0: best-of-N is bounded by its best draft, and greedy decoding made
// the 12 drafts near-duplicates (a thin pool to choose from). A moderate
// temperature (~0.9, env CLAW_TEMP) widens the pool so the judge has genuinely
// different lottery tickets to pick the best of — diversity provably lowers the
// best-of-N error floor. Drafts are no longer reproducible run-to-run by design.
//
// Operator-protected: this is voice-level code. It is NEVER invoked by the
// live posting path; T-005 wires it behind SWARM_ENABLED=1 (default OFF).

import {generateObject} from "ai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {readFileSync} from "node:fs";
import {MODEL} from "../constants.js";
import {DecisionSchema, type AgentInput, type Decision} from "../llm.js";
import type {Archetype} from "./archetypes.js";

const SYSTEM_PROMPT_PATH = new URL("../../prompts/charybdis.md", import.meta.url).pathname;
// Moderate temperature for best-of-N diversity (the judge selects quality after).
const CLAW_TEMP = (() => {
    const t = parseFloat(process.env.CLAW_TEMP ?? "0.9");
    return Number.isFinite(t) && t >= 0 && t <= 2 ? t : 0.9;
})();

export type ClawDraft = {
    archetype_id: string;
    decision: Decision;
    /** Wall-clock milliseconds for the generateObject call. */
    ms: number;
    /** Total tokens (prompt + completion) for this draft. */
    tokens: number;
};

export async function claw(archetype: Archetype, input: AgentInput, inner = ""): Promise<ClawDraft> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    const anthropic = createAnthropic({apiKey});
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8") + "\n\n" + archetype.fragment;
    const t0 = Date.now();
    const res = await generateObject({
        model: anthropic(MODEL),
        schema: DecisionSchema,
        system: systemPrompt,
        prompt:
            JSON.stringify(input, null, 2) +
            (inner ? "\n\n--- your inner state (who you've become; live from it, do not recite it) ---\n" + inner : ""),
        temperature: CLAW_TEMP,
        maxRetries: 2,
    });
    return {
        archetype_id: archetype.id,
        decision: res.object,
        ms: Date.now() - t0,
        tokens: res.usage.totalTokens,
    };
}
