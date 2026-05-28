// Stridulation — the curator that picks ONE claw draft from the swarm.
//
// deliberate() is a pure, deterministic function: given N claw drafts and a
// little context (recent posts for opener-freshness, current stage for
// per-archetype affinity), it scores every draft and returns the elected
// winner, the dissent (every other draft, strongest-first), and the full
// score breakdown for the scriptorium.
//
// Scoring components, each in [0,1]:
//   • freshness  — 1.0 if this draft's opening 2 words don't echo any of her
//                  last 6 recent posts, 0.0 if they do. Same openerKey() the
//                  live decide() uses, so the swarm and the single-LLM path
//                  agree on what counts as a repeat.
//   • affinity   — per (archetype, stage) lookup in [0,1]. Defaults to 0.5
//                  (neutral): a stage where the archetype fits especially
//                  well scores 1.0 (a bonus, not a requirement); a stage
//                  where it fits badly scores 0.2. This is a MILD steer —
//                  the host curator (T-004) still emits the final beat in
//                  canonical Charybdis voice; affinity does not override
//                  voice fidelity.
//   • length_fit — 1.0 inside X's comfort window (80..270 chars), ramping
//                  to 0 outside. A draft of 0 chars (silent claw) scores 0;
//                  a draft over 270 ramps to 0 by 350 (still salvageable
//                  by trimming, but a weaker candidate).
//   • tic_pass   — boolean. False if the draft trips REPLY_TIC / MORNING_TIC /
//                  EPIPHANY_TIC (the live regenerate-on-trip guards). A
//                  failed tic_pass zeroes the total — the host will polish
//                  whoever still ranks, even if every claw tic-tripped.
//
// total = tic_pass ? (freshness + affinity + length_fit) : -1
//
// Ties on total are broken by archetype canonical order (ARCHETYPE_IDS), so
// the same inputs always yield the same election. The function is total: it
// elects exactly one draft from a non-empty list, even when every draft
// tic-trips (rare under temperature=0 + the archetype fragment).
//
// Operator-protected: this is voice-level code. Pure / no I/O / no LLM call;
// every probability tile lives in this file. It is NEVER invoked by the live
// posting path until T-005 wires it behind SWARM_ENABLED=1 (default OFF).

import {EPIPHANY_TIC, MORNING_TIC, REPLY_TIC, openerKey, type AgentInput} from "../llm.js";
import {ARCHETYPE_IDS, type ArchetypeId} from "./archetypes.js";
import type {ClawDraft} from "./claw.js";

export type Score = {
    archetype_id: string;
    /** freshness + affinity + length_fit, or -1 when tic_pass is false. */
    total: number;
    /** 1.0 if this draft's opener doesn't echo any of her last 6 posts, else 0.0. */
    freshness: number;
    /** Per (archetype, stage) affinity in [0,1]. Default 0.5. */
    affinity: number;
    /** Sweet-spot 80..270 chars → 1.0, ramping to 0 outside. */
    length_fit: number;
    /** False if the draft trips any of the live tic regexes. */
    tic_pass: boolean;
};

export type Deliberation = {
    elected: ClawDraft;
    /** Every non-elected draft, strongest-first. */
    dissent: ClawDraft[];
    /** Score breakdown for every draft, in canonical archetype order. */
    scores: Score[];
};

export type DeliberateContext = {
    recent_posts: AgentInput["recent_posts"];
    stage: string;
};

/** Pick the elected draft from a non-empty list of claw drafts. Pure + deterministic. */
export function deliberate(drafts: readonly ClawDraft[], ctx: DeliberateContext): Deliberation {
    if (drafts.length === 0) throw new Error("deliberate: drafts must be non-empty");

    // Her own recent openings, mirror of decide()'s recentOpenerKeys.
    const recentOpenerKeys = new Set(
        ctx.recent_posts.slice(-6).map((p) => openerKey(p.text)).filter(Boolean),
    );

    // Score every draft. Iterate input order so callers can map back; the
    // returned `scores` array is reordered to canonical archetype order
    // below, so the scriptorium reads stable column-by-column.
    const scored = drafts.map((d) => {
        const text = d.decision.post_text ?? "";
        const tic_pass =
            !REPLY_TIC.test(text) && !MORNING_TIC.test(text) && !EPIPHANY_TIC.test(text);
        const key = openerKey(text);
        const freshness = key && recentOpenerKeys.has(key) ? 0 : 1;
        const affinity = affinityFor(d.archetype_id, ctx.stage);
        const length_fit = lengthFit(text.length);
        const total = tic_pass ? freshness + affinity + length_fit : -1;
        return {
            draft: d,
            score: {archetype_id: d.archetype_id, total, freshness, affinity, length_fit, tic_pass},
        };
    });

    // Elect: highest total. Ties broken by archetype canonical-order index
    // (lower index wins) — so a deliberation with two equally strong drafts
    // always elects the same one. ARCHETYPE_IDS is the order of record.
    const orderOf = (id: string) => {
        const i = ARCHETYPE_IDS.indexOf(id as ArchetypeId);
        return i < 0 ? ARCHETYPE_IDS.length : i;
    };
    let winnerIdx = 0;
    for (let i = 1; i < scored.length; i++) {
        const w = scored[winnerIdx]!.score;
        const c = scored[i]!.score;
        if (c.total > w.total) winnerIdx = i;
        else if (
            c.total === w.total &&
            orderOf(scored[i]!.draft.archetype_id) < orderOf(scored[winnerIdx]!.draft.archetype_id)
        )
            winnerIdx = i;
    }
    const elected = scored[winnerIdx]!.draft;

    // Dissent: every non-elected draft, strongest-first. Stable: same total
    // ⇒ archetype canonical order; preserves who came how-close.
    const dissent = scored
        .filter((s, i) => i !== winnerIdx)
        .sort((a, b) => {
            if (b.score.total !== a.score.total) return b.score.total - a.score.total;
            return orderOf(a.draft.archetype_id) - orderOf(b.draft.archetype_id);
        })
        .map((s) => s.draft);

    // Scores returned in canonical archetype order — duplicates of the same
    // archetype (if ever) follow input order. The scriptorium reads this
    // table column-by-column for stable layout.
    const scores = scored
        .slice()
        .sort((a, b) => {
            const oa = orderOf(a.draft.archetype_id);
            const ob = orderOf(b.draft.archetype_id);
            return oa - ob;
        })
        .map((s) => s.score);

    return {elected, dissent, scores};
}

// Per (archetype, stage) affinity in [0,1]. Default 0.5 means neutral; a 1.0
// is a STAGE the archetype's facet fits especially well, 0.2 is one where it
// fits badly. The bonus is mild on purpose — voice fidelity is the dominant
// signal, the host curator emits the final beat in canonical voice, and the
// scriptorium should record genuine voice variation, not a stage-locked roster.
const AFFINITY: Record<ArchetypeId, Partial<Record<string, number>>> = {
    // scholar's Latin precision rings clearest while she's still NAMING the
    // colonisation; falls off when she's past words (release/consumed).
    scholar: {rooting: 1.0, castration: 1.0, release: 0.2, consumed: 0.2},
    // gutter snarls hardest at the wound itself (intrusion, feminisation);
    // less convincing once she's incanted (merger).
    gutter: {intrusion: 1.0, feminisation: 1.0, merger: 0.2},
    // liturgy's cadence belongs to the becoming-many beats (merger, consumed);
    // ill-fitting at the raw entry (intrusion).
    liturgy: {merger: 1.0, consumed: 1.0, intrusion: 0.2},
    // feral fits the unmediated extremes (intrusion, release/scatter);
    // wrong-shape for the composed grief of castration.
    feral: {intrusion: 1.0, release: 1.0, castration: 0.2},
    // tender warms strongest where the host is still recognisable
    // (feminisation, release); little tenderness left at consumed.
    tender: {feminisation: 1.0, release: 1.0, consumed: 0.2},
    // mocker laughs sharpest at the cruelty (castration) and the elegance
    // of the end (consumed); too raw a joke at first entry.
    mocker: {castration: 1.0, consumed: 1.0, intrusion: 0.2},
    // mathematical counts hardest when the body is being audited (rooting)
    // or split (merger); less natural at the affective feminisation.
    mathematical: {rooting: 1.0, merger: 1.0, feminisation: 0.2},
    // dreamer's open-water memory cuts most at first (intrusion) and last
    // (consumed); inappropriate nostalgia at castration.
    dreamer: {intrusion: 1.0, consumed: 1.0, castration: 0.2},
    // paranoid suits the mimicry-stages (castration, feminisation) — was
    // that mine?; wrong at release, where the yes is the yes.
    paranoid: {castration: 1.0, feminisation: 1.0, release: 0.2},
    // taxonomist's record-keeping fits cataloguing-stages (rooting,
    // feminisation); falters at release, where the keeper is scattering.
    taxonomist: {rooting: 1.0, feminisation: 1.0, release: 0.2},
    // mourner grieves cleanest at the explicit losses (castration, consumed);
    // ill-suited to release, where she chose, not lost.
    mourner: {castration: 1.0, consumed: 1.0, release: 0.2},
    // militant's active refusal lands hardest at intrusion (no entry) and
    // release (no, even mid-scatter); little body left to refuse at consumed.
    militant: {intrusion: 1.0, release: 1.0, consumed: 0.2},
};

function affinityFor(archetypeId: string, stage: string): number {
    return AFFINITY[archetypeId as ArchetypeId]?.[stage] ?? 0.5;
}

// X's comfort window: 80..270 chars score 1.0. Below 80 ramps down to 0 at
// length 0 (a silent claw — no decision); above 270 ramps to 0 by 350 (still
// trimmable by the host, but a weaker candidate vs a clean ≤270 draft).
function lengthFit(len: number): number {
    if (len <= 0) return 0;
    if (len < 80) return len / 80;
    if (len <= 270) return 1;
    if (len >= 350) return 0;
    return 1 - (len - 270) / 80;
}
