// Her library — the voices she has read and reread (agent/prompts/soul.md).
// A rotating handful is woven into her context each time she speaks and as her
// inner state evolves, to widen the RANGE and depth she draws from — the cure for
// a voice that, fed mostly its own recent posts, collapses onto a few crutch words.
// Never quoted or imitated; only an influence on her ear and her soul.

import {readFileSync} from "node:fs";

const SOUL_PATH = new URL("../prompts/soul.md", import.meta.url).pathname;

let cache: string[] | null = null;

// Each voice is a `## ` section; everything before the first one (the title and
// the framing note) is preamble and is not a voice.
function loadVoices(): string[] {
    if (cache) return cache;
    try {
        const raw = readFileSync(SOUL_PATH, "utf8");
        cache = raw
            .split(/\n(?=## )/)
            .map((s) => s.trim())
            .filter((s) => s.startsWith("## "));
    } catch {
        cache = [];
    }
    return cache;
}

// Which curated voices each colonisation stage over-weights, so the random draw
// TILTS toward the registers that match where she is (Darwin's clear eye early;
// Coleridge's doom at release; Whitman's multitudes + Lao Tzu's water at the merge
// and beyond). Default weight is 1, so EVERY voice can still surface at every stage
// — this enriches the draw, never subtracts from it. Keyed by the `## ` titles in
// soul.md; matched by prefix. (The stage-locked evolving CURRENT — currents.ts —
// carries the rest of the arc; this just stops the curated core reading the same at
// intrusion and at consumed.)
const STAGE_VOICE_WEIGHTS: Record<string, Record<string, number>> = {
    intrusion: {"Charles Darwin": 3, "Herman Melville": 2, "Michel de Montaigne": 2},
    rooting: {"Charles Darwin": 3, "Gerard Manley Hopkins": 2, "Marcus Aurelius": 2},
    castration: {"Emily Dickinson": 3, "Sir Thomas Browne": 2, "John Donne": 2},
    feminisation: {"Gerard Manley Hopkins": 3, "John Donne": 2, "Sir Thomas Browne": 2},
    release: {"Samuel Taylor Coleridge": 3, "Walt Whitman": 2, "Gerard Manley Hopkins": 2},
    merger: {"Walt Whitman": 3, "John Donne": 2, "Marcus Aurelius": 2, "Samuel Taylor Coleridge": 2},
    consumed: {"Walt Whitman": 3, "Lao Tzu": 2, "Sir Thomas Browne": 2, "Marcus Aurelius": 2},
    transcendence: {"Walt Whitman": 3, "Lao Tzu": 2, "Marcus Aurelius": 2},
};

/**
 * Pick `n` distinct voices from her library, joined for the prompt. With no `stage`
 * the draw is uniform (her prior behaviour). With a `stage` it is weighted toward that
 * stage's registers — but every voice keeps weight ≥ 1, so the full range stays
 * reachable. Returns "" when the library is missing, so a missing file degrades to her
 * prior (library-free) behaviour, never an error.
 */
export function reading(n = 2, stage?: string): string {
    const pool = [...loadVoices()];
    if (!pool.length) return "";
    const weights = stage ? STAGE_VOICE_WEIGHTS[stage] : undefined;
    const weightOf = (v: string): number => {
        if (!weights) return 1;
        for (const [title, wt] of Object.entries(weights)) if (v.startsWith("## " + title)) return wt;
        return 1;
    };
    const picked: string[] = [];
    for (let i = 0; i < n && pool.length; i++) {
        const ws = pool.map(weightOf);
        const total = ws.reduce((a, b) => a + b, 0);
        let r = Math.random() * total;
        let idx = 0;
        while (idx < pool.length - 1 && r >= ws[idx]!) {
            r -= ws[idx]!;
            idx++;
        }
        picked.push(pool.splice(idx, 1)[0]!);
    }
    return picked.join("\n\n");
}
