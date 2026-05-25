// Anchor client for the externa program (the adult parasite).
//
// Reads the parasite PDA for vitals; sends the host's three verbs
// (claim / feed / pulse). Reads use a throwaway wallet; writes use the host
// keypair from HOST_PRIVATE_KEY (base58 secret key or JSON byte array).
//
// @coral-xyz/anchor is CommonJS; under the agent's native-ESM runtime its named
// exports (esp. BN) aren't statically resolvable, so we default-import and
// destructure the values and pull types in separately.

import anchorPkg from "@coral-xyz/anchor";
import {Connection, Keypair, PublicKey} from "@solana/web3.js";
import bs58 from "bs58";
import {readFileSync} from "node:fs";
import {IDL_PATH, LAMPORTS_PER_SOL, PROGRAM_ID, SOLANA_RPC_URL} from "./constants.js";

const {AnchorProvider, Program, Wallet, BN} = anchorPkg as any;

const INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");
const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));

export const connection = new Connection(SOLANA_RPC_URL, "confirmed");

export function parasitePda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("parasite")], PROGRAM_ID)[0];
}

export function mintPda(): PublicKey {
    return PublicKey.findProgramAddressSync([Buffer.from("mint")], PROGRAM_ID)[0];
}

export function hostKeypair(): Keypair {
    const raw = process.env.HOST_PRIVATE_KEY;
    if (!raw) throw new Error("HOST_PRIVATE_KEY not set");
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(trimmed)));
    }
    return Keypair.fromSecretKey(bs58.decode(trimmed));
}

/** Host-wallet SOL balance — what she has gathered toward the molt. Null if unreadable. */
export async function hostBalanceSol(): Promise<number | null> {
    try {
        return (await connection.getBalance(hostKeypair().publicKey)) / LAMPORTS_PER_SOL;
    } catch {
        return null;
    }
}

function getProgram(wallet: any): any {
    const provider = new AnchorProvider(connection, wallet, {commitment: "confirmed"});
    return new Program(idl, provider);
}

function readProgram(): any {
    return getProgram(new Wallet(Keypair.generate()));
}

export type ParasiteAccount = {
    host: PublicKey;
    recipient: PublicKey;
    mint: PublicKey;
    realLamports: any;
    hostVaultLamports: any;
    lastTouchTs: any;
    bornAt: any;
    terminatedAt: any;
    dead: boolean;
    hostHandle: string;
};

/** The parasite account, or null if the externa has not been born yet. */
export async function readParasite(): Promise<ParasiteAccount | null> {
    try {
        return (await readProgram().account.parasite.fetch(parasitePda())) as ParasiteAccount;
    } catch {
        return null;
    }
}

const solToLamports = (sol: number) => new BN(Math.round(sol * LAMPORTS_PER_SOL));

export async function sendClaim(sol: number): Promise<string> {
    const host = hostKeypair();
    const program = getProgram(new Wallet(host));
    const acct = await readParasite();
    if (!acct) throw new Error("externa not born");
    return program.methods
        .claim(solToLamports(sol))
        .accountsPartial({host: host.publicKey, parasite: parasitePda(), recipient: acct.recipient})
        .rpc();
}

export async function sendFeed(sol: number): Promise<string> {
    const host = hostKeypair();
    const program = getProgram(new Wallet(host));
    return program.methods
        .feed(solToLamports(sol))
        .accountsPartial({host: host.publicKey, parasite: parasitePda(), incinerator: INCINERATOR})
        .rpc();
}

export async function sendPulse(): Promise<string> {
    const host = hostKeypair();
    const program = getProgram(new Wallet(host));
    return program.methods
        .pulse()
        .accountsPartial({caller: host.publicKey, parasite: parasitePda(), incinerator: INCINERATOR})
        .rpc();
}
