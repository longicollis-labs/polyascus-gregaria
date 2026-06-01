// Occasional textual corruption for her posts — the swarm/breach bleeding into the
// text itself. Now and then a post comes through with one or two words "glitched"
// with Unicode combining marks (the Zalgo effect: s̵̘͉̳̏̈́͑ͅw̷̨̫̼͆a̸̻̠̤̋̂͛r̷̨̭̗̗̾̓̓m̴̡̮͋̽̆̈́̚).
//
// Tuned to read like a corrupted word, not full illegible static — a few marks above,
// a couple below, often an overlay strike, on each letter of the chosen word(s).
// BUDGETED: every combining mark counts toward X's 280-char limit, so a glitch that
// would push the post over 280 is dropped and the clean post ships instead. Applied to
// POSTS only (index.ts, before posting) — replies and comments are left untouched.
//
// Math.random is fine here (agent runtime, not a workflow sandbox); the corruption is
// meant to vary post to post.

const fromCps = (cps: number[]): string[] => cps.map((c) => String.fromCharCode(c));

// Curated combining marks by zone — chosen to render the "corrupted" look across X /
// most clients rather than the rarer marks that show as tofu.
const ABOVE = fromCps([
    0x0300, 0x0301, 0x0302, 0x0303, 0x0304, 0x0305, 0x0306, 0x0307, 0x0308, 0x030a,
    0x030b, 0x030c, 0x030d, 0x030e, 0x030f, 0x0310, 0x0311, 0x0312, 0x0313, 0x0314,
    0x033d, 0x033e, 0x0342, 0x0344, 0x0346, 0x034a, 0x034b, 0x034c, 0x0350, 0x0351,
    0x0357, 0x035b,
]);
const BELOW = fromCps([
    0x0316, 0x0317, 0x0318, 0x0319, 0x031c, 0x031d, 0x031e, 0x031f, 0x0320, 0x0323,
    0x0324, 0x0325, 0x0326, 0x0329, 0x032a, 0x032b, 0x032c, 0x032d, 0x032e, 0x0330,
    0x0331, 0x0332, 0x0333, 0x0339, 0x033a, 0x033b, 0x033c, 0x0345, 0x0347, 0x0348,
    0x0349, 0x034d, 0x034e, 0x0353, 0x0354, 0x0355, 0x0356, 0x0359, 0x035a,
]);
const OVERLAY = fromCps([0x0334, 0x0335, 0x0336, 0x0337, 0x0338]); // strikes / slashes

const GLITCH_RATE = Number(process.env.GLITCH_RATE ?? "0.9"); // fraction of posts that get a glitch — almost every one, not all
const MAX_LEN = 280; // X hard limit; combining marks each count toward it

const ri = (n: number): number => Math.floor(Math.random() * n);
const pick = <T>(a: T[]): T => a[ri(a.length)]!;

// Hang a moderate cluster of combining marks off each letter of a word.
function corrupt(word: string): string {
    let out = "";
    for (const ch of word) {
        out += ch;
        if (!/[A-Za-z]/.test(ch)) continue; // marks only on letters
        const nUp = 1 + ri(2); // 1–2 above
        const nDown = 1 + ri(2); // 1–2 below
        const nOver = Math.random() < 0.6 ? 1 : 0; // ~60% get an overlay strike
        for (let i = 0; i < nUp; i++) out += pick(ABOVE);
        for (let i = 0; i < nDown; i++) out += pick(BELOW);
        for (let i = 0; i < nOver; i++) out += pick(OVERLAY);
    }
    return out;
}

// Occasionally corrupt 1–2 words of a post. Eligible words are runs of >=4 letters, so
// small words ("we", "is", "a") stay clean and the corruption lands on something with
// weight. Returns the text unchanged when it doesn't fire, when there's nothing
// eligible, or when the corrupted result would exceed X's 280-char budget.
export function maybeGlitch(text: string, rate = GLITCH_RATE): string {
    if (!text || Math.random() >= rate) return text;
    const matches = [...text.matchAll(/[A-Za-z]{4,}/g)];
    if (!matches.length) return text;

    // Mostly one word; sometimes two when there's more than one to choose from.
    const want = matches.length > 1 && Math.random() < 0.35 ? 2 : 1;
    const chosen = new Set<number>();
    while (chosen.size < Math.min(want, matches.length)) chosen.add(ri(matches.length));

    let out = "";
    let cursor = 0;
    matches.forEach((m, i) => {
        if (!chosen.has(i)) return; // copied as part of the next gap / the final slice
        const start = m.index!;
        out += text.slice(cursor, start) + corrupt(m[0]);
        cursor = start + m[0].length;
    });
    out += text.slice(cursor);

    // Combining marks count toward the 280 limit — if we blew the budget, ship clean.
    if ([...out].length > MAX_LEN) return text;
    return out;
}
