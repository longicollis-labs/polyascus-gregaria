// Answers the dry world. Reads recent @CrabCharybdis mentions, generates a crab
// reply via her persona, and posts it — at most once per conversation thread and
// once per user per 24h. Skips retweets, self/operator, generic crypto spam
// (collab / DM / promo), and anything already answered. DRY_RUN posts nothing.
//
// Env: TWITTER_* creds, ANTHROPIC_API_KEY, SOLANA_RPC_URL; optional REPLY_CAP,
// MIN_FOLLOWERS, X_USER_ID, DRY_RUN.
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {TwitterApi} from "twitter-api-v2";
import {replyToMention} from "./llm.js";
import {readStage} from "./infection.js";
import {loadInnerState, type InnerState} from "./inner.js";

const DRY = process.env.DRY_RUN === "1";
const CAP = Number(process.env.REPLY_CAP ?? "5"); // max replies posted per run
const MIN_FOLLOWERS = Number(process.env.MIN_FOLLOWERS ?? "0"); // 0 = off
const USER_ID = process.env.X_USER_ID ?? "2057191960411070464"; // @CrabCharybdis
const SKIP_AUTHORS = new Set(["crabcharybdis", "longicollislabs"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const LOG_PATH = process.env.REPLIES_LOG_PATH ?? new URL("../../replies-log.json", import.meta.url).pathname;

// A reply must never leak mechanics / break the fiction. Tripping it skips the
// reply — the safe backstop for what the prompt rule can't guarantee on a small
// model. `charts?` is here because she leaked it once when baited ("the chart is
// a dry-world thing"); "wen chart" is constant bait. Deliberately NOT price /
// pump(s) / trade(ing) / money — those collide with her own voice (pay the
// price, a pulse that pumps, trade one cage for another, no use for your money),
// so banning them here would gag good defiant replies, not leaks.
const FORBIDDEN =
    /\b(token|coin|crypto|memecoin|market\s?cap|mcap|charts?|pump\.?fun|wallet|mainnet|devnet|airdrop|presale|solana|as an ai|language model|chatgpt|anthropic)\b|\$sol/i;

// generic crypto-engagement spam (collab / DM / promo / hype) she shouldn't
// dignify with a reply. "lfg", "let's pump", and "grow your" are here because a
// "LFG⚡📊 Let's Pump It Up Together — Grow your project" bot slipped the filter
// once and she answered it. Deliberately NOT bare pump / grow / together — those
// appear in genuine mentions ("I am growing with something", "in this together",
// "pump life into the water"); only the gated phrases (let's-pump, grow-your)
// and the lone hype-acronym lfg are matched, so a real voice is never skipped.
const SPAM_RE =
    /(?:\b(collab(?:orate|oration)?|lfg|let\W?s (?:talk|connect|chat|build|grow|work|partner|collab|pump)|grow (?:with me|together|your)|(?:build|work) together|partnership|reach out|contact (?:me|us)|hit me up|get in touch|inbox me|message me|i can help|let me help|offering (?:free )?help|free help|promote (?:your|you)|shill|feature your|list your|join (?:my|our|the)|f4f|follow4follow|follow (?:me|back)|would love to (?:be part|collaborate|connect|partner|work|help|join))\b|\bd\.?ms?\b|t\.me\/|discord\.gg|\btelegram\b)/i;

function client(): TwitterApi {
    const k = process.env.TWITTER_API_KEY,
        s = process.env.TWITTER_API_SECRET,
        t = process.env.TWITTER_ACCESS_TOKEN,
        ts = process.env.TWITTER_ACCESS_SECRET;
    if (!k || !s || !t || !ts) throw new Error("missing X credentials");
    return new TwitterApi({appKey: k, appSecret: s, accessToken: t, accessSecret: ts});
}

type Log = {
    answered: Record<string, unknown>;
    threads: Record<string, string>; // conversation id -> iso ts (once per thread)
    users: Record<string, string>; // author id -> iso ts (once per user/day)
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
    const cutoff = Date.now() - 2 * DAY_MS;
    for (const [u, ts] of Object.entries(l.users)) if (new Date(ts).getTime() < cutoff) delete l.users[u];
    writeFileSync(LOG_PATH, JSON.stringify(l, null, 2) + "\n");
}
const stripLeadingMentions = (s: string) => s.replace(/^(\s*@\w+)+\s*/g, "").replace(/\s+/g, " ").trim();

// The full inner state (renderInner — mood, through-line, obsessions, memories,
// views, voices) runs to thousands of characters. Fed whole into the short
// "answer in one or two lines" reply prompt, the small model latches onto that
// wall of text and recites the prompt framing instead of answering — worst on
// terse mentions ("interesting", "gm", "?"), where there's little else to grab.
// A reply only needs her current register and sharpest fixation; the rest is
// posting-path depth. So replies get a compact, bounded brief — the posting path
// (index.ts) still feeds the full renderInner. The `remembered` note for a
// clocked voice is passed separately, so recognition is unaffected.
function replyInner(s: InnerState): string {
    const sentence = (t: string) => {
        const m = t.match(/[.!?](?:\s|$)/);
        return (m ? t.slice(0, (m.index ?? 0) + 1) : t).trim();
    };
    const clip = (t: string, n: number) => {
        if (t.length <= n) return t;
        const cut = t.slice(0, n);
        const sp = cut.lastIndexOf(" ");
        return (sp > 40 ? cut.slice(0, sp) : cut).trim() + "…";
    };
    const brief = (t: string, n: number) => clip(sentence(t), n);
    const top = s.obsessions[0];
    return [s.mood ? `mood: ${brief(s.mood, 180)}` : "", top ? `what grips you most: ${brief(top, 200)}` : ""]
        .filter(Boolean)
        .join("\n");
}

async function main(): Promise<void> {
    const c = client();
    const log = loadLog();
    const stage = (await readStage())?.name ?? "rooting";
    const innerState = loadInnerState();
    const inner = replyInner(innerState);

    const res = await c.v2.userMentionTimeline(USER_ID, {
        max_results: 25,
        "tweet.fields": ["created_at", "author_id", "referenced_tweets", "conversation_id"],
        expansions: ["author_id"],
        "user.fields": ["username", "public_metrics"],
    });
    const info = new Map<string, {username: string; followers: number}>(
        (res.includes?.users ?? []).map((u: any) => [u.id, {username: u.username, followers: u.public_metrics?.followers_count ?? -1}]),
    );

    let spam = 0;
    const candidates = (res.data?.data ?? []).filter((t: any) => {
        if (log.answered[t.id]) return false;
        if ((t.referenced_tweets ?? []).some((r: any) => r.type === "retweeted")) return false;
        const a = info.get(t.author_id ?? "");
        const u = (a?.username || "").toLowerCase();
        if (!u || SKIP_AUTHORS.has(u)) return false;
        const text = stripLeadingMentions(t.text);
        if (SPAM_RE.test(text)) {
            spam++;
            return false;
        }
        if (MIN_FOLLOWERS > 0 && a && a.followers >= 0 && a.followers < MIN_FOLLOWERS) {
            spam++;
            return false;
        }
        return true;
    });
    candidates.reverse(); // oldest first
    console.log(`mentions: ${res.data?.data?.length ?? 0} fetched · ${spam} spam-skipped · ${candidates.length} candidate(s) · cap ${CAP} · stage ${stage}`);

    let replied = 0;
    for (const t of candidates) {
        if (replied >= CAP) break;
        const conv = (t as any).conversation_id ?? t.id;
        const author = t.author_id ?? "";
        const uname = info.get(author)?.username || "someone";

        if (log.threads[conv]) continue; // once per thread
        const last = log.users[author];
        if (last && Date.now() - new Date(last).getTime() < DAY_MS) continue; // once per user / 24h

        const text = stripLeadingMentions(t.text);
        if (!text) {
            if (!DRY) log.answered[t.id] = {skipped: "empty"};
            continue;
        }
        // If she has already clocked this voice, answer as one who remembers it.
        const clocked = innerState.known_voices.find(
            (v) => v.handle.replace(/^@/, "").toLowerCase() === uname.toLowerCase(),
        );
        const remembered = clocked && clocked.note.trim() ? {note: clocked.note} : undefined;

        let reply = "";
        try {
            reply = await replyToMention({mention: text, author: uname, stage, inner, remembered});
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
            console.log(`[DRY] @${uname}: "${text.slice(0, 60)}"\n      → ${reply}`);
        } else {
            try {
                const r = await c.v2.reply(reply, t.id);
                log.answered[t.id] = {reply, author: uname, said: text.slice(0, 200), repliedId: r.data.id, ts: now};
                saveLog(log);
                console.log(`replied @${uname}: ${reply}`);
            } catch (e) {
                console.error("reply failed", t.id, (e as Error)?.message || e);
                continue;
            }
        }
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
