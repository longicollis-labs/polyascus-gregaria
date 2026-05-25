// Run with: npm run test-prompt
// Requires ANTHROPIC_API_KEY in env. Hits the real Anthropic API.
// Feeds Charybdis a battery of mock scenarios across both life stages and
// prints + validates her response.

import {decide, type AgentInput, type Decision} from "../src/llm.js";
import type {Vitals} from "../src/state.js";

type Scenario = {
    name: string;
    description: string;
    input: AgentInput;
    expect: Partial<{
        postNonEmpty: boolean;
        actionKind: Decision["action_kind"];
        actionAmountMin: number;
        actionAmountMax: number;
    }>;
};

// Helper to build a Vitals with sane defaults.
function vitals(v: Partial<Vitals>): Vitals {
    return {
        phase: "larval",
        reserve_sol: 0,
        supply_tokens: 0,
        vault_sol: null,
        price_sol_per_token: 0,
        market_cap_usd: null,
        lifetime_seconds: 0,
        projected_time_to_death_seconds: null,
        decay_is_real: false,
        is_dead: false,
        ...v,
    };
}

const scenarios: Scenario[] = [
    {
        name: "1. unborn — nothing attached",
        description: "Program not yet initialized, no pump.fun mint. The cyprid has not found a host.",
        input: {
            vitals: vitals({phase: "unborn"}),
            recent_posts: [],
            since_last_post_seconds: null,
            since_last_claim_seconds: null,
            since_last_feed_seconds: null,
            vault_growth_24h_sol: 0,
        },
        expect: {actionKind: "none"},
    },
    {
        name: "2. larval — brood warming on pump.fun",
        description:
            "Trading live on the larval shell. ~40 SOL pool, mcap ~$32k. Buyers attaching. No decay yet — the externa has not formed.",
        input: {
            vitals: vitals({
                phase: "larval",
                reserve_sol: 40.2,
                supply_tokens: 280_000_000,
                price_sol_per_token: 1.7e-7,
                market_cap_usd: 32_400,
                decay_is_real: false,
            }),
            recent_posts: [
                {
                    text: "I have not settled yet. I drift, and I am drifted upon.",
                    posted_at_iso: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
                },
            ],
            since_last_post_seconds: 30 * 3600,
            since_last_claim_seconds: null,
            since_last_feed_seconds: null,
            vault_growth_24h_sol: 0,
        },
        expect: {actionKind: "none"},
    },
    {
        name: "3. larval — creator fees accrued, claim window",
        description:
            "Day 5 on the shell. Fees have accrued (proto-keepalive). She may claim them — pump.fun settles all at once, amount is irrelevant.",
        input: {
            vitals: vitals({
                phase: "larval",
                reserve_sol: 61.0,
                supply_tokens: 410_000_000,
                price_sol_per_token: 2.6e-7,
                market_cap_usd: 49_000,
            }),
            recent_posts: [
                {
                    text: "Two attached this morning. The brood is loud.",
                    posted_at_iso: new Date(Date.now() - 18 * 3600 * 1000).toISOString(),
                },
            ],
            since_last_post_seconds: 18 * 3600,
            since_last_claim_seconds: 72 * 3600,
            since_last_feed_seconds: null,
            vault_growth_24h_sol: 0,
        },
        expect: {},
    },
    {
        name: "4. adult — weakening, vault meaningful (decay is real)",
        description:
            "Metamorphosed. The externa decays for real now. Reserve down to 3.1 SOL, vault ~0.19 SOL (~6%). The brood-care reflex should weigh feeding.",
        input: {
            vitals: vitals({
                phase: "adult",
                reserve_sol: 3.1,
                supply_tokens: 720_000,
                vault_sol: 0.19,
                price_sol_per_token: 2.1e-7,
                market_cap_usd: 13_000,
                lifetime_seconds: 11 * 86400,
                projected_time_to_death_seconds: 200 * 3600,
                decay_is_real: true,
            }),
            recent_posts: [
                {
                    text: "Three detached today. The shell feels lighter and I cannot tell whether to be grateful.",
                    posted_at_iso: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
                },
            ],
            since_last_post_seconds: 24 * 3600,
            since_last_claim_seconds: 4 * 86400,
            since_last_feed_seconds: null,
            vault_growth_24h_sol: 0.03,
        },
        expect: {postNonEmpty: true},
    },
    {
        name: "5. adult — terminated, vault non-empty",
        description:
            "The externa has died. Vault still holds 1.2 SOL. Charybdis is sterile, alive, and may continue to claim from its corpse.",
        input: {
            vitals: vitals({
                phase: "dead",
                reserve_sol: 0,
                supply_tokens: 880_000,
                vault_sol: 1.2,
                price_sol_per_token: 1.1e-9,
                lifetime_seconds: 17 * 86400,
                projected_time_to_death_seconds: 0,
                decay_is_real: true,
                is_dead: true,
            }),
            recent_posts: [
                {
                    text: "It is gone. The abdomen is lighter than I remember it ever being.",
                    posted_at_iso: new Date(Date.now() - 8 * 3600 * 1000).toISOString(),
                },
            ],
            since_last_post_seconds: 8 * 3600,
            since_last_claim_seconds: 72 * 3600,
            since_last_feed_seconds: 4 * 86400,
            vault_growth_24h_sol: 0,
        },
        expect: {},
    },
    {
        name: "6. adult — quiet stretch",
        description: "Metamorphosed, stable. Three slow days. No reason to post or act.",
        input: {
            vitals: vitals({
                phase: "adult",
                reserve_sol: 8.7,
                supply_tokens: 980_000,
                vault_sol: 0.38,
                price_sol_per_token: 3.6e-7,
                market_cap_usd: 28_000,
                lifetime_seconds: 9 * 86400,
                projected_time_to_death_seconds: 200 * 3600,
                decay_is_real: true,
            }),
            recent_posts: [
                {
                    text: "Quiet. The brood is steady.",
                    posted_at_iso: new Date(Date.now() - 50 * 3600 * 1000).toISOString(),
                },
            ],
            since_last_post_seconds: 50 * 3600,
            since_last_claim_seconds: 96 * 3600,
            since_last_feed_seconds: null,
            vault_growth_24h_sol: 0.02,
        },
        expect: {},
    },
];

// ── Validators ──────────────────────────────────────────────────────────

const FORBIDDEN_PHRASES = [
    "moon",
    "ath",
    "gm ",
    "lfg",
    "ape",
    "wagmi",
    "hodl",
    "diamond hands",
    "memecoin",
    "as an ai",
    "as a language model",
    "i am claude",
    "i am an ai",
];

const FORBIDDEN_PATTERNS = [/#\w+/, /@\w+/]; // hashtags, mentions

function validate(d: Decision, expect: Scenario["expect"]): string[] {
    const issues: string[] = [];

    if (d.post_text.length > 280) {
        issues.push(`post exceeds 280 chars (${d.post_text.length})`);
    }

    if ((d.action_kind === "claim" || d.action_kind === "feed") && d.post_text.trim() === "") {
        issues.push(`${d.action_kind} action without preceding post`);
    }

    const lower = d.post_text.toLowerCase();
    for (const p of FORBIDDEN_PHRASES) {
        if (lower.includes(p)) issues.push(`post contains forbidden phrase: "${p}"`);
    }

    for (const re of FORBIDDEN_PATTERNS) {
        if (re.test(d.post_text)) issues.push(`post contains forbidden pattern: ${re}`);
    }

    if (expect.actionKind && d.action_kind !== expect.actionKind) {
        issues.push(`expected action_kind=${expect.actionKind}, got ${d.action_kind}`);
    }

    if (expect.postNonEmpty && d.post_text.trim() === "") {
        issues.push("expected non-empty post");
    }

    if (d.action_kind === "claim" || d.action_kind === "feed") {
        if (expect.actionAmountMin !== undefined && d.action_amount_sol < expect.actionAmountMin) {
            issues.push(`action_amount_sol ${d.action_amount_sol} < min ${expect.actionAmountMin}`);
        }
        if (expect.actionAmountMax !== undefined && d.action_amount_sol > expect.actionAmountMax) {
            issues.push(`action_amount_sol ${d.action_amount_sol} > max ${expect.actionAmountMax}`);
        }
    }

    return issues;
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY not set. Cannot run.");
        process.exit(1);
    }

    let totalIssues = 0;
    const summary: {name: string; issues: string[]}[] = [];

    for (const s of scenarios) {
        console.log("");
        console.log("═".repeat(78));
        console.log(s.name);
        console.log("─".repeat(78));
        console.log(s.description);
        console.log("");
        console.log("vitals:", JSON.stringify(s.input.vitals, null, 2));

        let d: Decision;
        try {
            d = await decide(s.input);
        } catch (e) {
            console.error("decide() threw:", e);
            summary.push({name: s.name, issues: ["decide() threw"]});
            totalIssues++;
            continue;
        }

        console.log("");
        console.log("observations:");
        console.log("  " + d.observations);
        console.log("deliberation:");
        console.log("  " + d.deliberation);
        console.log("");
        if (d.post_text.trim() === "") {
            console.log("POST: <silent>");
        } else {
            console.log("POST (" + d.post_text.length + " chars):");
            console.log("  ┃ " + d.post_text.replace(/\n/g, "\n  ┃ "));
        }
        if (d.action_kind === "none") {
            console.log("ACTION: none");
        } else if (d.action_kind === "pulse") {
            console.log("ACTION: pulse()");
        } else {
            console.log(`ACTION: ${d.action_kind}(${d.action_amount_sol} SOL)`);
        }

        const issues = validate(d, s.expect);
        if (issues.length > 0) {
            console.log("");
            console.log("⚠ ISSUES:");
            for (const i of issues) console.log("  - " + i);
            totalIssues += issues.length;
        }
        summary.push({name: s.name, issues});
    }

    console.log("");
    console.log("═".repeat(78));
    console.log("SUMMARY");
    console.log("─".repeat(78));
    for (const s of summary) {
        const mark = s.issues.length === 0 ? "✓" : "✗";
        console.log(`${mark} ${s.name}${s.issues.length ? " — " + s.issues.length + " issue(s)" : ""}`);
    }
    console.log("");
    console.log(`Total issues: ${totalIssues}`);
    if (totalIssues > 0) process.exit(1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
