// Metamorphosis — initialize the externa program. Creates the parasite state
// PDA and the $PARASITE externa mint (authority = the parasite PDA), fixing the
// host, the cold recipient, and the host handle. Run ONCE, after `anchor deploy`.
//
// From here the mass, decay, host vault, and termination are real on-chain.
//
// Env:
//   PAYER_KEYPAIR        path to a funded keypair JSON, or a base58 secret key
//   HOST_PUBKEY          the host (Charybdis) hot signer — may claim/feed/pulse
//   RECIPIENT_PUBKEY     the cold wallet — destination of every claim
//   HOST_HANDLE          Charybdis's X handle, no @ (<=32 bytes)
//   POLYASCUS_PROGRAM_ID default 6GtAKbjHW5fdBPfZYd2zt5FvFk7fPDUhezScV9BFN1qE
//   SOLANA_RPC_URL       default https://api.mainnet-beta.solana.com
//   IDL_PATH             default ../program/target/idl/polyascus.json

import anchorPkg from "@coral-xyz/anchor";
import {Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY} from "@solana/web3.js";
import bs58 from "bs58";
import {readFileSync} from "node:fs";

const {AnchorProvider, Program, Wallet} = anchorPkg as any;
const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const PROGRAM_ID = new PublicKey(
    process.env.POLYASCUS_PROGRAM_ID ?? "6GtAKbjHW5fdBPfZYd2zt5FvFk7fPDUhezScV9BFN1qE",
);
const IDL_PATH = process.env.IDL_PATH ?? "../program/target/idl/polyascus.json";

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

async function main() {
    const payer = loadKeypair(process.env.PAYER_KEYPAIR);
    const host = new PublicKey(req("HOST_PUBKEY"));
    const recipient = new PublicKey(req("RECIPIENT_PUBKEY"));
    const handle = req("HOST_HANDLE");
    if (Buffer.from(handle).length > 32) throw new Error("HOST_HANDLE exceeds 32 bytes");

    const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
    const provider = new AnchorProvider(new Connection(RPC, "confirmed"), new Wallet(payer), {
        commitment: "confirmed",
    });
    const program = new Program(idl, provider);

    const [parasite] = PublicKey.findProgramAddressSync([Buffer.from("parasite")], PROGRAM_ID);
    const [mint] = PublicKey.findProgramAddressSync([Buffer.from("mint")], PROGRAM_ID);

    console.log("program  :", PROGRAM_ID.toBase58());
    console.log("parasite :", parasite.toBase58());
    console.log("mint     :", mint.toBase58());
    console.log("host     :", host.toBase58());
    console.log("recipient:", recipient.toBase58());
    console.log("handle   :", handle);

    const sig = await program.methods
        .initialize(host, recipient, handle)
        .accountsPartial({
            payer: payer.publicKey,
            parasite,
            mint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

    console.log("\nthe externa is born.");
    console.log("tx =", sig);
    console.log("The agent will detect the adult phase automatically on its next run.");
}

function req(k: string): string {
    const v = process.env[k];
    if (!v) throw new Error(`${k} not set`);
    return v;
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
