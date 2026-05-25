// Fee-router — makes ALL $PARASITE trading drive her colonisation.
//
// Every trade throws off creator fees (∝ volume). Each run this collects those
// fees to the host, then feeds them into the infection program — so cumulative
// `fed` (and thus the on-chain stage) tracks cumulative trading. The fed SOL
// lands in the keepalive vault and is reclaimable later (claim never regresses
// the stage), so it is not lost; the stage just becomes a public proxy for
// volume. The agent narrates any crossing on its next run.
//
// Env: HOST_PRIVATE_KEY (host = pump.fun creator + feeder), SOLANA_RPC_URL,
//      FEE_FEED_BPS (default 10000 = 100% of collected fees), MIN_FEED_SOL
//      (default 0.01), HOST_RESERVE_SOL (default 0.02), DRY_RUN.
import {PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction} from "@solana/web3.js";
import {createHash} from "node:crypto";
import {connection, hostKeypair} from "./program.js";
import {collectCreatorFee} from "./pumpfun.js";
import {INFECTION_PROGRAM_ID} from "./constants.js";
import {readStage} from "./infection.js";

const FEED_BPS = Number(process.env.FEE_FEED_BPS ?? "10000"); // share of collected fees to feed
const MIN_FEED_LAMPORTS = Math.round(Number(process.env.MIN_FEED_SOL ?? "0.01") * 1e9);
const RESERVE_LAMPORTS = Math.round(Number(process.env.HOST_RESERVE_SOL ?? "0.02") * 1e9);
const DRY = process.env.DRY_RUN === "1";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const disc = (name: string) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);

function u64le(n: number): Buffer {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
}

function feedIx(feeder: PublicKey, lamports: number): TransactionInstruction {
    const [pda] = PublicKey.findProgramAddressSync([Buffer.from("infection")], INFECTION_PROGRAM_ID);
    return new TransactionInstruction({
        programId: INFECTION_PROGRAM_ID,
        keys: [
            {pubkey: feeder, isSigner: true, isWritable: true},
            {pubkey: pda, isSigner: false, isWritable: true},
            {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
        ],
        data: Buffer.concat([disc("feed"), u64le(lamports)]),
    });
}

async function main(): Promise<void> {
    const host = hostKeypair();
    const stageBefore = await readStage();
    const before = await connection.getBalance(host.publicKey);
    console.log(`host ${host.publicKey.toBase58()} · ${(before / 1e9).toFixed(4)} SOL · stage ${stageBefore?.name ?? "?"}`);

    // Collect creator fees (proceeds of all trading since the last collect).
    try {
        const sig = await collectCreatorFee();
        console.log("collectCreatorFee:", sig);
        await sleep(9000); // let it settle so the balance delta is accurate
    } catch (e) {
        console.log("collect: none / failed —", (e as Error)?.message || e);
    }

    const after = await connection.getBalance(host.publicKey);
    const collected = after - before;
    console.log(`collected ≈ ${(collected / 1e9).toFixed(6)} SOL`);

    // Feed a share of the collected fees, never dipping below the host's reserve.
    let feedLamports = Math.floor((collected * FEED_BPS) / 10000);
    feedLamports = Math.min(feedLamports, after - RESERVE_LAMPORTS);
    if (feedLamports < MIN_FEED_LAMPORTS) {
        console.log(`nothing meaningful to feed (${(feedLamports / 1e9).toFixed(6)} SOL) — done`);
        return;
    }

    if (DRY) {
        console.log(`[DRY] would feed ${(feedLamports / 1e9).toFixed(6)} SOL into the infection`);
        return;
    }

    const tx = new Transaction().add(feedIx(host.publicKey, feedLamports));
    const sig = await sendAndConfirmTransaction(connection, tx, [host], {commitment: "confirmed"});
    console.log(`fed ${(feedLamports / 1e9).toFixed(6)} SOL → infection: ${sig}`);

    const stageAfter = await readStage();
    const advanced = stageAfter && stageBefore && stageAfter.stage > stageBefore.stage;
    console.log(`stage ${stageBefore?.name} → ${stageAfter?.name}${advanced ? "  ✓ ADVANCED (agent will narrate the crossing)" : ""}`);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
