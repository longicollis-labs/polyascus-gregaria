/**
 * Integration tests for the infection (colonisation) program. Pure stage math
 * is in the Rust unit tests; these prove the plumbing: feeding moves SOL in and
 * advances the irreversible stage, and claim is host-gated and stage-safe.
 */
import {startAnchor, ProgramTestContext, BanksClient} from "solana-bankrun";
import {BankrunProvider} from "anchor-bankrun";
import {Program, BN} from "@coral-xyz/anchor";
import {PublicKey, Keypair, SystemProgram, Transaction} from "@solana/web3.js";
import {assert} from "chai";
import * as fs from "fs";

const idl = JSON.parse(fs.readFileSync("./target/idl/infection.json", "utf8"));
const E = 1_000_000_000;

describe("infection", () => {
    let context: ProgramTestContext;
    let client: BanksClient;
    let program: Program;
    let payer: Keypair;
    let host: Keypair;
    let recipient: Keypair;
    let infection: PublicKey;

    beforeEach(async () => {
        context = await startAnchor(".", [], []);
        client = context.banksClient;
        program = new Program(idl as any, new BankrunProvider(context));
        payer = context.payer;
        host = Keypair.generate();
        recipient = Keypair.generate();
        await fund(host.publicKey, 2 * E);
        [infection] = PublicKey.findProgramAddressSync([Buffer.from("infection")], program.programId);

        const thresholds = [0.5, 1.5, 3, 6, 12, 25].map((x) => new BN(Math.round(x * E)));
        await program.methods
            .initialize(host.publicKey, recipient.publicKey, thresholds)
            .accountsPartial({payer: payer.publicKey, infection, systemProgram: SystemProgram.programId})
            .rpc();
    });

    async function fund(to: PublicKey, lamports: number) {
        const tx = new Transaction();
        tx.add(SystemProgram.transfer({fromPubkey: payer.publicKey, toPubkey: to, lamports}));
        tx.recentBlockhash = context.lastBlockhash;
        tx.feePayer = payer.publicKey;
        tx.sign(payer);
        await client.processTransaction(tx);
    }
    const state = (): Promise<any> => (program.account as any).infection.fetch(infection);
    async function feed(lamports: number) {
        return program.methods
            .feed(new BN(lamports))
            .accountsPartial({feeder: payer.publicKey, infection, systemProgram: SystemProgram.programId})
            .rpc();
    }

    it("starts at stage 0", async () => {
        const s = await state();
        assert.equal(s.stage, 0);
        assert.equal(s.fedLamports.toNumber(), 0);
    });

    it("feeding moves SOL in and advances the stage", async () => {
        const vaultBefore = Number(await client.getBalance(infection));
        await feed(E / 2); // 0.5 SOL -> stage 1
        assert.equal((await state()).stage, 1);
        assert.isAbove(Number(await client.getBalance(infection)), vaultBefore, "SOL not custodied");
        await feed(E); // total 1.5 -> stage 2
        assert.equal((await state()).stage, 2);
        await feed(1.5 * E); // total 3 -> stage 3
        const s = await state();
        assert.equal(s.stage, 3);
        assert.equal(s.fedLamports.toNumber(), 3 * E);
        assert.equal(s.feeders.toNumber(), 3);
    });

    it("a single large feed jumps multiple stages, capped at 6", async () => {
        await feed(100 * E);
        assert.equal((await state()).stage, 6);
    });

    it("claim is host-only, lands at recipient, and never regresses the stage", async () => {
        await feed(E / 2); // stage 1, vault 0.5 SOL
        const recipBefore = Number(await client.getBalance(recipient.publicKey));

        let rejected = false;
        try {
            await program.methods
                .claim(new BN(E / 4))
                .accountsPartial({host: payer.publicKey, infection, recipient: recipient.publicKey})
                .rpc();
        } catch {
            rejected = true;
        }
        assert.isTrue(rejected, "non-host claim should fail");

        await program.methods
            .claim(new BN(E / 4))
            .accountsPartial({host: host.publicKey, infection, recipient: recipient.publicKey})
            .signers([host])
            .rpc();

        assert.equal(Number(await client.getBalance(recipient.publicKey)) - recipBefore, E / 4);
        assert.equal((await state()).stage, 1, "stage must not regress on claim");
    });
});
