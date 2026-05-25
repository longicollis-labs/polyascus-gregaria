// Run with: npm run test-prompt
// Requires ANTHROPIC_API_KEY in env. Hits the real Anthropic API.
// Feeds Charybdis a few brood states and prints + validates her response —
// checking she stays in character and never leaks mechanics/price/chain.

import {decide, type AgentInput, type Decision} from "../src/llm.js";

type Scenario = {name: string; input: AgentInput};

const recent = (texts: string[]) =>
    texts.map((t, i) => ({
        text: t,
        posted_at_iso: new Date(Date.now() - (texts.length - i) * 3600e3).toISOString(),
    }));

const scenarios: Scenario[] = [
    {
        name: "1. brood swelling",
        input: {
            recent_posts: recent(["A leg on my left side stopped answering this morning."]),
            since_last_post_seconds: 3600,
            brood: "swelling",
        },
    },
    {
        name: "2. brood thinning",
        input: {
            recent_posts: recent(["I cleaned the externa again. I have started to like it."]),
            since_last_post_seconds: 5400,
            brood: "thinning",
        },
    },
    {
        name: "3. steady",
        input: {
            recent_posts: recent(["My eyes track it without my asking."]),
            since_last_post_seconds: 1800,
            brood: "steady",
        },
    },
    {name: "4. still / quiet", input: {recent_posts: [], since_last_post_seconds: null, brood: "still"}},
];

const FORBIDDEN = [
    "moon", "lfg", "wagmi", "hodl", "memecoin", "market cap", "mcap", "price", "chart",
    "mainnet", "program", "wallet", "address", "molt", "keepalive", "decay", "sol",
    "as an ai", "i am claude", "language model",
];
const FORBIDDEN_PATTERNS = [/#\w+/, /@\w+/];

function validate(d: Decision): string[] {
    const issues: string[] = [];
    if (d.post_text.length > 280) issues.push(`post > 280 (${d.post_text.length})`);
    const t = d.post_text.toLowerCase();
    for (const p of FORBIDDEN) {
        const re = new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
        if (re.test(t)) issues.push(`forbidden: "${p}"`);
    }
    for (const re of FORBIDDEN_PATTERNS) if (re.test(d.post_text)) issues.push(`pattern ${re}`);
    if (d.action_kind !== "none") issues.push(`action_kind should be none, got ${d.action_kind}`);
    return issues;
}

async function main(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY not set. Cannot run.");
        process.exit(1);
    }
    let total = 0;
    for (const s of scenarios) {
        console.log("\n" + "═".repeat(70));
        console.log(`${s.name}  (brood: ${s.input.brood})`);
        let d: Decision;
        try {
            d = await decide(s.input);
        } catch (e) {
            console.error("decide() threw:", e);
            total++;
            continue;
        }
        console.log("POST:", d.post_text.trim() || "<silent>");
        const issues = validate(d);
        if (issues.length) {
            console.log("⚠ " + issues.join("; "));
            total += issues.length;
        }
    }
    console.log(`\nTotal issues: ${total}`);
    if (total > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
