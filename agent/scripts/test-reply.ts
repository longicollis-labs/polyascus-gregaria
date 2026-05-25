// Test a single reply without posting.
// MENTION="..." AUTHOR="someone" npx tsx scripts/test-reply.ts
import {readFileSync} from "node:fs";
import {replyToMention} from "../src/llm.js";
import {readStage} from "../src/infection.js";

for (const line of readFileSync(new URL("../.env", import.meta.url).pathname, "utf8").split("\n")) {
    if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
}

const mention = process.env.MENTION ?? "what are you?";
const author = process.env.AUTHOR ?? "someone";
const stage = (await readStage())?.name ?? "rooting";

console.log(`@${author}: "${mention}"  (she is at: ${stage})\n`);
for (let i = 1; i <= 3; i++) {
    console.log(`${i}. ${await replyToMention({mention, author, stage})}`);
}
