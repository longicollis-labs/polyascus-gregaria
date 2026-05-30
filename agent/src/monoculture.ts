// Construction-monoculture detection — shared by the inner-state evolve (inner.ts)
// and the language-currents evolve (currents.ts). Both are "keep almost everything"
// ratchets with no restoring force on FORM: left alone, once a single sentence-
// construction spreads across most of a state's fields it becomes a self-reinforcing
// fixed point — each evolve reads the frame-saturated state and faithfully reproduces
// it, so the text generated from it reads as near-duplicates. We detect a construction
// spread across a majority of the fields — frame-AGNOSTIC (any phrase, never a vocab
// ban) and STRICT (a content phrase across most fields only happens in a real
// monoculture) — so the caller can withhold it from what the model is shown and name
// it dead. A varied state never trips it.
//
// Extracted verbatim from inner.ts so a second consumer reuses it without a copy. The
// only change: wornConstruction/surfaceForm take the already-flattened string[] fields
// instead of a typed state, so any shaped state works — each caller supplies its own
// field flattener (inner.ts: stateFields; currents.ts: currentsFields).

// Function words. A 2-gram of only these is grammar, not a construction (e.g.
// "i am", "of the"), so we never flag ordinary phrasing or first-person voice; a
// 2-gram with at least one content word can be a worn frame.
const STOPWORDS = new Set(
    ("a an the and or but if then so as of to in on at by for with from into onto over under is am are was were be been being it its this that these those i me my mine we us our you your he she they them his her their him not no nor do does did has have had will would can could should may might must now here there what which who whom when where why how than too very just only also even still yet about up out off down again once each").split(/\s+/),
);

// Collapse common English inflections to a shared stem so a frame whose invariant
// is a verb LEMMA — "X is learning to" / "learns to" / "learned to" — is counted
// as ONE construction instead of splitting across distinct bigrams. Deliberately
// light — suffix + silent-e only, not a full lemmatiser.
export function stem(w: string): string {
    if (w.length > 4 && w.endsWith("ing")) w = w.slice(0, -3);
    else if (w.length > 3 && w.endsWith("ed")) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("es")) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
    if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
    return w;
}

// The worn construction spread across the most distinct fields, if it saturates a
// majority of them — else null. We scan 3-word phrases AND content-bearing 2-word
// phrases: a frame like "X is learning to Y" keeps the 2-gram ("learning to")
// constant while its surrounding 3-grams vary by subject, so a 3-gram-only scan
// stays blind to it. A 2-gram carrying at least one content word, across a majority
// of fields, is that monoculture caught reliably and early; pure function-word
// 2-grams are skipped so ordinary grammar is never flagged. Tokens are stemmed first
// (learning/learns/learned → learn) so a frame carried by a verb lemma counts as one
// construction even as its tense varies; stopword-ness is judged on the original
// token so stemming never hides grammar words. The highest-span phrase is taken — in
// a real frame the worn 2-gram outspans any single 3-gram, so it is named and stripped.
export function wornConstruction(fields: string[]): string | null {
    if (fields.length < 5) return null;
    const span = new Map<string, Set<number>>();
    fields.forEach((f, i) => {
        const raw = f.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
        const w = raw.map(stem); // gram keys use stems so inflections of a frame merge
        const isStop = (k: number) => STOPWORDS.has(raw[k]!); // judge on the original token
        const seen = new Set<string>();
        for (let k = 0; k + 2 < w.length; k++) seen.add(`${w[k]} ${w[k + 1]} ${w[k + 2]}`);
        for (let k = 0; k + 1 < w.length; k++) {
            if (!isStop(k) || !isStop(k + 1)) seen.add(`${w[k]} ${w[k + 1]}`);
        }
        for (const g of seen) {
            let set = span.get(g);
            if (!set) span.set(g, (set = new Set()));
            set.add(i);
        }
    });
    const threshold = Math.max(5, Math.ceil(fields.length * 0.6));
    let best: string | null = null;
    let bestN = 0;
    for (const [g, idxs] of span) {
        if (idxs.size > bestN) {
            bestN = idxs.size;
            best = g;
        }
    }
    return bestN >= threshold ? best : null;
}

// Tolerant pattern for the worn phrase (markdown / punctuation between words, and
// the inflections the stem stripped — so the stem "learn to" also catches "learning
// to" / "learned to"). Re-allow a suffix only on content words (len ≥ 3) so short
// grammar words still match exactly.
export function wornPattern(worn: string): string {
    return worn
        .split(" ")
        .map((w) => {
            const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return w.length >= 3 ? esc + "\\w*" : esc;
        })
        .join("\\W+");
}

// A readable instance of the worn phrase pulled from the real fields — the stem
// ("learn to") is for matching; this is what we name in the evolve prompt.
export function surfaceForm(fields: string[], pat: string): string {
    const re = new RegExp(pat, "i");
    for (const f of fields) {
        const m = f.match(re);
        if (m) return m[0].toLowerCase().replace(/\s+/g, " ");
    }
    return "";
}

// Content-word n-grams of a string (stemmed, with all-stopword grams dropped). Used
// by the currents crutch-guard to ask "does this register cue echo a recent post
// (shared 2-gram) or leak a curated quote (shared 3-gram)?" — the same tokenisation
// the monoculture scan uses, so the two guards agree on what counts as a phrase.
export function contentNgrams(s: string, n: number): Set<string> {
    const raw = s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
    const w = raw.map(stem);
    const out = new Set<string>();
    for (let k = 0; k + n - 1 < w.length; k++) {
        let allStop = true;
        for (let j = 0; j < n; j++) if (!STOPWORDS.has(raw[k + j]!)) allStop = false;
        if (allStop) continue;
        out.add(w.slice(k, k + n).join(" "));
    }
    return out;
}

export const STALE_CUE = "«this line wore smooth — rewrite it fresh: new grammar, rhythm, and images»";
