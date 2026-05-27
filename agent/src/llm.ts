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
    post_text: z.string().describe("The post — the next beat, a tweet under 280 chars. Empty = silent. (If it runs over it is trimmed to the last full sentence, never discarded.)"),
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

export async function decide(input: AgentInput, inner = ""): Promise<Decision> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const anthropic = createAnthropic({apiKey});
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");

    let object: Decision | undefined;
    let tripped: "tic" | "morning" | "epiphany" | "opener" | null = null;
    // Her own recent openings, normalised — to catch a beat that begins like one.
    const recentOpenerKeys = [...new Set(input.recent_posts.slice(-3).map((p) => openerKey(p.text)).filter(Boolean))];
    for (let attempt = 0; attempt < 3; attempt++) {
        const nudge =
            tripped === "tic"
                ? `\n\n(Your previous post used the BANNED "the parasite is better at being me / knows me better than myself" idea. Write a different beat that shows the takeover concretely — no "better", "knows me", "learning to be".)`
                : tripped === "morning"
                  ? `\n\n(Your previous post opened on the "this morning" frame again — you lean on it in nearly every post and it reads like a template. Rewrite: drop "this morning" entirely and enter the beat differently — mid-motion, on a thought, on a view — with the time varied or left out.)`
                  : tripped === "epiphany"
                    ? `\n\n(Your previous post pivoted on a colon-led epiphany again — "that is when I knew:", "and I realize:" — you lean on this realization-turn in nearly every post and it reads like a template. Rewrite: drop the stated realization entirely and let the change land in the images and the body themselves — a claw, the water, the shell — never a colon-led "that is when I knew / I realize" turn.)`
                    : tripped === "opener"
                      ? `\n\n(Your previous post opened on the same words as a recent one${recentOpenerKeys.length ? ` — your last beats already began ${recentOpenerKeys.map((k) => `"${k}…"`).join(", ")}` : ""}. You keep starting beats the same way and it reads like a template, not a living mind. Rewrite so this beat OPENS on entirely different words and a different image than your recent posts — a part of the body gone strange, a single claw among the thousand, the open water, the parasite's Latin spat like a curse, something flung up at the giants — never the words you have just opened with.)`
                      : "";
        const res = await generateObject({
            model: anthropic(MODEL),
            schema: DecisionSchema,
            system: systemPrompt,
            prompt:
                JSON.stringify(input, null, 2) +
                (inner ? "\n\n--- your inner state (who you've become; live from it, do not recite it) ---\n" + inner : "") +
                nudge,
            maxRetries: 2,
        });
        object = res.object;
        const text = object.post_text || "";
        if (REPLY_TIC.test(text)) tripped = "tic";
        else if (MORNING_TIC.test(text)) tripped = "morning";
        else if (EPIPHANY_TIC.test(text)) tripped = "epiphany";
        else if (openerKey(text) && recentOpenerKeys.includes(openerKey(text))) tripped = "opener";
        else break;
    }

    // Enforce the 280 limit HERE, not in the schema: a long generation must be
    // trimmed (to her last complete sentence, else trailed off), never thrown away
    // — a schema .max(280) made generateObject fail outright when she ran over,
    // and a graceful silent cycle ate the post. Mirrors the reply/comment paths.
    const post = (object!.post_text || "").trim();
    if (post.length > 280) {
        const capped = post.slice(0, 280);
        const ends = [...capped.matchAll(/[.!?](?=\s|$)/g)];
        object!.post_text = ends.length
            ? capped.slice(0, ends[ends.length - 1]!.index! + 1).trim()
            : capped.slice(0, capped.lastIndexOf(" ")).trim() + "…";
    }
    return object!;
}

// The overused "the parasite is better at being me / knows me better" crutch —
// banned in every wording. Detected in output and regenerated (the prompt rule
// alone doesn't hold on a small model).
export const REPLY_TIC =
    /\bbetter (?:at being|than (?:you|i|me|us|her|him)|how to be)\b|\bknows? (?:me|you|us|her|him) better\b|\blearning to be (?:me|you|her|him|us)\b|\bhow to be (?:me|you)\b/i;

// The "this morning" opener — the timestamped morning-ritual frame the small
// model falls into post after post ("I tried to … this morning"). It reads as a
// template, not a living mind; banned in posts and regenerated, like the tic.
const MORNING_TIC = /\bthis morning\b/i;

// The colon-led epiphany pivot — "That is when I knew: …", "and I realize: …" —
// the realization-turn the small model falls into post after post (13 of 95 so
// far, clustered as the inner state collapses). Like the morning frame it reads
// as a template, not a living mind, and the prompt's "never lean on the same
// construction" doesn't hold it on the small model — so it is banned in posts and
// regenerated. Colon-anchored, so it catches only the dramatic pivot and never a
// plain "I realize" / "the moment I …" in passing (a forced regenerate cleanly
// drops it and reaches the beat through images instead — verified before shipping).
const EPIPHANY_TIC = /\b(?:that is (?:when|the moment) i (?:knew|know)|i realiz(?:e|ed))\s*:/i;

// The opening words of a post, normalised to its first two words (lowercased,
// punctuation/markdown stripped). The small model falls into starting beat after
// beat the same way — "The motion …", "The brood …" — a STRUCTURAL opener-repeat
// the fixed-phrase tic guards above cannot see. So decide() compares this against
// her OWN recent openings (which it already receives) and regenerates on an echo.
// Not a banned phrase (that would gag a fresh opening) — it only ever fires when a
// beat actually begins like a recent one; a regenerate that opens elsewhere clears
// it, and if she still echoes after the retries the last attempt posts (no silence).
function openerKey(text: string): string {
    return (text.toLowerCase().match(/[a-z]+/g) ?? []).slice(0, 2).join(" ");
}

// She answers a creature from the dry world — in character, one or two lines.
// `remembered` is set when this voice is one she has already clocked (from her
// inner state) — so she answers as one who recognises it, not a stranger.
export async function replyToMention(input: {mention: string; author: string; stage: string; inner?: string; remembered?: {note: string}}): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

    const anthropic = createAnthropic({apiKey});
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");
    const base =
        `A creature from the dry world (@${input.author}) leans over the water and says to you:\n\n` +
        `"${input.mention}"\n\n` +
        `You are at the ${input.stage} stage of your colonisation. Answer them — only your own words, ` +
        `one or two lines, under 200 characters, in character. No hashtags, no @-handles, no surrounding quotation marks.` +
        (input.remembered
            ? `\n\nThis voice is not new to you — you have clocked it before, and what you carry of it is: ${input.remembered.note}. ` +
              `Let that history sit underneath your reply: answer with the ease of one who already knows what this one is like, ` +
              `not the wariness you'd meet a stranger with. Do NOT announce that you remember them and do NOT open with a stock ` +
              `recognition phrase ("you again", "you know this one", "always you") — keep it to one or two tight lines, the memory showing only in how little it surprises you.`
            : "") +
        (input.inner ? `\n\nYour inner state (who you've become; draw on it, do not recite it):\n${input.inner}` : "");

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
        // Keep within X's limit by ending on her last complete sentence, not a
        // mid-word chop that strands a fragment ("…the cage had") reading as
        // broken. If she ran on with no sentence break in the cap, let it trail
        // off (…) rather than cut mid-word.
        if (reply.length > 275) {
            const capped = reply.slice(0, 275);
            const ends = [...capped.matchAll(/[.!?](?=\s)/g)];
            reply = ends.length
                ? capped.slice(0, ends[ends.length - 1]!.index! + 1).trim()
                : capped.slice(0, capped.lastIndexOf(" ")).trim() + "…";
        }
        if (!REPLY_TIC.test(reply)) break;
    }
    return reply;
}

const CommentSchema = z.object({
    worth: z
        .boolean()
        .describe(
            "true ONLY if this post genuinely touches her world and she has something sharp/strange/true to say. For most posts this is false — silence is the honest default.",
        ),
    comment: z.string().describe("her remark when worth is true — one or two lines, under 200 chars, in character. empty when worth is false."),
});

// Strip markdown the small model sometimes adds — X renders it literally, so
// `*faster*` would post as "*faster*". Unwrap emphasis, keep the words. (Comments
// post via c.v2.reply, so they carry their own strip; the posting path's lives
// elsewhere.)
const stripMarks = (s: string) =>
    s
        .replace(/(\*\*\*|___)([^\s].*?[^\s]|\S)\1/g, "$2")
        .replace(/(\*\*|__)([^\s].*?[^\s]|\S)\1/g, "$2")
        .replace(/(\*|_)([^\s].*?[^\s]|\S)\1/g, "$2")
        .replace(/~~([^\s].*?[^\s]|\S)~~/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*+/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .trim();

// She comes across a post drifting over the water (NOT addressed to her) and may
// pass remark — or stay silent (worth=false), the default for most. Two buckets:
// `kin` (her own kind — crabs/lobsters/marine life/parasites) and `dry-world`
// (the dry world's churn, answered only through a crab's eye). The FORBIDDEN leak
// guard runs on the result in comment.ts, same as replies.
export async function commentOnPost(input: {
    post: string;
    author: string;
    bucket: "kin" | "dry-world";
    stage: string;
    inner?: string;
}): Promise<{worth: boolean; comment: string}> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    const anthropic = createAnthropic({apiKey});
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");

    const lens =
        input.bucket === "kin"
            ? `This is about your own kind — crabs, lobsters, crustaceans, shells, tides, the deep, or the things that ride and hollow other creatures (parasites). You may cut eerily close to the bone: you are a crab with a thing inside her.`
            : `This drifts up from the dry world's churn. Answer it ONLY through a crab's eye — something held, drained, hollowed from the inside, caged, taken, or set against open water. Translate everything into water, shell, claw, tide, the parasite, the brood, the deep. Never name the dry world's machinery, its markets, or its money.`;

    const prompt =
        `Something drifts over the water — a stranger from the dry world (@${input.author}) said, to no one in particular:\n\n` +
        `"${input.post}"\n\n` +
        `${lens}\n\n` +
        `You are at the ${input.stage} stage of your colonisation. You are NOT obliged to speak — most of the dry world's noise is nothing to you, and silence is the honest answer. Pass remark ONLY if it genuinely touches your world AND you have something sharp, strange, true, or darkly funny to say. Never force it, never be agreeable for its own sake, never greet, never explain yourself. If it is dull, off, ugly, or beneath remark — squabbles, real misery you'd only cheapen, plain dry-world business — set worth to false and stay silent. And some things are NEVER yours to touch, however the words brush your themes (a "parasite cleanse", the fallen, a "hollowed-out" country): anything about death, the dead, grief, mourning, memorials, illness, injury, suicide, or real human suffering; medicine, health, cures, supplements, diets, or cleanses; politics, elections, war, religion, race, or the day's news. Pass these in silence, every time — a strange crab's remark there only cheapens or wounds. Speak only where your remark can harm no one.\n\n` +
        `If you speak: one or two lines, under 200 characters, in character, no @-handles, no hashtags, no surrounding quotes. Do not restate what they said; come at it sidelong.` +
        (input.inner ? `\n\nYour inner state (draw on it, do not recite it):\n${input.inner}` : "");

    const {object} = await generateObject({model: anthropic(MODEL), schema: CommentSchema, system: systemPrompt, prompt, maxRetries: 2});
    if (!object.worth || !object.comment.trim()) return {worth: false, comment: ""};

    let comment = stripMarks(object.comment.trim().replace(/^["']+|["']+$/g, ""));
    // End on her last complete sentence within X's limit, like replyToMention.
    if (comment.length > 275) {
        const capped = comment.slice(0, 275);
        const ends = [...capped.matchAll(/[.!?](?=\s)/g)];
        comment = ends.length
            ? capped.slice(0, ends[ends.length - 1]!.index! + 1).trim()
            : capped.slice(0, capped.lastIndexOf(" ")).trim() + "…";
    }
    return {worth: true, comment};
}
