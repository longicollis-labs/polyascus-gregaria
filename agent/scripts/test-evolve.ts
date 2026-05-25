// Test one bounded self-evolution step (no posting, no persisting).
import {readFileSync} from "node:fs";
import {loadInnerState, evolveInnerState, renderInner} from "../src/inner.js";

for (const line of readFileSync(new URL("../.env", import.meta.url).pathname, "utf8").split("\n")) {
    if (!line.includes("=") || line.trimStart().startsWith("#")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (!process.env[k]) process.env[k] = line.slice(i + 1).trim();
}

const current = loadInnerState();
console.log("=== BEFORE ===\n" + renderInner(current) + "\n");
const evolved = await evolveInnerState({
    current,
    recentPosts: [
        "I tore at the threads on my left side until the leg bled water. They knit back before morning. I will do it again tonight.",
        "Something pulses under my shell that is not my heart. I am still not done.",
    ],
    recentReplies: ["A crab. A thing rooting through me like a tree through soil. And you ask from a place where nothing eats you from inside."],
    recentVoices: [{handle: "micsteve29", said: "when something you created starts looking back with care"}],
    stage: "rooting",
    justAdvanced: false,
});
console.log("=== AFTER ===\n" + renderInner(evolved));
