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

/**
 * Pick `n` distinct voices from her library, at random, joined for the prompt.
 * Returns "" when the library is missing — the caller then adds no reading block,
 * so a missing file degrades to her prior (library-free) behaviour, never an error.
 */
export function reading(n = 2): string {
    const pool = [...loadVoices()];
    if (!pool.length) return "";
    const picked: string[] = [];
    for (let i = 0; i < n && pool.length; i++) {
        picked.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]!);
    }
    return picked.join("\n\n");
}
