// Close-down — reclaim everything reclaimable from the infection and sweep it
// to a single external wallet. The two programs are immutable (`--final`), so
// their account rent is permanently locked and CANNOT be recovered; the only
// reclaimable SOL is (a) the keepalive vault, claimable to the hardcoded
// recipient, and (b) the host + recipient wallet balances.
//
// Steps: claim the FULL vault -> recipient (host signs), then sweep recipient
// and host wallets -> DEST.
//
// Env: HOST_KEYPAIR, RECIPIENT_KEYPAIR, DEST, SOLANA_RPC_URL, DRY_RUN(=1 prints only)
import anchorPkg from "@coral-xyz/anchor";
import {Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction} from "@solana/web3.js";
import {readFileSync} from "node:fs";

const {AnchorProvider, Program, Wallet, BN} = anchorPkg as any;

const RPC = process.env.SOLANA_RPC_URL ?? "https://mainnet.helius-rpc.com/?api-key=7b0f3406-e8b3-4497-b662-4dda93339083";
const PROGRAM_ID = new PublicKey("3vz8e6UCeWgGMh689mNTfxoZcY5KoKtMPbewBQJcT5v2");
const IDL = JSON.parse(readFileSync("../program/target/idl/infection.json", "utf8"));
const FEE = 5000; // base fee, 1 signature, no priority fee
const DRY = process.env.DRY_RUN === "1";

function load(path: string): Keypair {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
function req(k: string): string {
    const v = process.env[k];
    if (!v) throw new Error(`${k} not set`);
    return v;
}
const sol = (n: number | bigint) => (Number(n) / 1e9).toFixed(9);

async function sweep(conn: any, from: Keypair, dest: PublicKey, label: string) {
    const bal = await conn.getBalance(from.publicKey);
    if (bal <= FEE) {
        console.log(`  ${label} ${from.publicKey.toBase58()}: ${sol(bal)} SOL — nothing to sweep`);
        return;
    }
    const amount = bal - FEE;
    if (DRY) {
        console.log(`  [dry] ${label}: would sweep ${sol(amount)} SOL -> ${dest.toBase58()}`);
        return;
    }
    const tx = new Transaction().add(SystemProgram.transfer({fromPubkey: from.publicKey, toPubkey: dest, lamports: amount}));
    const sig = await sendAndConfirmTransaction(conn, tx, [from], {commitment: "confirmed"});
    console.log(`  ${label}: swept ${sol(amount)} SOL -> ${dest.toBase58()}  (${sig})`);
}

async function main() {
    const host = load(req("HOST_KEYPAIR"));
    const recipient = load(req("RECIPIENT_KEYPAIR"));
    const dest = new PublicKey(req("DEST"));
    const conn = new Connection(RPC, "confirmed");
    const [infection] = PublicKey.findProgramAddressSync([Buffer.from("infection")], PROGRAM_ID);

    console.log(DRY ? "=== DRY RUN (no broadcast) ===" : "=== LIVE ===");
    console.log("host     :", host.publicKey.toBase58());
    console.log("recipient:", recipient.publicKey.toBase58());
    console.log("dest     :", dest.toBase58());

    // 1) read fresh vault_lamports (offset 8+32+32+48+1+8 = 129)
    const acct = await conn.getAccountInfo(infection, "confirmed");
    if (!acct) throw new Error("infection PDA not found");
    const vault = acct.data.readBigUInt64LE(129);
    const stage = acct.data.readUInt8(120);
    console.log(`\ninfection PDA ${infection.toBase58()}: total ${sol(acct.lamports)} SOL, vault_lamports ${sol(vault)} SOL, stage ${stage}`);

    // 2) claim the full vault -> recipient (host signs + pays fee)
    if (vault > 0n) {
        if (DRY) {
            console.log(`  [dry] would claim ${sol(vault)} SOL -> recipient`);
        } else {
            const program = new Program(IDL, new AnchorProvider(conn, new Wallet(host), {commitment: "confirmed"}));
            const sig = await program.methods
                .claim(new BN(vault.toString()))
                .accountsPartial({host: host.publicKey, infection, recipient: recipient.publicKey})
                .rpc();
            console.log(`  claimed ${sol(vault)} SOL -> recipient  (${sig})`);
        }
    } else {
        console.log("  vault already empty");
    }

    // 3) sweep recipient then host -> dest
    console.log("\nsweeps:");
    await sweep(conn, recipient, dest, "recipient");
    await sweep(conn, host, dest, "host");

    // 4) final balances
    console.log("\nfinal balances:");
    for (const [l, pk] of [["host     ", host.publicKey], ["recipient", recipient.publicKey], ["dest     ", dest], ["vault PDA", infection]] as const) {
        console.log(`  ${l}: ${sol(await conn.getBalance(pk))} SOL`);
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
