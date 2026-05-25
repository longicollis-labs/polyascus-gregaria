// Initialize the infection program: stage 0, with fixed ascending thresholds
// (cumulative SOL fed to reach stages 1..6). Run ONCE, after deploying the
// program immutably (`solana program deploy --final`).
//
// Env:
//   PAYER_KEYPAIR        path to a funded keypair JSON, or a base58 secret key
//   HOST_PUBKEY          may claim the fed keepalive
//   RECIPIENT_PUBKEY     cold destination of every claim
//   THRESHOLDS_SOL       comma list, ascending (default "0.5,1.5,3,6,12,25")
//   INFECTION_PROGRAM_ID default 3vz8e6UCeWgGMh689mNTfxoZcY5KoKtMPbewBQJcT5v2
//   SOLANA_RPC_URL       default https://api.mainnet-beta.solana.com
//   IDL_PATH             default ../program/target/idl/infection.json

import anchorPkg from "@coral-xyz/anchor";
import {Connection, Keypair, PublicKey, SystemProgram} from "@solana/web3.js";
import bs58 from "bs58";
import {readFileSync} from "node:fs";

const {AnchorProvider, Program, Wallet, BN} = anchorPkg as any;

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const PROGRAM_ID = new PublicKey(
    process.env.INFECTION_PROGRAM_ID ?? "3vz8e6UCeWgGMh689mNTfxoZcY5KoKtMPbewBQJcT5v2",
);
const IDL_PATH = process.env.IDL_PATH ?? "../program/target/idl/infection.json";

function loadKeypair(v: string | undefined): Keypair {
    if (!v) throw new Error("PAYER_KEYPAIR not set");
    const t = v.trim();
    if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
    try {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(t, "utf8"))));
    } catch {
        return Keypair.fromSecretKey(bs58.decode(t));
    }
}
function req(k: string): string {
    const v = process.env[k];
    if (!v) throw new Error(`${k} not set`);
    return v;
}

async function main() {
    const payer = loadKeypair(process.env.PAYER_KEYPAIR);
    const host = new PublicKey(req("HOST_PUBKEY"));
    const recipient = new PublicKey(req("RECIPIENT_PUBKEY"));
    const thresholds = (process.env.THRESHOLDS_SOL ?? "0.5,1.5,3,6,12,25")
        .split(",")
        .map((x) => new BN(Math.round(parseFloat(x) * 1e9)));
    if (thresholds.length !== 6) throw new Error("THRESHOLDS_SOL must have exactly 6 values");

    const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
    const provider = new AnchorProvider(new Connection(RPC, "confirmed"), new Wallet(payer), {
        commitment: "confirmed",
    });
    const program = new Program(idl, provider);
    const [infection] = PublicKey.findProgramAddressSync([Buffer.from("infection")], PROGRAM_ID);

    console.log("program  :", PROGRAM_ID.toBase58());
    console.log("infection:", infection.toBase58());
    console.log("host     :", host.toBase58());
    console.log("recipient:", recipient.toBase58());
    console.log("thresholds (SOL):", thresholds.map((t: any) => t.toNumber() / 1e9).join(", "));

    const sig = await program.methods
        .initialize(host, recipient, thresholds)
        .accountsPartial({payer: payer.publicKey, infection, systemProgram: SystemProgram.programId})
        .rpc();

    console.log("\nthe infection begins, at stage 0.");
    console.log("tx =", sig);
    console.log("Feed it (anyone) to deepen the colonisation; the agent reads the stage each run.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
