// Answers the dry world. Reads recent @CrabCharybdis mentions, generates a crab
// reply via her persona, and posts it — at most once per conversation thread and
// once per user per 24h. Skips retweets, self/operator, and anything already
// answered. DRY_RUN prints proposed replies and persists nothing.
//
// Env: TWITTER_* creds, ANTHROPIC_API_KEY, SOLANA_RPC_URL; optional REPLY_CAP,
// X_USER_ID, DRY_RUN.
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {TwitterApi} from "twitter-api-v2";
import {replyToMention} from "./llm.js";
import {readStage} from "./infection.js";

const DRY = process.env.DRY_RUN === "1";
const CAP = Number(process.env.REPLY_CAP ?? "5"); // max replies posted per run
const USER_ID = process.env.X_USER_ID ?? "2057191960411070464"; // @CrabCharybdis
const SKIP_AUTHORS = new Set(["crabcharybdis", "longicollislabs"]);
const DAY_MS = 24 * 60 * 60 * 1000;
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

type Log = {
    answered: Record<string, unknown>; // mention id -> record (replied or skipped)
    threads: Record<string, string>; // conversation id -> iso ts of our reply (once per thread)
    users: Record<string, string>; // author id -> iso ts of our last reply (once per user/day)
};
function loadLog(): Log {
    if (existsSync(LOG_PATH)) {
        try {
            const l = JSON.parse(readFileSync(LOG_PATH, "utf8"));
            return {answered: l.answered ?? {}, threads: l.threads ?? {}, users: l.users ?? {}};
        } catch {
            /* fall through */
        }
    }
    return {answered: {}, threads: {}, users: {}};
}
function saveLog(l: Log): void {
    const ans = Object.keys(l.answered);
    if (ans.length > 400) for (const id of ans.slice(0, ans.length - 400)) delete l.answered[id];
    const thr = Object.keys(l.threads);
    if (thr.length > 1000) for (const id of thr.slice(0, thr.length - 1000)) delete l.threads[id];
    const cutoff = Date.now() - 2 * DAY_MS; // users only matter for 24h; keep 48h
    for (const [u, ts] of Object.entries(l.users)) if (new Date(ts).getTime() < cutoff) delete l.users[u];
    writeFileSync(LOG_PATH, JSON.stringify(l, null, 2) + "\n");
}
const stripLeadingMentions = (s: string) => s.replace(/^(\s*@\w+)+\s*/g, "").replace(/\s+/g, " ").trim();

async function main(): Promise<void> {
    const c = client();
    const log = loadLog();
    const stage = (await readStage())?.name ?? "rooting";

    const res = await c.v2.userMentionTimeline(USER_ID, {
        max_results: 25,
        "tweet.fields": ["created_at", "author_id", "referenced_tweets", "conversation_id"],
        expansions: ["author_id"],
        "user.fields": ["username"],
    });
    const users = new Map<string, string>((res.includes?.users ?? []).map((u: any) => [u.id, u.username]));

    // cheap, permanent skips → candidates, oldest first
    const candidates = (res.data?.data ?? []).filter((t: any) => {
        if (log.answered[t.id]) return false;
        if ((t.referenced_tweets ?? []).some((r: any) => r.type === "retweeted")) return false;
        const u = (users.get(t.author_id ?? "") || "").toLowerCase();
        return u && !SKIP_AUTHORS.has(u);
    });
    candidates.reverse();
    console.log(`mentions: ${res.data?.data?.length ?? 0} fetched · ${candidates.length} candidate(s) · cap ${CAP} · stage ${stage}`);

    let replied = 0;
    for (const t of candidates) {
        if (replied >= CAP) break;
        const conv = (t as any).conversation_id ?? t.id;
        const author = t.author_id ?? "";
        const uname = users.get(author) || "someone";

        // once per thread, ever
        if (log.threads[conv]) continue;
        // once per user per 24h
        const last = log.users[author];
        if (last && Date.now() - new Date(last).getTime() < DAY_MS) continue;

        const text = stripLeadingMentions(t.text);
        if (!text) {
            if (!DRY) log.answered[t.id] = {skipped: "empty"};
            continue;
        }
        let reply = "";
        try {
            reply = await replyToMention({mention: text, author: uname, stage});
        } catch (e) {
            console.error("gen failed", t.id, (e as Error)?.message || e);
            continue;
        }
        if (!reply || FORBIDDEN.test(reply)) {
            console.log(`skip @${uname} (guard): ${reply}`);
            if (!DRY) log.answered[t.id] = {skipped: "guard"};
            continue;
        }

        const now = new Date().toISOString();
        if (DRY) {
            console.log(`[DRY] @${uname} (thread ${conv}): "${text.slice(0, 60)}"\n      → ${reply}`);
        } else {
            try {
                const r = await c.v2.reply(reply, t.id);
                log.answered[t.id] = {reply, repliedId: r.data.id, ts: now};
                saveLog(log);
                console.log(`replied @${uname}: ${reply}`);
            } catch (e) {
                console.error("reply failed", t.id, (e as Error)?.message || e);
                continue;
            }
        }
        // mark thread + user so further mentions in the same thread / from the same
        // user this run (and within 24h) are skipped
        log.threads[conv] = now;
        log.users[author] = now;
        replied++;
    }
    if (!DRY) saveLog(log);
    console.log(`done — ${replied} ${DRY ? "would be " : ""}replied`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
