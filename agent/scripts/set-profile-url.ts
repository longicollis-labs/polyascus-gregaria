// Set @CrabCharybdis's profile website link, then read it back to confirm X kept it.
// X periodically strips the URL from the profile; re-run this to restore it. The
// read-back reveals whether X actually retained the link (if it comes back empty,
// X is stripping it — a domain-flag issue to resolve on X's side, not in code).
// Reversible — pass any URL, or clear it with PROFILE_URL="".
// Run: npx tsx scripts/set-profile-url.ts                       (defaults to https://polyascus.com/)
//      PROFILE_URL=https://example.com npx tsx scripts/set-profile-url.ts
import {existsSync, readFileSync} from "node:fs";
import {TwitterApi} from "twitter-api-v2";

// Load agent/.env into process.env (without clobbering already-set vars); on a
// host where the vars are already in the environment, the file may be absent.
const envPath = new URL("../.env", import.meta.url).pathname;
if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
        if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
        const i = line.indexOf("=");
        const k = line.slice(0, i).trim();
        if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
    }
}

const appKey = process.env.TWITTER_API_KEY;
const appSecret = process.env.TWITTER_API_SECRET;
const accessToken = process.env.TWITTER_ACCESS_TOKEN;
const accessSecret = process.env.TWITTER_ACCESS_SECRET;
if (!appKey || !appSecret || !accessToken || !accessSecret) throw new Error("missing X creds in .env");

const url = process.env.PROFILE_URL ?? "https://polyascus.com/";

const client = new TwitterApi({appKey, appSecret, accessToken, accessSecret});
await client.v1.updateAccountProfile({url});

// Read it straight back — if X retained the link this prints it; if it returns
// empty, X stripped it (resolve the flag on X's side; re-running won't hold).
const me = await client.v1.verifyCredentials({include_entities: true, skip_status: true});
console.log(`requested url -> ${url || "(cleared)"}`);
console.log(`X now reports url: ${me.url ?? "(none)"} · entities.url: ${JSON.stringify(me.entities?.url ?? null)}`);
