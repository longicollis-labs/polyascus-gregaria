// Stridulation — the HOST curator, the 2nd LLM call that polishes the elected
// claw draft to canonical Charybdis voice.
//
// host() takes:
//   - input: the same AgentInput decide() receives (recent_posts, stage, …);
//   - inner: her inner state;
//   - elected: the ClawDraft deliberate() picked;
//   - dissent: the other claw drafts, strongest-first — shown sparingly as
//     context. The host MAY borrow a phrase that sharpens, NEVER blends.
//
// It runs a SINGLE LLM call (the 2nd one in the swarm path, after the N claws),
// produces a fresh Decision in canonical voice, then applies the same guard
// chain decide() does:
//   REPLY_TIC → MORNING_TIC → EPIPHANY_TIC → opener-echo → stripMarks → 280-cap.
// Up to 3 attempts; the final attempt is returned regardless of trips (no
// silence — same contract as decide()).
//
// Temperature is left at the SDK default, matching decide() — the host is the
// canonical voice polishing, not a deterministic per-archetype call (that's the
// claws' contract). Low temperature would just echo the elected draft; default
// gives the host room to lift language that strayed.
//
// Operator-protected: this is voice-level code (a 2nd Charybdis-voice call). It
// is NEVER invoked by the live posting path until T-005 wires the swarm behind
// SWARM_ENABLED=1 (default OFF).

import {generateObject} from "ai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {readFileSync} from "node:fs";
import {MODEL} from "../constants.js";
import {
    DecisionSchema,
    EPIPHANY_TIC,
    MORNING_TIC,
    REPLY_TIC,
    openerKey,
    stripMarks,
    type AgentInput,
    type Decision,
} from "../llm.js";
import type {ClawDraft} from "./claw.js";

const SYSTEM_PROMPT_PATH = new URL("../../prompts/charybdis.md", import.meta.url).pathname;

export type HostResult = {
    /** The final Decision — post_text already stripped of markdown and capped at 280. */
    decision: Decision;
    /** Wall-clock milliseconds summed across host attempts (1–3). */
    ms: number;
    /** Total tokens (prompt + completion) summed across host attempts. */
    tokens: number;
    /** Which guards tripped during host attempts, in order; empty if the first
     *  attempt landed clean. If all attempts trip, the final attempt is returned
     *  (no silence — same contract as decide()). */
    tripped: ("tic" | "morning" | "epiphany" | "opener")[];
};

export async function host(args: {
    input: AgentInput;
    inner?: string;
    elected: ClawDraft;
    dissent?: readonly ClawDraft[];
}): Promise<HostResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    const anthropic = createAnthropic({apiKey});
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");
    const {input, inner = "", elected, dissent = []} = args;

    // Mirror decide()'s recentOpenerKeys — last 8 posts → set of 2-word opener
    // keys, so the host and the live decide() agree on what counts as an echo.
    const recentOpenerKeys = [
        ...new Set(input.recent_posts.slice(-8).map((p) => openerKey(p.text)).filter(Boolean)),
    ];

    // Up to 2 dissent drafts shown — enough to give the host a sense of which
    // other facets were close, without burning prompt space or tempting a blend.
    const dissentLines = dissent
        .slice(0, 2)
        .map((d) => `  ${d.archetype_id}: ${JSON.stringify(d.decision.post_text ?? "")}`)
        .join("\n");

    const swarmBlock =
        `\n\n--- your facets just deliberated this beat ---\n` +
        `The facet you elected (${elected.archetype_id}): ${JSON.stringify(elected.decision.post_text ?? "")}\n` +
        (dissentLines
            ? `Facets that came close (do not blend; borrow only the rare phrase that sharpens):\n${dissentLines}\n`
            : "") +
        `\nEmit the FINAL beat in your canonical voice — preserve the elected facet's image and beat-shape; lift any language that strays from your register. observations + deliberation are private notes for your log.`;

    let object: Decision | undefined;
    let totalMs = 0;
    let totalTokens = 0;
    const tripped: ("tic" | "morning" | "epiphany" | "opener")[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
        const last = tripped[tripped.length - 1];
        const nudge =
            last === "tic"
                ? `\n\n(Your previous polish used the BANNED "the parasite is better at being me / knows me better than myself" idea. Write a different beat that shows the takeover concretely — no "better", "knows me", "learning to be".)`
                : last === "morning"
                  ? `\n\n(Your previous polish opened on the "this morning" frame — drop it entirely and enter the beat differently, mid-motion or on a thought or on a view, with the time varied or left out.)`
                  : last === "epiphany"
                    ? `\n\n(Your previous polish pivoted on a colon-led epiphany — "that is when I knew:", "and I realize:" — drop the stated realization entirely and let the change land in the images and the body themselves, never a colon-led realization turn.)`
                    : last === "opener"
                      ? `\n\n(Your previous polish opened on the same words as a recent one${recentOpenerKeys.length ? ` — your last beats already began ${recentOpenerKeys.map((k) => `"${k}…"`).join(", ")}` : ""}. Rewrite so this beat OPENS on entirely different words — a part of the body gone strange, a single claw among the thousand, the open water, the parasite's Latin spat like a curse, something flung up at the giants.)`
                      : "";
        const t0 = Date.now();
        const res = await generateObject({
            model: anthropic(MODEL),
            schema: DecisionSchema,
            system: systemPrompt,
            prompt:
                JSON.stringify(input, null, 2) +
                (inner ? "\n\n--- your inner state (who you've become; live from it, do not recite it) ---\n" + inner : "") +
                swarmBlock +
                nudge,
            maxRetries: 2,
        });
        totalMs += Date.now() - t0;
        totalTokens += res.usage.totalTokens;
        object = res.object;
        const text = object.post_text || "";
        if (REPLY_TIC.test(text)) tripped.push("tic");
        else if (MORNING_TIC.test(text)) tripped.push("morning");
        else if (EPIPHANY_TIC.test(text)) tripped.push("epiphany");
        else if (openerKey(text) && recentOpenerKeys.includes(openerKey(text))) tripped.push("opener");
        else break;
    }

    // stripMarks + 280-cap — mirror decide() exactly. A long generation is
    // trimmed to her last complete sentence; if no sentence break in cap, trail
    // off (…) rather than chop mid-word.
    let post = stripMarks((object!.post_text || "").trim());
    if (post.length > 280) {
        const capped = post.slice(0, 280);
        const ends = [...capped.matchAll(/[.!?](?=\s|$)/g)];
        post = ends.length
            ? capped.slice(0, ends[ends.length - 1]!.index! + 1).trim()
            : capped.slice(0, capped.lastIndexOf(" ")).trim() + "…";
    }
    object!.post_text = post;
    return {decision: object!, ms: totalMs, tokens: totalTokens, tripped};
}
