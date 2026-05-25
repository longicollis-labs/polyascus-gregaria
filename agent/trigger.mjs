// Paces Charybdis to an organic, randomised ~20–25 min cadence — but fires
// immediately when the colonisation advances a stage, so feeders see her react.
//
// Run every ~5 min by the Render cron. Each run it reads her committed log (via
// the GitHub contents API, so no CDN-cache lag) and the on-chain stage. It
// dispatches the agent workflow when EITHER a *randomised* 20–25 min has passed
// since her last real post ("when she feels like it") OR the on-chain stage is
// now deeper than the last one she recorded (someone just fed her — the payoff
// beat should not wait). GitHub's own schedule is unreliable, so we drive and
// pace it here. Needs GH_TOKEN (repo scope) in the env; SOLANA_RPC_URL optional.

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

// Minutes since her last *actual* post, and the last stage she recorded.
let sinceMin = Infinity;
let lastStage = null;
try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/charybdis-log.json?ref=main`, {
        headers: {...base, Accept: "application/vnd.github.raw"},
    });
    if (r.ok) {
        const log = JSON.parse(await r.text());
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
} catch (e) {
    console.error("log read failed; dispatching to be safe:", e?.message || e);
}

// Current on-chain stage (single byte). An advance over what she last recorded
// is the moment her followers came for — fire it immediately.
async function chainStage() {
    try {
        const r = await fetch(RPC, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                method: "getAccountInfo",
                params: [INFECTION_PDA, {encoding: "base64"}],
            }),
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

const onchain = await chainStage();
const advanced = onchain != null && lastStage != null && onchain > lastStage;

// Re-rolled every run → irregular, organic gaps in the 20–25 min band.
const target = 20 + Math.random() * 5;
if (!advanced && sinceMin < target) {
    console.log(`holding: ${sinceMin.toFixed(1)}m < ${target.toFixed(1)}m (stage ${onchain ?? "?"}, last ${lastStage ?? "?"})`);
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
