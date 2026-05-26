// Paces Charybdis to an organic, randomised ~20–25 min cadence — but fires
// immediately when the colonisation advances a stage, so feeders see her react.
//
// Run every ~5 min by the Render cron. Each run it reads her committed log and
// the on-chain stage, then dispatches the agent workflow when EITHER a
// *randomised* 20–25 min has passed since her last real post ("when she feels
// like it") OR the on-chain stage is now deeper than the last one she recorded.
//
// The log is read from raw.githubusercontent (public, no token) first, with the
// authenticated contents API as fallback. If BOTH fail we HOLD — a failed read
// must never trigger a post (that caused 5-min spam before). The dispatch POST
// needs GH_TOKEN (repo/actions scope); SOLANA_RPC_URL optional.

import {readFileSync} from "node:fs";

// GATE_ONLY: just decide and exit — 0 = post now, 3 = hold — WITHOUT dispatching
// the GitHub Actions workflow. Used when the host (Render) runs the cycle itself
// (render-tick.sh) instead of relying on Actions, which removes the dependency on
// the flaky workflow_dispatch endpoint. In this mode the log is read LOCALLY
// (the host has just git-pulled it), so there is no CDN lag and no double-dispatch
// window — the run-history cooldown below is dispatch-mode only.
const GATE_ONLY = process.env.GATE_ONLY === "1";
const REPO = "longicollis-labs/polyascus-gregaria";
const RPC = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const INFECTION_PDA = "6FVKnUGGv3LuwNGVwyiuCPsQKt9MrhZwDDU7ZybmTgtc";
const STAGE_OFFSET = 120; // disc(8)+host(32)+recipient(32)+thresholds(48)
const tok = process.env.GH_TOKEN;
const base = {
    Authorization: `Bearer ${tok}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "charybdis-cron",
};

// Read the committed log. raw first (token-independent), contents API fallback.
async function fetchLog() {
    const sources = [
        {url: `https://raw.githubusercontent.com/${REPO}/main/charybdis-log.json?cb=${Date.now()}`, headers: {"User-Agent": "charybdis-cron"}},
        {url: `https://api.github.com/repos/${REPO}/contents/charybdis-log.json?ref=main`, headers: {...base, Accept: "application/vnd.github.raw"}},
    ];
    for (const s of sources) {
        try {
            const r = await fetch(s.url, {headers: s.headers});
            if (r.ok) return JSON.parse(await r.text());
            console.error(`log source ${r.status}: ${s.url.split("?")[0]}`);
        } catch (e) {
            console.error("log source failed:", e?.message || e);
        }
    }
    return null;
}

// Fresh local log for GATE_ONLY mode (the host has just git-pulled main).
function readLocalLog() {
    try {
        return JSON.parse(readFileSync(new URL("../charybdis-log.json", import.meta.url).pathname, "utf8"));
    } catch (e) {
        console.error("local log read failed:", e?.message || e);
        return null;
    }
}

let sinceMin = Infinity;
let lastStage = null;
const log = GATE_ONLY ? readLocalLog() : await fetchLog();
if (log) {
    const posted = log.filter((e) => e.posted_tweet_id && e.posted_tweet_id !== "DRY_RUN");
    if (posted.length) {
        sinceMin = (Date.now() - new Date(posted[posted.length - 1].ts).getTime()) / 60000;
    }
    for (let i = log.length - 1; i >= 0; i--) {
        if (typeof log[i].stage_index === "number") {
            lastStage = log[i].stage_index;
            break;
        }
    }
}

// Current on-chain stage (single byte). An advance over what she last recorded
// is the moment her followers came for — fire it immediately.
async function chainStage() {
    try {
        const r = await fetch(RPC, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [INFECTION_PDA, {encoding: "base64"}]}),
        });
        const j = await r.json();
        const data = j?.result?.value?.data?.[0];
        if (!data) return null;
        const bytes = Buffer.from(data, "base64");
        return bytes.length > STAGE_OFFSET ? bytes[STAGE_OFFSET] : null;
    } catch (e) {
        console.error("stage read failed:", e?.message || e);
        return null;
    }
}

// Minutes since the most recent charybdis run was *dispatched*, read fresh from
// the Actions API (NOT the CDN-cached log). A run shows up here the instant it is
// dispatched, so this sees a just-fired post even when the log read below cannot.
// Backstop for the stale-read double-dispatch (see the cooldown guard). Any
// failure → Infinity → no cooldown applied → prior log-only behaviour; it can
// never wrongly hold her.
async function lastRunMin() {
    try {
        const r = await fetch(
            `https://api.github.com/repos/${REPO}/actions/workflows/charybdis.yml/runs?per_page=1`,
            {headers: {...base, Accept: "application/vnd.github+json"}},
        );
        if (!r.ok) {
            console.error(`runs ${r.status}`);
            return Infinity;
        }
        const j = await r.json();
        const created = j?.workflow_runs?.[0]?.created_at;
        return created ? (Date.now() - new Date(created).getTime()) / 60000 : Infinity;
    } catch (e) {
        console.error("run history failed:", e?.message || e);
        return Infinity;
    }
}

const onchain = await chainStage();
const advanced = onchain != null && lastStage != null && onchain > lastStage;

// Fail safe: if the log couldn't be read, HOLD — never dispatch on a failed read.
if (!log) {
    console.log("log read failed — holding (no dispatch)");
    process.exit(GATE_ONLY ? 3 : 0);
}

// Re-rolled every run → irregular, organic gaps in the 20–25 min band.
const target = 20 + Math.random() * 5;
if (!advanced && sinceMin < target) {
    console.log(`holding: ${sinceMin.toFixed(1)}m < ${target.toFixed(1)}m (stage ${onchain ?? "?"}, last ${lastStage ?? "?"})`);
    process.exit(GATE_ONLY ? 3 : 0);
}

// GATE_ONLY: the host runs the cycle itself — signal GO and stop here. No dispatch
// and no run-history cooldown (the local log read above is already fresh, so the
// stale-read double-dispatch window the cooldown guards against does not exist).
if (GATE_ONLY) {
    console.log(`go: ${advanced ? `ADVANCE ${lastStage}→${onchain}` : `cadence ${sinceMin.toFixed(1)}m/${target.toFixed(1)}m`}`);
    process.exit(0);
}

// Anti-double-dispatch backstop. sinceMin/lastStage come from the log, served by
// a CDN that can lag a just-committed post by ~10 min — so a post (or crossing)
// that already fired can be invisible above, and the check re-fires it (the
// 5-min double/triple posts seen at 19:40/45/51 and at the 18:40 crossing). The
// run history, unlike the log, shows a dispatch immediately: if we dispatched
// within RUN_COOLDOWN_MIN, that run is in flight or just landed, so hold. Kept
// below the 20-min cadence floor → it only closes the stale window, never
// perturbs the real cadence. A crossing still fires the moment the cooldown
// clears (sparse, so it rarely coincides with a recent post — and then narrates
// once instead of tripling). lastRunMin failure → Infinity → never holds her.
const RUN_COOLDOWN_MIN = 12;
const sinceRun = await lastRunMin();
if (sinceRun < RUN_COOLDOWN_MIN) {
    console.log(`holding: dispatched ${sinceRun.toFixed(1)}m ago < ${RUN_COOLDOWN_MIN}m cooldown — log likely stale, avoiding a double (stage ${onchain ?? "?"}, last ${lastStage ?? "?"})`);
    process.exit(0);
}

const reason = advanced ? `ADVANCE ${lastStage}→${onchain}` : `cadence ${sinceMin.toFixed(1)}m/${target.toFixed(1)}m`;
const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/charybdis.yml/dispatches`, {
    method: "POST",
    headers: {...base, Accept: "application/vnd.github+json"},
    body: JSON.stringify({ref: "main"}),
});
console.log(`dispatch ${res.status} (${reason})`);
if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
}
