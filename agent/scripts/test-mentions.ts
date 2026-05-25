// Probe: can the current X app read mentions? (mentions read is tier-gated).
import {readFileSync} from "node:fs";
import {TwitterApi} from "twitter-api-v2";

for (const line of readFileSync(new URL("../.env", import.meta.url).pathname, "utf8").split("\n")) {
    if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
}
const appKey = process.env.TWITTER_API_KEY!;
const appSecret = process.env.TWITTER_API_SECRET!;
const accessToken = process.env.TWITTER_ACCESS_TOKEN!;
const accessSecret = process.env.TWITTER_ACCESS_SECRET!;
const client = new TwitterApi({appKey, appSecret, accessToken, accessSecret});

try {
    const me = await client.v2.me();
    console.log("me():", me.data.username, me.data.id);
    const m = await client.v2.userMentionTimeline(me.data.id, {max_results: 5, "tweet.fields": ["created_at", "author_id"]});
    const arr = m.data?.data ?? [];
    console.log("mentions readable: YES —", arr.length, "recent");
    for (const t of arr) console.log("  ", t.id, JSON.stringify(t.text.slice(0, 70)));
} catch (e: any) {
    console.log("mentions read FAILED:", e?.code || "", e?.data?.title || e?.message || e);
    if (e?.data) console.log("detail:", JSON.stringify(e.data).slice(0, 300));
}
