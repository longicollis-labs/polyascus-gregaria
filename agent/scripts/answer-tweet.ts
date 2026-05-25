// Answer one specific tweet by id (one-off; bypasses the author skip-list).
// TWEET_ID=... [DRY_RUN=1] npx tsx scripts/answer-tweet.ts
import {readFileSync} from "node:fs";
import {TwitterApi} from "twitter-api-v2";
import {replyToMention} from "../src/llm.js";
import {readStage} from "../src/infection.js";

for (const line of readFileSync(new URL("../.env", import.meta.url).pathname, "utf8").split("\n")) {
    if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
}

const DRY = process.env.DRY_RUN === "1";
const id = process.env.TWEET_ID;
if (!id) throw new Error("TWEET_ID not set");

const c = new TwitterApi({
    appKey: process.env.TWITTER_API_KEY!,
    appSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
});

const tw = await c.v2.singleTweet(id, {expansions: ["author_id"], "user.fields": ["username"]});
const author = tw.includes?.users?.[0]?.username ?? "someone";
const text = (tw.data.text ?? "").replace(/^(\s*@\w+)+\s*/g, "").replace(/\s+/g, " ").trim();
const stage = (await readStage())?.name ?? "rooting";

console.log(`tweet by @${author}: "${text}"  (she is at: ${stage})\n`);
const reply = await replyToMention({mention: text, author, stage});
console.log("reply:", reply);
if (DRY) {
    console.log("\n[DRY] not posted");
} else {
    const r = await c.v2.reply(reply, id);
    console.log("\nPOSTED → https://x.com/CrabCharybdis/status/" + r.data.id);
}
