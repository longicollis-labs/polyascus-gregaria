// Feed SOL into the infection from a given keypair (operator pacing / tribute).
// The SOL pools in the keepalive vault (reclaimable); cumulative fed drives the
// stage. Env: FEEDER_KEYPAIR, FEED_SOL, SOLANA_RPC_URL
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

async function main() {
    const feeder = load(process.env.FEEDER_KEYPAIR ?? (() => {throw new Error("FEEDER_KEYPAIR not set");})());
    const sol = parseFloat(process.env.FEED_SOL ?? "0.1");
    const conn = new Connection(RPC, "confirmed");
    const [infection] = PublicKey.findProgramAddressSync([Buffer.from("infection")], PROGRAM_ID);
    const program = new Program(IDL, new AnchorProvider(conn, new Wallet(feeder), {commitment: "confirmed"}));

    const before = (await conn.getAccountInfo(infection))!.data;
    console.log("stage before:", before[120], `(${STAGES[before[120]!]})`);

    const sig = await program.methods
        .feed(new BN(Math.round(sol * 1e9)))
        .accountsPartial({feeder: feeder.publicKey, infection, systemProgram: SystemProgram.programId})
        .rpc();
    console.log(`fed ${sol} SOL  (${sig})`);

    const after = (await conn.getAccountInfo(infection))!.data;
    const dv = new DataView(after.buffer, after.byteOffset, after.byteLength);
    console.log("stage after :", after[120], `(${STAGES[after[120]!]})`, "· fed total:", Number(dv.getBigUint64(121, true)) / 1e9, "SOL");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
