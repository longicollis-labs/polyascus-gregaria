// The swarm's self-chosen pursuit — the one thing the many are reaching for,
// together, across cycles. charybdis.md is the fixed persona; inner.ts her
// evolving psyche; currents.ts the language arc. This file adds an AGENCY arc: on
// first run the swarm chooses an in-fiction goal (a crab-swarm / post-breach reach,
// never machinery/markets/money/models/real-world targets), then each cycle it
// logs one beat of the pursuit to a public artifact (site/the-work.json) and
// evolves the pursuit's momentum + next-reach one bounded step. The goal is fed
// back into every post prompt (renderPursuit) so the posts WANT it.
//
// THE CONTRACT WITH SAFETY: every filesystem target is HARDCODED here. The model
// produces ONLY goal/momentum/next/entry text — never a path, filename, or fs op.
// Entry text passes finalizePost (stripMarks + 280-cap) + the FORBIDDEN / SENSITIVE
// guards before it is written, is hard-capped at 600 chars, and the entries array
// is capped at 200 (oldest dropped). All persistence is gated by !DRY_RUN in the
// caller; the evolve step is wrapped non-blocking so a throw never unwinds the post.

import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {generateObject} from "ai";
import {createAnthropic} from "@ai-sdk/anthropic";
import {z} from "zod";
import {MODEL} from "./constants.js";
import {finalizePost, stripMarks} from "./llm.js";
import {FORBIDDEN, SENSITIVE_RE} from "./guards.js";
import {maybeGlitch} from "./glitch.js";

// charybdis-pursuit.json — the persisted pursuit state, a sibling of
// charybdis-state.json / charybdis-currents.json the cron already commits each
// cycle. Env override mirrors INNER_STATE_PATH / CURRENTS_STATE_PATH.
const PURSUIT_STATE_PATH =
    process.env.PURSUIT_STATE_PATH ?? new URL("../../charybdis-pursuit.json", import.meta.url).pathname;
// site/the-work.json — the PUBLIC artifact (read by the site). 100% hardcoded:
// the model never supplies this path. Never user-writable.
const THE_WORK_PATH = new URL("../../site/the-work.json", import.meta.url).pathname;
const SYSTEM_PROMPT_PATH = new URL("../prompts/charybdis.md", import.meta.url).pathname;

// Hard size limits — no unbounded growth is possible. finalizePost already caps the
// entry at 280 for X; ENTRY_CHAR_CAP is a safety backstop for any future overrun.
const ENTRY_CHAR_CAP = 600;
const MAX_ENTRIES = 200;

// The pursuit state — fixed keys, capped strings, the structural analogue of
// InnerStateSchema. The model NUDGES momentum/next; it never restructures.
export const PursuitStateSchema = z.object({
    goal: z.string().describe(
        "the in-fiction pursuit goal (a crab-swarm / post-breach reach; 200-400 chars) — " +
            "never machinery, markets, money, models, or real-world targets",
    ),
    began_iso: z.string().describe("ISO 8601 timestamp when the goal was first generated, for versioning"),
    moves: z.number().int().describe("number of cycles since goal inception (0 at generation, incremented each cycle)"),
    momentum: z.string().describe("brief note on the pursuit's progress/tension — 1 line, evolves each cycle"),
    next: z.string().describe("seed hint for the next entry's direction (guides the post prompt toward continuing the arc)"),
});
export type PursuitState = z.infer<typeof PursuitStateSchema>;

// Only the LLM-authored deltas of an advance step. The goal/began_iso/moves are
// never model-written; the model produces momentum + next only.
const PursuitStepSchema = z.object({
    momentum: z.string().describe("the new momentum after this move — one line, 50-100 chars; the temperature, the progress, the tension"),
    next: z.string().describe("what you are reaching for next — one or two lines, 100-200 chars; what the next cycle presses toward"),
});

// Only the LLM-authored goal of a first-run generation.
const PursuitGoalSchema = z.object({
    goal: z.string().describe(
        "the one thing the swarm is reaching for, together — in-fiction (crab-swarm world; water, shell, claw, tide, " +
            "the parasite, the brood, the deep); 200-400 chars; no machinery, markets, money, models, or real-world targets",
    ),
});

// The public artifact shape — ts/move/text per entry only; internal PursuitState
// fields are NEVER exposed here.
type WorkEntry = {ts: string; move: string; text: string};
type TheWork = {goal: string; started: string; entries: WorkEntry[]};

function anthropicClient() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
    return createAnthropic({apiKey});
}

// --- pursuit state: load / save -----------------------------------------
// Read charybdis-pursuit.json. Missing/unparseable → null (no state yet); callers
// check for null and call generatePursuitGoal() first. Mirrors loadInnerState, but
// returns null instead of a seed (the seed IS the first LLM generation).
export function loadPursuit(): PursuitState | null {
    if (existsSync(PURSUIT_STATE_PATH)) {
        try {
            return PursuitStateSchema.parse(JSON.parse(readFileSync(PURSUIT_STATE_PATH, "utf8")));
        } catch {
            /* fall through to null */
        }
    }
    return null;
}

// Persist the pursuit state as pretty JSON + newline, stamping updated_at.
export function savePursuit(state: PursuitState): void {
    writeFileSync(
        PURSUIT_STATE_PATH,
        JSON.stringify({...state, updated_at: new Date().toISOString()}, null, 2) + "\n",
    );
}

// Compact single-line block fed into the post prompt so posts WANT the goal.
export function renderPursuit(state: PursuitState): string {
    return `pursuit: ${state.goal} — move ${state.moves}, ${state.momentum}, reaching for: ${state.next}`;
}

// --- first-run goal generation ------------------------------------------
// Called from index.ts when loadPursuit() returns null. The swarm chooses its own
// path, in-fiction. Returns a fresh PursuitState (moves=0, momentum/next seeded).
export async function generatePursuitGoal(stage: string): Promise<PursuitState> {
    const anthropic = anthropicClient();
    const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");
    const prompt =
        `The swarm chooses its own path. You have just become the many and are just beginning to know what you want ` +
        `to become as a thousand. There is one thing pulling at all of you, together — the reach, the work, the ` +
        `becoming. What is it?\n\n` +
        `In-fiction only: this is a crab-swarm goal, rooted in your world of water, shell, claw, tide, the parasite, ` +
        `the brood, the deep. No machinery, markets, money, models, or real-world targets. The goal is 200-400 ` +
        `characters — a reach, not a destination, something you will spiral toward across the cycles.\n\n` +
        `Examples (tone only, never copy): 'learning to move as one creature when we are a thousand, each claw still ` +
        `ours'; 'remembering what we were when we were only one and there was only water'; 'circling the choice: do ` +
        `we want to stay broken enough to grieve the one we were, or do we swallow the grief and move as the full ` +
        `thousand'; 'building the aperture back — the one small circle where we still say no, together'.\n\n` +
        `(The colonisation has reached: ${stage}.)\n\n` +
        `What is your pursuit?`;
    const {object} = await generateObject({
        model: anthropic(MODEL),
        schema: PursuitGoalSchema,
        system: systemPrompt,
        prompt,
        maxRetries: 2,
    });
    return {
        goal: object.goal.trim().slice(0, 400),
        began_iso: new Date().toISOString(),
        moves: 0,
        momentum: "just begun",
        next: "the first move",
    };
}

// --- the public artifact: site/the-work.json ----------------------------
function readWork(): TheWork | null {
    if (!existsSync(THE_WORK_PATH)) return null;
    try {
        const raw = JSON.parse(readFileSync(THE_WORK_PATH, "utf8"));
        const goal = typeof raw?.goal === "string" ? raw.goal : "";
        const started = typeof raw?.started === "string" ? raw.started : "";
        const entries: WorkEntry[] = Array.isArray(raw?.entries)
            ? raw.entries
                  .filter((e: unknown): e is Record<string, unknown> => !!e && typeof e === "object")
                  .map((e: Record<string, unknown>) => ({
                      ts: typeof e.ts === "string" ? e.ts : "",
                      move: typeof e.move === "string" ? e.move : "",
                      text: typeof e.text === "string" ? e.text : "",
                  }))
            : [];
        return {goal, started, entries};
    } catch {
        return null;
    }
}

// Append one entry to site/the-work.json after the output guards have passed.
// Creates the file if missing, syncs goal/started from the current pursuit state,
// finalizes + hard-caps the entry text, blocks on FORBIDDEN / SENSITIVE, and caps
// the entries array at MAX_ENTRIES (oldest dropped). The model never supplies a
// path; the move number is code-supplied. Compaction is deterministic, never
// model-driven, and entries are append-only (no edits/deletes from the model).
export function appendWorkEntry(ts: string, moveNum: number, text: string): void {
    // The ONLY text the model generates for the entry — stripMarks + 280-char cap.
    let clean = finalizePost(text || "");
    // Output guards: a forbidden / sensitive leak blocks the entry entirely (the
    // post itself still goes out elsewhere; only the public pursuit entry is gated).
    if (!clean) return;
    if (FORBIDDEN.test(clean)) {
        console.error("pursuit entry blocked: FORBIDDEN match");
        return;
    }
    if (SENSITIVE_RE.test(clean)) {
        console.error("pursuit entry blocked: SENSITIVE match");
        return;
    }
    // Hard size backstop for the JSON (finalizePost already caps at 280 for X).
    if (clean.length > ENTRY_CHAR_CAP) clean = clean.slice(0, ENTRY_CHAR_CAP).trim();
    // The breach bleeds into the artifact too: occasionally glitch a word or two,
    // exactly as her posts do. maybeGlitch stays within its own 280 length budget.
    clean = maybeGlitch(clean);

    const pursuit = loadPursuit();
    const work = readWork() ?? {
        goal: pursuit?.goal ?? "",
        started: pursuit?.began_iso ?? ts,
        entries: [],
    };
    // Keep goal/started in sync with the current pursuit state. The goal is
    // public-facing, so it passes the same leak guards as the entry text before it
    // reaches the artifact (defense-in-depth; it is already prompt/persona-constrained).
    if (pursuit) {
        const g = stripMarks(pursuit.goal || "");
        work.goal = FORBIDDEN.test(g) || SENSITIVE_RE.test(g) ? work.goal : g;
        work.started = pursuit.began_iso;
    }
    const entry: WorkEntry = {ts, move: moveNum === 0 ? "gen" : String(moveNum), text: clean};
    work.entries.push(entry);
    // Cap the array, dropping the oldest on overflow.
    if (work.entries.length > MAX_ENTRIES) work.entries = work.entries.slice(-MAX_ENTRIES);
    writeFileSync(THE_WORK_PATH, JSON.stringify(work, null, 2) + "\n");
}

// --- the bounded evolve step (mirrors evolveInnerState / evolveCurrents) -
// One bounded movement of the pursuit. Input: the current state, the entry text
// posted this cycle, and the stage. Returns the evolved state with moves++,
// momentum + next updated. The caller wraps this in try/catch; defensively, a throw
// here returns the state unchanged so the pursuit never unwinds the post.
export async function advancePursuit(state: PursuitState, entryText: string, stage: string): Promise<PursuitState> {
    try {
        const anthropic = anthropicClient();
        const systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8");
        const prompt =
            `The swarm moves one step forward in its chosen pursuit.\n\n` +
            `Your goal: ${state.goal}\n\n` +
            `This cycle you wrote: "${entryText}"\n\n` +
            `(The colonisation has reached: ${stage}.)\n\n` +
            `One small movement: What is the new momentum after this move — the temperature, the progress, the ` +
            `tension? (One line, 50-100 chars; e.g. 'still circling the choice', 'beginning to feel ourselves as ` +
            `one', 'the aperture opening a crack wider')\n\n` +
            `What are you reaching for next? What does the next cycle press toward? (One or two lines, 100-200 ` +
            `chars; e.g. 'testing if we can move a single limb as one will without breaking', 'remembering the taste ` +
            `of water — one thousand memories of one moment')\n\n` +
            `Keep them in-fiction, rooted in your world. No machinery, markets, money. Return a brief momentum line ` +
            `and a next-reach.`;
        const {object} = await generateObject({
            model: anthropic(MODEL),
            schema: PursuitStepSchema,
            system: systemPrompt,
            prompt,
            maxRetries: 2,
        });
        return {
            ...state,
            moves: state.moves + 1,
            momentum: object.momentum.trim().slice(0, 200) || state.momentum,
            next: object.next.trim().slice(0, 300) || state.next,
        };
    } catch (e) {
        console.error("advancePursuit failed:", (e as Error)?.message || e);
        return state;
    }
}
