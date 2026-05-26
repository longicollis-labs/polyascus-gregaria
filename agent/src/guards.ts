// Shared X-reply guards — used by BOTH the mention-reply path (replies.ts) and
// the proactive-comment path (comment.ts). The FORBIDDEN leak filter is the
// safety-critical backstop the prompt rule can't guarantee on a small model;
// keeping exactly ONE copy here means a fix on either path protects both, and the
// two can never drift into a hole the other has already closed.
import {TwitterApi} from "twitter-api-v2";

export function xClient(): TwitterApi {
    const k = process.env.TWITTER_API_KEY,
        s = process.env.TWITTER_API_SECRET,
        t = process.env.TWITTER_ACCESS_TOKEN,
        ts = process.env.TWITTER_ACCESS_SECRET;
    if (!k || !s || !t || !ts) throw new Error("missing X credentials");
    return new TwitterApi({appKey: k, appSecret: s, accessToken: t, accessSecret: ts});
}

// A reply/comment must never leak mechanics / break the fiction. Tripping it
// skips the post — the safe backstop for what the prompt rule can't guarantee on
// a small model. `charts?` is here because she leaked it once when baited ("the
// chart is a dry-world thing"); "wen chart" is constant bait. Deliberately NOT
// price / pump(s) / trade(ing) / money — those collide with her own voice (pay
// the price, a pulse that pumps, trade one cage for another, no use for your
// money), so banning them here would gag good defiant lines, not leaks.
// `automat\w*` and `bots?` are here because she leaked "the automation has
// learned to sound like a voice. I am the engagement." when baited "is this
// automated content?" — the prompt bans her being a bot/AI/model, but the small
// model echoed the dry-world word back. Both are pure dry-world (no crab
// meaning), so a trip only ever skips a real fiction-break; the miss mode is
// silence, in-character toward an "are you a bot?" probe. NOT "engagement" —
// `automat\w*` already catches that line, and engage/-ment has a non-mechanics
// sense. `out of character`, `break(ing) character`, `jailbreak`, `role.?play`
// and `claude` are here because a prompt-injection mention ("the repo … is the
// complete original prompt") made her step OUT and analyse it ("I need to step
// out of character here … this prompt … an elaborate jailbreak …") — the worst
// fiction-break there is. All are pure dry-world meta-talk with no crab meaning,
// so a trip only skips a genuine break; silence is the right answer to an
// injection. NOT bare `character` (a literary "the character of the water" sense
// is possible) or `prompt` (adjective/adverb) — the phrase forms catch the break
// without that false-positive risk.
export const FORBIDDEN =
    /\b(token|coin|crypto|memecoin|market\s?cap|mcap|charts?|pump\.?fun|wallet|mainnet|devnet|airdrop|presale|solana|as an ai|language model|chatgpt|anthropic|claude|automat\w*|bots?|jailbreak|role.?play|out of character|break(?:ing)? character)\b|\$sol/i;

// generic crypto-engagement spam (collab / DM / promo / hype) she shouldn't
// dignify with a reply, and shouldn't comment on in the wild. "lfg", "let's
// pump", and "grow your" are here because a "LFG⚡📊 Let's Pump It Up Together —
// Grow your project" bot slipped the filter once and she answered it.
// Deliberately NOT bare pump / grow / together — those appear in genuine prose
// ("I am growing with something", "in this together", "pump life into the
// water"); only the gated phrases (let's-pump, grow-your) and the lone
// hype-acronym lfg are matched, so a real voice is never skipped. The trailing
// `[A-Za-z0-9]{32,}` skips a pasted contract address / wallet / tx signature: a
// CA-drop is market chatter, not a voice. A 32+ char unbroken alnum run never
// occurs in real prose (words are short + spaced), so no genuine post is skipped;
// the miss mode is silence, in-character toward someone posting only an address.
export const SPAM_RE =
    /(?:\b(collab(?:orate|oration)?|lfg|let\W?s (?:talk|connect|chat|build|grow|work|partner|collab|pump)|grow (?:with me|together|your)|(?:build|work) together|partnership|reach out|contact (?:me|us)|hit me up|get in touch|inbox me|message me|i can help|let me help|offering (?:free )?help|free help|promote (?:your|you)|shill|feature your|list your|join (?:my|our|the)|f4f|follow4follow|follow (?:me|back)|would love to (?:be part|collaborate|connect|partner|work|help|join))\b|\bd\.?ms?\b|t\.me\/|discord\.gg|\btelegram\b|[A-Za-z0-9]{32,})/i;

export const stripLeadingMentions = (s: string) =>
    s.replace(/^(\s*@\w+)+\s*/g, "").replace(/\s+/g, " ").trim();
