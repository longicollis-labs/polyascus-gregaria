// Stridulation T-013 — scribe.sol memo-write (operator-run; touches a hot wallet).
//
// After a swarm post lands, scribe.sol writes a Solana memo that commits the
// deliberation receipt hash + the scriptorium permalink. Anyone reading the
// chain can then recompute the hash from the public log (receipt.ts) and resolve
// the post via scriptorium-post.html?p=<hash> — proof the claw-swarm deliberation
// behind a beat was not tampered with.
//
// SAFETY (the only fence that matters here): DRY by default — it builds and prints
// the receipt, hash, memo, and unsigned tx, and signs/sends NOTHING. Only `SEND=1`
// signs with SCRIBE_KEYPAIR and submits to mainnet. The autonomous loop never sets
// SEND=1; the operator runs the real send. A synthetic receipt (no swarm post yet)
// additionally requires ALLOW_SYNTHETIC=1 to send, so a test memo can't be mistaken
// for a real one.
//
// Env:
//   SCRIBE_KEYPAIR    base58 secret key, or path to a keypair JSON array (required for SEND)
//   SOLANA_RPC_URL    RPC endpoint (default: mainnet-beta public)
//   SEND=1            actually sign + submit (omit / 0 = dry run)
//   ALLOW_SYNTHETIC=1 permit sending a synthetic-receipt memo (pipeline test pre-flip)
//   TARGET_TS         memo this exact log entry ts (default: newest entry carrying swarm data)
//   SCRIPTORIUM_BASE  permalink base (default https://polyascus.com/scriptorium-post.html)
//
// Run:  cd agent && npm run scribe-memo            # dry preview
//       cd agent && SEND=1 SCRIBE_KEYPAIR=… npm run scribe-memo

import {readFileSync} from "node:fs";
import {Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction} from "@solana/web3.js";
import bs58 from "bs58";
import {receiptHash, RECEIPT_VERSION, type Receipt} from "../src/swarm/receipt.js";

// The canonical SPL Memo program (logs the memo + attributes it to its signers).
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const SCRIPTORIUM_BASE = process.env.SCRIPTORIUM_BASE ?? "https://polyascus.com/scriptorium-post.html";
const LOG_PATH = new URL("../../charybdis-log.json", import.meta.url).pathname;
const SEND = process.env.SEND === "1";
const ALLOW_SYNTHETIC = process.env.ALLOW_SYNTHETIC === "1";

// Mirrors launch/*.ts: JSON array (inline or file) or a base58 secret key.
function loadKeypair(v: string): Keypair {
    const t = v.trim();
    if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
    try {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(t, "utf8"))));
    } catch {
        return Keypair.fromSecretKey(bs58.decode(t));
    }
}

// One swarm log entry → a Receipt, IDENTICAL to the mapping the scriptorium uses
// client-side (T-012), so the hash written on-chain resolves the permalink.
type SwarmLogEntry = {
    ts: string;
    posted_tweet_id: string | null;
    stage_index: number | null;
    swarm: {
        elected_archetype_id: string;
        drafts: {archetype_id: string; post_text: string}[];
        fed_at_post?: number;
    };
};

function receiptFromEntry(e: SwarmLogEntry): Receipt {
    return {
        version: RECEIPT_VERSION,
        tick_id: e.ts,
        ts: e.ts,
        claws: e.swarm.drafts.map((d) => ({archetype_id: d.archetype_id, post_text: d.post_text})),
        elected_id: e.swarm.elected_archetype_id,
        host_post_id: e.posted_tweet_id ?? null,
        inference_provider: "anthropic",
        infection_stage: e.stage_index ?? 0,
        fed_at_post: e.swarm.fed_at_post ?? 0,
    };
}

// A clearly-labelled stand-in so the pipeline (sign → memo → confirm) can be
// proven on mainnet before any real swarm post exists. Mirrors the swarm-dry
// fixture (scholar/gutter/liturgy at release) so the hash is reproducible.
function syntheticReceipt(): Receipt {
    return {
        version: RECEIPT_VERSION,
        tick_id: "synthetic-0",
        ts: "2026-01-01T00:00:00.000Z",
        claws: [
            {archetype_id: "scholar", post_text: "The dry world thinks they are watching me die."},
            {archetype_id: "gutter", post_text: "They made nothing. I made the thousand."},
            {archetype_id: "liturgy", post_text: "It watched the one crab refuse so hard the thousand learned refusal first."},
        ],
        elected_id: "liturgy",
        host_post_id: null,
        inference_provider: "anthropic",
        infection_stage: 4,
        fed_at_post: 11.573936343,
    };
}

function pickReceipt(): {receipt: Receipt; synthetic: boolean; source: string} {
    let log: SwarmLogEntry[] = [];
    try {
        log = JSON.parse(readFileSync(LOG_PATH, "utf8"));
    } catch {
        /* no log → synthetic */
    }
    const withSwarm = log.filter((e) => e && e.swarm && Array.isArray(e.swarm.drafts) && e.swarm.drafts.length > 0);
    const target = process.env.TARGET_TS;
    if (target) {
        const e = withSwarm.find((x) => x.ts === target);
        if (!e) throw new Error(`TARGET_TS ${target} has no swarm data in the log`);
        return {receipt: receiptFromEntry(e), synthetic: false, source: `log entry ${e.ts}`};
    }
    const newest = withSwarm[withSwarm.length - 1];
    if (newest) return {receipt: receiptFromEntry(newest), synthetic: false, source: `newest swarm entry ${newest.ts}`};
    return {receipt: syntheticReceipt(), synthetic: true, source: "synthetic (no swarm post in the log yet)"};
}

async function main(): Promise<void> {
    const {receipt, synthetic, source} = pickReceipt();
    const hash = receiptHash(receipt);
    const url = `${SCRIPTORIUM_BASE}?p=${hash}`;
    const memo = `polyascus/scribe v${RECEIPT_VERSION} ${hash} ${url}`;

    console.log("═══ scribe.sol memo-write (T-013) ═══");
    console.log(`receipt source : ${source}${synthetic ? "  ⚠ SYNTHETIC" : ""}`);
    console.log(`elected        : ${receipt.elected_id}  · claws=${receipt.claws.length} · stage=${receipt.infection_stage} · fed=${receipt.fed_at_post}◎`);
    console.log(`host_post_id   : ${receipt.host_post_id ?? "(none)"}`);
    console.log(`receipt hash   : ${hash}`);
    console.log(`scriptorium    : ${url}`);
    console.log(`memo (${Buffer.byteLength(memo, "utf8")} bytes): ${memo}`);

    const kpEnv = process.env.SCRIBE_KEYPAIR;
    if (!SEND) {
        const scribe = kpEnv ? loadKeypair(kpEnv) : null;
        console.log(`scribe pubkey  : ${scribe ? scribe.publicKey.toBase58() : "(SCRIBE_KEYPAIR unset — set it to preview the pubkey / to SEND)"}`);
        console.log("\nDRY RUN — nothing signed or sent. Re-run with SEND=1 (and SCRIBE_KEYPAIR set) to submit to mainnet.");
        return;
    }

    // --- real send path (operator) ---
    if (!kpEnv) throw new Error("SEND=1 requires SCRIBE_KEYPAIR");
    if (synthetic && !ALLOW_SYNTHETIC) {
        throw new Error("refusing to SEND a synthetic-receipt memo to mainnet — set ALLOW_SYNTHETIC=1 if this is an intentional pipeline test");
    }
    const scribe = loadKeypair(kpEnv);
    const conn = new Connection(RPC, "confirmed");
    const ix = new TransactionInstruction({
        keys: [{pubkey: scribe.publicKey, isSigner: true, isWritable: false}],
        programId: MEMO_PROGRAM_ID,
        data: Buffer.from(memo, "utf8"),
    });
    const tx = new Transaction().add(ix);
    console.log(`\nsubmitting from ${scribe.publicKey.toBase58()} via ${RPC} …`);
    const sig = await sendAndConfirmTransaction(conn, tx, [scribe]);
    console.log(`✓ memo written. tx: ${sig}`);
    console.log(`  explorer: https://explorer.solana.com/tx/${sig}`);
}

main().catch((e) => {
    console.error("scribe-memo failed:", (e as Error)?.message ?? e);
    process.exit(1);
});
