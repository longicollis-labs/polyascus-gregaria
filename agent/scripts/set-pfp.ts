// One-off: set @CrabCharybdis's profile image (e.g. when her stage evolves).
// Reversible — swap back anytime. Run: IMAGE_PATH=/path/to.png npx tsx scripts/set-pfp.ts
import {readFileSync} from "node:fs";
import {TwitterApi} from "twitter-api-v2";

// Load agent/.env into process.env (without clobbering already-set vars).
for (const line of readFileSync(new URL("../.env", import.meta.url).pathname, "utf8").split("\n")) {
    if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
}

const appKey = process.env.TWITTER_API_KEY;
const appSecret = process.env.TWITTER_API_SECRET;
const accessToken = process.env.TWITTER_ACCESS_TOKEN;
const accessSecret = process.env.TWITTER_ACCESS_SECRET;
const path = process.env.IMAGE_PATH;
if (!appKey || !appSecret || !accessToken || !accessSecret) throw new Error("missing X creds in .env");
if (!path) throw new Error("IMAGE_PATH not set");

const client = new TwitterApi({appKey, appSecret, accessToken, accessSecret});
await client.v1.updateAccountProfileImage(readFileSync(path));
console.log("profile image updated for @CrabCharybdis");
