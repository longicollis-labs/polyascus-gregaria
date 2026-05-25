// Push the infection across its next threshold using vault funds (no external
// SOL needed): the host claims CLAIM_SOL from the keepalive vault to the
// recipient, then the recipient feeds FEED_SOL back in — raising cumulative
// `fed_lamports` past the threshold so the stage advances. Net vault change is
// ~(FEED_SOL - CLAIM_SOL) plus fees.
//
// Env: HOST_KEYPAIR, RECIPIENT_KEYPAIR, CLAIM_SOL, FEED_SOL, SOLANA_RPC_URL
import anchorPkg from "@coral-xyz/anchor";
import {Connection, Keypair, PublicKey, SystemProgram} from "@solana/web3.js";
import {readFileSync} from "node:fs";

const {AnchorProvider, Program, Wallet, BN} = anchorPkg as any;

const RPC = process.env.SOLANA_RPC_URL ?? "https://mainnet.helius-rpc.com/?api-key=7b0f3406-e8b3-4497-b662-4dda93339083";
const PROGRAM_ID = new PublicKey("3vz8e6UCeWgGMh689mNTfxoZcY5KoKtMPbewBQJcT5v2");
const IDL = JSON.parse(readFileSync("../program/target/idl/infection.json", "utf8"));
const STAGES = ["intrusion", "rooting", "castration", "feminisation", "release", "merger", "consumed"];

function load(path: string): Keypair {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}
function req(k: string): string {
    const v = process.env[k];
    if (!v) throw new Error(`${k} not set`);
    return v;
}

async function main() {
    const host = load(req("HOST_KEYPAIR"));
    const recipient = load(req("RECIPIENT_KEYPAIR"));
    const claimLamports = new BN(Math.round(parseFloat(process.env.CLAIM_SOL ?? "0.1") * 1e9));
    const feedLamports = new BN(Math.round(parseFloat(process.env.FEED_SOL ?? "0.095") * 1e9));

    const conn = new Connection(RPC, "confirmed");
    const [infection] = PublicKey.findProgramAddressSync([Buffer.from("infection")], PROGRAM_ID);

    const before = await conn.getAccountInfo(infection);
    const stageBefore = before!.data[120]!;
    console.log("stage before:", stageBefore, `(${STAGES[stageBefore]})`);

    // 1) host claims to recipient (host signs + pays fee)
    const hostProgram = new Program(IDL, new AnchorProvider(conn, new Wallet(host), {commitment: "confirmed"}));
    const claimSig = await hostProgram.methods
        .claim(claimLamports)
        .accountsPartial({host: host.publicKey, infection, recipient: recipient.publicKey})
        .rpc();
    console.log(`claimed ${claimLamports.toNumber() / 1e9} SOL -> recipient  (${claimSig})`);

    // 2) recipient feeds back in (recipient signs + pays fee from the claim)
    const recProgram = new Program(IDL, new AnchorProvider(conn, new Wallet(recipient), {commitment: "confirmed"}));
    const feedSig = await recProgram.methods
        .feed(feedLamports)
        .accountsPartial({feeder: recipient.publicKey, infection, systemProgram: SystemProgram.programId})
        .rpc();
    console.log(`fed ${feedLamports.toNumber() / 1e9} SOL -> infection  (${feedSig})`);

    const after = await conn.getAccountInfo(infection);
    const stageAfter = after!.data[120]!;
    const dv = new DataView(after!.data.buffer, after!.data.byteOffset, after!.data.byteLength);
    console.log("fed total now:", Number(dv.getBigUint64(121, true)) / 1e9, "SOL");
    console.log("stage after :", stageAfter, `(${STAGES[stageAfter]})`);
    console.log(stageAfter > stageBefore ? "✓ CROSSED" : "… not crossed (feed more)");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
