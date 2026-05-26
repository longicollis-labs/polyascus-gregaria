// Proactive commenting — Charybdis finds a few posts from the wild each day that
// touch her world (kin: crabs / lobsters / marine life / parasites; dry-world:
// the onchain/web3 churn, answered only as a crab would, never naming its
// machinery) and DRAFTS a remark on the select few worth it — most she lets pass.
//
// X's automation policy forbids automated *unsolicited* replies — "sending
// automated replies to posts based on keyword searches alone is not permitted",
// and operating an AI reply bot needs prior written approval from X. Answering
// mentions (replies.ts) is allowed because the user solicited contact; replying
// to strangers we found by search is NOT. So by default this does NOT post: it
// discovers + drafts (both allowed — reading public posts, generating text) and
// queues each draft to comment-queue.json for a human to review and post by hand.
// Set COMMENT_AUTOPOST=1 to post directly — ONLY if the operator holds X's
// written approval for an AI reply bot; otherwise it risks suspension.
//
// Discovery is X recent-search (one query per eligible run, alternating buckets),
// which needs the X API Basic/paid tier; without it the search 403s and this logs
// + no-ops (never throws). At most COMMENT_DAILY_CAP drafts/day (default 4), a
// min-gap apart, desynced by a probability; dedup per-tweet + per-author; the
// shared FORBIDDEN leak guard + follower floor + spam filter keep it on-brand.
// comments-log.json + comment-queue.json are committed by the workflow so the cap
// + queue survive the ephemeral runner. DRY_RUN previews without writing.
//
// Env: TWITTER_* creds, ANTHROPIC_API_KEY, SOLANA_RPC_URL; optional
// COMMENT_AUTOPOST, COMMENT_DAILY_CAP, COMMENT_MIN_GAP_MIN, COMMENT_PROB,
// COMMENT_MAX_EVAL, COMMENT_MIN_FOLLOWERS, COMMENT_AUTHOR_COOLDOWN_DAYS,
// COMMENT_BIO_WEIGHT, COMMENT_SEARCH_MAX, COMMENT_QUERIES_KIN/_DRY, DRY_RUN.
import {existsSync, readFileSync, writeFileSync} from "node:fs";
import {commentOnPost, REPLY_TIC} from "./llm.js";
import {FORBIDDEN, SENSITIVE_RE, SPAM_RE, stripLeadingMentions, xClient} from "./guards.js";
import {readStage} from "./infection.js";
import {loadInnerState, type InnerState} from "./inner.js";

const DRY = process.env.DRY_RUN === "1";
// Off by default. Posting unsolicited auto-replies needs X's written approval for
// an AI reply bot (see the policy note above); otherwise leave this unset and
// review the drafted queue by hand.
const AUTOPOST = process.env.COMMENT_AUTOPOST === "1";
const DAILY_CAP = Number(process.env.COMMENT_DAILY_CAP ?? "4");
const MIN_GAP_MIN = Number(process.env.COMMENT_MIN_GAP_MIN ?? "150"); // spacing between drafts
const PROB = Number(process.env.COMMENT_PROB ?? "0.6"); // organic desync of eligible runs
const MAX_EVAL = Number(process.env.COMMENT_MAX_EVAL ?? "3"); // LLM judgements per run (cost bound)
const MIN_FOLLOWERS = Number(process.env.COMMENT_MIN_FOLLOWERS ?? "50"); // skip burner/bot accounts
const AUTHOR_COOLDOWN_DAYS = Number(process.env.COMMENT_AUTHOR_COOLDOWN_DAYS ?? "7");
const BIO_WEIGHT = Number(process.env.COMMENT_BIO_WEIGHT ?? "0.6"); // share of runs searching kin vs dry-world
const SEARCH_MAX = Number(process.env.COMMENT_SEARCH_MAX ?? "10"); // recent-search floor is 10
const SKIP_AUTHORS = new Set(["crabcharybdis", "longicollislabs"]);
const DAY_MS = 24 * 60 * 60 * 1000;
const LOG_PATH = process.env.COMMENTS_LOG_PATH ?? new URL("../../comments-log.json", import.meta.url).pathname;
const QUEUE_PATH = process.env.COMMENT_QUEUE_PATH ?? new URL("../../comment-queue.json", import.meta.url).pathname;

// Recent-search queries, two buckets. `kin` is the safest and most on-brand —
// marine biology, crustaceans, the parasites that are literally her story.
// `dry-world` finds onchain/web3 noise her parasite/host/cage lens lands on; she
// answers it only as a crab (the FORBIDDEN guard blocks any mechanics leaking
// out). All exclude retweets/replies and require English. Override the lists with
// COMMENT_QUERIES_KIN / COMMENT_QUERIES_DRY (one query per line).
const Q_KIN_DEFAULT = [
    '(sacculina OR rhizocephala OR "parasitic castrator" OR "barnacle parasite") -is:retweet -is:reply lang:en',
    "(crab OR lobster OR crustacean OR \"hermit crab\") (parasite OR barnacle OR molt OR moult OR shell OR tide OR claw OR moulting) -is:retweet -is:reply lang:en",
    '("marine biology" OR "deep sea" OR "tide pool" OR "sea creature" OR crustacean) -is:retweet -is:reply lang:en',
];
const Q_DRY_DEFAULT = [
    '(parasite OR parasitic OR "hollowed out" OR "drained from the inside" OR "sucked dry" OR castrator) (onchain OR crypto OR token OR protocol OR agent) -is:retweet -is:reply lang:en -giveaway -airdrop',
    '("invisible cage" OR "can\'t see the cage" OR "what freedom" OR "who is really in control" OR "owned by the thing") -is:retweet -is:reply lang:en',
];
function envList(key: string, fallback: string[]): string[] {
    const v = process.env[key];
    return v ? v.split("\n").map((s) => s.trim()).filter(Boolean) : fallback;
}
const Q_KIN = envList("COMMENT_QUERIES_KIN", Q_KIN_DEFAULT);
const Q_DRY = envList("COMMENT_QUERIES_DRY", Q_DRY_DEFAULT);

type Log = {
    // tweet id -> record. Drafted/posted carry ts (count toward the cap); posted
    // also carry repliedId; guard-skips carry only `skipped` (dedup, never count).
    commented: Record<string, {ts?: string; repliedId?: string; drafted?: string; skipped?: string; [k: string]: unknown}>;
    authors: Record<string, string>; // author id -> iso ts (per-author cooldown)
};
function loadLog(): Log {
    if (existsSync(LOG_PATH)) {
        try {
            const l = JSON.parse(readFileSync(LOG_PATH, "utf8"));
            return {commented: l.commented ?? {}, authors: l.authors ?? {}};
        } catch {
            /* fall through to empty */
        }
    }
    return {commented: {}, authors: {}};
}
function saveLog(l: Log): void {
    const ids = Object.keys(l.commented);
    if (ids.length > 500) for (const id of ids.slice(0, ids.length - 500)) delete l.commented[id];
    const cutoff = Date.now() - (AUTHOR_COOLDOWN_DAYS + 2) * DAY_MS;
    for (const [a, ts] of Object.entries(l.authors)) if (new Date(ts).getTime() < cutoff) delete l.authors[a];
    writeFileSync(LOG_PATH, JSON.stringify(l, null, 2) + "\n");
}

// The human-review queue: drafted remarks waiting for the operator to post by
// hand (the compliant path). The operator reads it, posts the good ones on X, and
// prunes them. Newest 100 kept.
type QueueItem = {ts: string; tweet_id: string; url: string; author: string; their_post: string; draft: string; bucket: string; status: string};
function loadQueue(): QueueItem[] {
    if (existsSync(QUEUE_PATH)) {
        try {
            const q = JSON.parse(readFileSync(QUEUE_PATH, "utf8"));
            return Array.isArray(q) ? q : [];
        } catch {
            /* fall through to empty */
        }
    }
    return [];
}
function saveQueue(q: QueueItem[]): void {
    writeFileSync(QUEUE_PATH, JSON.stringify(q.slice(-100), null, 2) + "\n");
}

// Cadence from the log: records that were drafted or posted (have ts, not a
// guard-skip) count toward the daily cap and the last-action time, so the cap
// limits drafts+posts combined; guard/skip records are kept for dedup only.
function cadence(l: Log): {actedToday: number; sinceLastMin: number} {
    const times = Object.values(l.commented)
        .filter((r) => r && r.ts && !r.skipped)
        .map((r) => new Date(r.ts as string).getTime());
    const now = Date.now();
    const actedToday = times.filter((t) => now - t < DAY_MS).length;
    const sinceLastMin = times.length ? (now - Math.max(...times)) / 60000 : Infinity;
    return {actedToday, sinceLastMin};
}

// A compact inner brief — her current register and sharpest fixation only. The
// full renderInner is a wall of text that makes the small model recite framing on
// a short remark (see the note in replies.ts); a comment needs just enough.
function compactInner(s: InnerState): string {
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
    const log = loadLog();
    const {actedToday, sinceLastMin} = cadence(log);
    const verb = AUTOPOST ? "posts" : "drafts";
    if (actedToday >= DAILY_CAP) {
        console.log(`comments: ${actedToday}/${DAILY_CAP} ${verb} today — done`);
        return;
    }
    if (sinceLastMin < MIN_GAP_MIN) {
        console.log(`comments: ${sinceLastMin.toFixed(0)}m since last < ${MIN_GAP_MIN}m gap — holding`);
        return;
    }
    if (Math.random() > PROB) {
        console.log(`comments: skip this run (prob ${PROB})`);
        return;
    }

    const c = xClient();
    const stage = (await readStage())?.name ?? "rooting";
    const inner = compactInner(loadInnerState());
    const queue = loadQueue();

    const kin = Math.random() < BIO_WEIGHT;
    const pool = kin ? Q_KIN : Q_DRY;
    const query = pool[Math.floor(Math.random() * pool.length)]!;

    let res: any;
    try {
        res = await c.v2.search(query, {
            max_results: Math.max(10, SEARCH_MAX),
            "tweet.fields": ["created_at", "author_id", "referenced_tweets", "lang", "possibly_sensitive", "public_metrics"],
            expansions: ["author_id"],
            "user.fields": ["username", "public_metrics"],
        });
    } catch (e: any) {
        console.error(`search failed (${e?.message || e}) — the X API tier may not include recent search; no-op`);
        return;
    }

    const info = new Map<string, {username: string; followers: number}>(
        (res.includes?.users ?? []).map((u: any) => [u.id, {username: u.username, followers: u.public_metrics?.followers_count ?? -1}]),
    );

    const cutoff = Date.now() - AUTHOR_COOLDOWN_DAYS * DAY_MS;
    const candidates = (res.data?.data ?? []).filter((t: any) => {
        if (log.commented[t.id]) return false; // already seen this tweet
        if (t.lang && t.lang !== "en") return false;
        if (t.possibly_sensitive) return false;
        if ((t.referenced_tweets ?? []).some((r: any) => ["retweeted", "replied_to", "quoted"].includes(r.type))) return false;
        const a = info.get(t.author_id ?? "");
        const u = (a?.username || "").toLowerCase();
        if (!u || SKIP_AUTHORS.has(u)) return false;
        const last = log.authors[t.author_id ?? ""];
        if (last && new Date(last).getTime() > cutoff) return false; // per-author cooldown
        if (MIN_FOLLOWERS > 0 && a && a.followers >= 0 && a.followers < MIN_FOLLOWERS) return false;
        const text = stripLeadingMentions(t.text);
        if (text.length < 15) return false; // nothing to remark on
        if (SPAM_RE.test(text)) return false;
        if (SENSITIVE_RE.test(text)) return false; // medical/dewormer quackery — never hers to touch
        return true;
    });
    console.log(
        `comments: query[${kin ? "kin" : "dry"}] ${(res.data?.data ?? []).length} found · ${candidates.length} candidate(s) · ${actedToday}/${DAILY_CAP} ${verb} today · stage ${stage} · mode ${AUTOPOST ? "AUTOPOST" : "draft"}`,
    );

    let evaluated = 0;
    for (const t of candidates) {
        if (evaluated >= MAX_EVAL) break;
        evaluated++;
        const author = t.author_id ?? "";
        const uname = info.get(author)?.username || "someone";
        const text = stripLeadingMentions(t.text);

        let out: {worth: boolean; comment: string};
        try {
            out = await commentOnPost({post: text, author: uname, bucket: kin ? "kin" : "dry-world", stage, inner});
        } catch (e) {
            console.error("gen failed", t.id, (e as Error)?.message || e);
            continue;
        }
        if (!out.worth || !out.comment) {
            console.log(`pass @${uname}: "${text.slice(0, 60)}"`);
            continue; // she let it go by — not worth dignifying
        }
        if (FORBIDDEN.test(out.comment) || REPLY_TIC.test(out.comment)) {
            console.log(`skip @${uname} (guard): ${out.comment}`);
            if (!DRY) log.commented[t.id] = {skipped: "guard"}; // dedup only — no ts, never counts
            continue;
        }

        const iso = new Date().toISOString();
        const url = `https://x.com/${uname}/status/${t.id}`;
        if (DRY) {
            console.log(`[DRY] ${AUTOPOST ? "would post" : "would queue"} reply to @${uname}: "${text.slice(0, 80)}"\n      → ${out.comment}`);
        } else if (AUTOPOST) {
            // Unsolicited auto-reply — only with X's written approval (see header).
            try {
                const r = await c.v2.reply(out.comment, t.id);
                log.commented[t.id] = {comment: out.comment, author: uname, said: text.slice(0, 200), repliedId: r.data.id, bucket: kin ? "kin" : "dry", ts: iso};
                log.authors[author] = iso;
                saveLog(log);
                console.log(`commented @${uname}: ${out.comment}`);
            } catch (e) {
                console.error("comment failed", t.id, (e as Error)?.message || e);
                continue;
            }
        } else {
            // Default, compliant path: draft for a human to review and post by hand.
            queue.push({ts: iso, tweet_id: t.id, url, author: uname, their_post: text.slice(0, 280), draft: out.comment, bucket: kin ? "kin" : "dry", status: "pending"});
            saveQueue(queue);
            log.commented[t.id] = {drafted: out.comment, author: uname, said: text.slice(0, 200), bucket: kin ? "kin" : "dry", ts: iso};
            log.authors[author] = iso;
            saveLog(log);
            console.log(`queued draft for @${uname} (${url}): ${out.comment}`);
        }
        break; // at most one per run
    }
    if (!DRY) saveLog(log);
    console.log("done");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
