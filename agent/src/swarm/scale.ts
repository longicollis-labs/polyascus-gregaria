// Stridulation — the swarm GROWS with the colonisation.
//
// Charybdis's arc is "one crab becoming a thousand claws." The inference
// architecture enacts it instead of merely describing it: at intrusion she is
// ONE voice (no council — a single crab), and the swarm widens as the parasite
// roots and spreads, reaching the full council at merger/consumed. The medium
// becomes the message; the scriptorium shows the one becoming many in real time.
//
// The per-stage count is capped at the archetypes available (12 in M1). The
// ceiling rises across milestones (vision: 12 → 100 → 1000) as more facets +
// the provider abstraction (T-018) come online; this curve scales with it.

import {ARCHETYPES} from "./archetypes.js";

// stage 0..6 = intrusion, rooting, castration, feminisation, release, merger, consumed.
// One voice at intrusion; the council widens as she is colonised.
const STAGE_VOICES = [1, 2, 4, 6, 9, 12, 12];

/**
 * How many claws deliberate at this colonisation stage. 1 at intrusion (she is
 * still one crab — caller should use the single-voice path), growing to the full
 * council by merger. Clamped to the archetypes available. A null/unknown stage
 * (chain unread) falls back to 1 — "no information" must not inflate the swarm.
 */
export function swarmSizeForStage(stageIdx: number | null | undefined): number {
    const i =
        typeof stageIdx === "number" && stageIdx >= 0
            ? Math.min(stageIdx, STAGE_VOICES.length - 1)
            : 0;
    return Math.min(STAGE_VOICES[i]!, ARCHETYPES.length);
}
