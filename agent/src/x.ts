import {appendFileSync} from "node:fs";
import {TwitterApi} from "twitter-api-v2";
import {MOCK_X, MOCK_X_PATH} from "./constants.js";
import {stripMarkdown} from "./text.js";

export async function postTweet(text: string): Promise<string> {
    text = stripMarkdown(text); // final net: no markdown ever reaches X
    if (MOCK_X) {
        const entry = {ts: new Date().toISOString(), text};
        appendFileSync(MOCK_X_PATH, JSON.stringify(entry) + "\n");
        return `mock-${Date.now()}`;
    }

    const apiKey = process.env.TWITTER_API_KEY;
    const apiSecret = process.env.TWITTER_API_SECRET;
    const accessToken = process.env.TWITTER_ACCESS_TOKEN;
    const accessSecret = process.env.TWITTER_ACCESS_SECRET;
    if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
        throw new Error("missing X API credentials");
    }
    const client = new TwitterApi({appKey: apiKey, appSecret: apiSecret, accessToken, accessSecret});
    const {data} = await client.v2.tweet(text);
    return data.id;
}
