// Answers the dry world. Reads recent @CrabCharybdis mentions, skips ones
// already answered (tracked in replies-log.json), retweets, and self/operator,
// generates a crab reply via her persona, and posts it. DRY_RUN prints the
// proposed replies and persists nothing.
//
// Env: TWITTER_* creds, ANTHROPIC_API_KEY, SOLANA_RPC_URL; optional REPLY_CAP,
// X_USER_ID, DRY_RUN.
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {TwitterApi} from "twitter-api-v2";
import {replyToMention} from "./llm.js";
import {readStage} from "./infection.js";

const DRY = process.env.DRY_RUN === "1";
const CAP = Number(process.env.REPLY_CAP ?? "5");
const USER_ID = process.env.X_USER_ID ?? "2057191960411070464"; // @CrabCharybdis
const SKIP_AUTHORS = new Set(["crabcharybdis", "longicollislabs"]);
const LOG_PATH = process.env.REPLIES_LOG_PATH ?? new URL("../../replies-log.json", import.meta.url).pathname;
// a reply must never leak mechanics / break the fiction
const FORBIDDEN =
    /\b(token|coin|crypto|memecoin|market\s?cap|mcap|pump\.?fun|wallet|mainnet|devnet|airdrop|presale|solana|as an ai|language model|chatgpt|anthropic)\b|\$sol/i;

function client(): TwitterApi {
    const k = process.env.TWITTER_API_KEY,
        s = process.env.TWITTER_API_SECRET,
        t = process.env.TWITTER_ACCESS_TOKEN,
        ts = process.env.TWITTER_ACCESS_SECRET;
    if (!k || !s || !t || !ts) throw new Error("missing X credentials");
    return new TwitterApi({appKey: k, appSecret: s, accessToken: t, accessSecret: ts});
}

type Log = {answered: Record<string, unknown>};
function loadLog(): Log {
    if (!existsSync(LOG_PATH)) return {answered: {}};
    try {
        return JSON.parse(readFileSync(LOG_PATH, "utf8")) as Log;
    } catch {
        return {answered: {}};
    }
}
function saveLog(l: Log): void {
    const ids = Object.keys(l.answered);
    if (ids.length > 400) for (const id of ids.slice(0, ids.length - 400)) delete l.answered[id];
    writeFileSync(LOG_PATH, JSON.stringify(l, null, 2) + "\n");
}
const stripLeadingMentions = (s: string) => s.replace(/^(\s*@\w+)+\s*/g, "").replace(/\s+/g, " ").trim();

async function main(): Promise<void> {
    const c = client();
    const log = loadLog();
    const stage = (await readStage())?.name ?? "rooting";

    const res = await c.v2.userMentionTimeline(USER_ID, {
        max_results: 25,
        "tweet.fields": ["created_at", "author_id", "referenced_tweets"],
        expansions: ["author_id"],
        "user.fields": ["username"],
    });
    const users = new Map<string, string>((res.includes?.users ?? []).map((u: any) => [u.id, u.username]));
    const mentions = (res.data?.data ?? []).filter((t: any) => {
        if (log.answered[t.id]) return false;
        if ((t.referenced_tweets ?? []).some((r: any) => r.type === "retweeted")) return false;
        const u = (users.get(t.author_id ?? "") || "").toLowerCase();
        return u && !SKIP_AUTHORS.has(u);
    });
    mentions.reverse(); // oldest first
    const batch = mentions.slice(0, CAP);
    console.log(`mentions: ${res.data?.data?.length ?? 0} fetched · ${mentions.length} unanswered · replying to ${batch.length} (stage ${stage})`);

    for (const t of batch) {
        const author = users.get(t.author_id ?? "") || "someone";
        const text = stripLeadingMentions(t.text);
        if (!text) {
            if (!DRY) log.answered[t.id] = {skipped: "empty"};
            continue;
        }
        let reply = "";
        try {
            reply = await replyToMention({mention: text, author, stage});
        } catch (e) {
            console.error("gen failed", t.id, (e as Error)?.message || e);
            continue;
        }
        if (!reply || FORBIDDEN.test(reply)) {
            console.log(`skip @${author} (guard): ${reply}`);
            if (!DRY) log.answered[t.id] = {skipped: "guard"};
            continue;
        }
        if (DRY) {
            console.log(`[DRY] @${author}: "${text.slice(0, 70)}"\n      → ${reply}`);
            continue;
        }
        try {
            const r = await c.v2.reply(reply, t.id);
            log.answered[t.id] = {reply, repliedId: r.data.id, ts: new Date().toISOString()};
            console.log(`replied @${author}: ${reply}`);
            saveLog(log);
        } catch (e) {
            console.error("reply failed", t.id, (e as Error)?.message || e);
        }
    }
    if (!DRY) saveLog(log);
    console.log("done");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
