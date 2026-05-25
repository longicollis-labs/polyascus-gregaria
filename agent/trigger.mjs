// Paces Charybdis to an organic, randomised ~20–25 min cadence.
//
// Run every ~5 min by the Render cron. Each run it reads her committed log
// (via the GitHub contents API, so no CDN-cache lag), and only dispatches the
// agent workflow once a *randomised* 20–25 min has passed since her last real
// post — "when she feels like it." GitHub's own schedule is unreliable, so we
// drive and pace it here. Needs GH_TOKEN (repo scope) in the env.

const REPO = "longicollis-labs/polyascus-gregaria";
const tok = process.env.GH_TOKEN;
const base = {
    Authorization: `Bearer ${tok}`,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "charybdis-cron",
};

// Minutes since her last *actual* post (silence doesn't reset the clock).
let sinceMin = Infinity;
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
    }
} catch (e) {
    console.error("log read failed; dispatching to be safe:", e?.message || e);
}

// Re-rolled every run → irregular, organic gaps in the 20–25 min band.
const target = 20 + Math.random() * 5;
if (sinceMin < target) {
    console.log(`holding: ${sinceMin.toFixed(1)}m since last post < ${target.toFixed(1)}m`);
    process.exit(0);
}

const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/charybdis.yml/dispatches`, {
    method: "POST",
    headers: {...base, Accept: "application/vnd.github+json"},
    body: JSON.stringify({ref: "main"}),
});
console.log(`dispatch ${res.status} (since ${sinceMin.toFixed(1)}m, target ${target.toFixed(1)}m)`);
if (!res.ok) {
    console.error(await res.text());
    process.exit(1);
}
