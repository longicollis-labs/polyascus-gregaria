/**
 * Integration tests for the Polyascus externa program.
 *
 * The pure economic numerics (curve, 0.5%/hr decay, compounding, the 200h
 * termination threshold, the post-decay sell cap, the 2.2% fee) are proven in
 * the Rust unit tests (`cargo test`). These tests prove the *plumbing*: SOL
 * custody on the PDA, the program-owned SPL mint, host-gating of claim/feed,
 * and — via bankrun clock-warping — real on-chain decay and termination.
 */
import { startAnchor, Clock, ProgramTestContext, BanksClient } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import { Program, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  Transaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  AccountLayout,
} from "@solana/spl-token";
import { assert } from "chai";
import * as fs from "fs";

// Loaded at runtime (relative to the program dir where ts-mocha is invoked) to
// avoid Node's ESM JSON import-attribute requirement.
const idl = JSON.parse(fs.readFileSync("./target/idl/polyascus.json", "utf8"));

const INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");
const ONE_SOL = 1_000_000_000;

describe("polyascus externa", () => {
  let context: ProgramTestContext;
  let client: BanksClient;
  let provider: BankrunProvider;
  let program: Program;
  let payer: Keypair;
  let host: Keypair;
  let recipient: Keypair;
  let alice: Keypair;
  let parasite: PublicKey;
  let mint: PublicKey;

  // Fresh ledger + freshly-born parasite for every test — no cross-test coupling.
  beforeEach(async () => {
    context = await startAnchor(".", [], []);
    client = context.banksClient;
    provider = new BankrunProvider(context);
    program = new Program(idl as any, provider);
    payer = context.payer;

    [parasite] = PublicKey.findProgramAddressSync([Buffer.from("parasite")], program.programId);
    [mint] = PublicKey.findProgramAddressSync([Buffer.from("mint")], program.programId);

    host = Keypair.generate();
    recipient = Keypair.generate();
    alice = Keypair.generate();
    await fund(host.publicKey, 2 * ONE_SOL);
    await fund(alice.publicKey, 100 * ONE_SOL);

    await program.methods
      .initialize(host.publicKey, recipient.publicKey, "CrabCharybdis")
      .accountsPartial({
        payer: payer.publicKey,
        parasite,
        mint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  });

  // ── helpers ────────────────────────────────────────────────────────────
  async function fund(to: PublicKey, lamports: number) {
    const tx = new Transaction();
    tx.add(SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: to, lamports }));
    tx.recentBlockhash = context.lastBlockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    await client.processTransaction(tx);
  }

  function ata(owner: PublicKey) {
    return getAssociatedTokenAddressSync(mint, owner);
  }

  async function tokenBalance(owner: PublicKey): Promise<bigint> {
    const acc = await client.getAccount(ata(owner));
    if (!acc) return 0n;
    return AccountLayout.decode(Buffer.from(acc.data)).amount;
  }

  async function solBalance(pk: PublicKey): Promise<bigint> {
    return await client.getBalance(pk);
  }

  function state(): Promise<any> {
    return (program.account as any).parasite.fetch(parasite);
  }

  async function buy(buyer: Keypair, lamports: number) {
    return program.methods
      .buy(new BN(lamports))
      .accountsPartial({
        buyer: buyer.publicKey,
        parasite,
        mint,
        buyerTokenAccount: ata(buyer.publicKey),
        incinerator: INCINERATOR,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
  }

  async function sell(seller: Keypair, tokens: bigint) {
    return program.methods
      .sell(new BN(tokens.toString()))
      .accountsPartial({
        seller: seller.publicKey,
        parasite,
        mint,
        sellerTokenAccount: ata(seller.publicKey),
        incinerator: INCINERATOR,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([seller])
      .rpc();
  }

  async function pulse(signer: Keypair) {
    return program.methods
      .pulse()
      .accountsPartial({ caller: signer.publicKey, parasite, incinerator: INCINERATOR })
      .signers([signer])
      .rpc();
  }

  async function timeTravel(addSeconds: number) {
    const clock = await client.getClock();
    context.setClock(
      new Clock(
        clock.slot + 1n,
        clock.epochStartTimestamp,
        clock.epoch,
        clock.leaderScheduleEpoch,
        clock.unixTimestamp + BigInt(addSeconds),
      ),
    );
  }

  // ── tests ──────────────────────────────────────────────────────────────

  it("initializes unborn", async () => {
    const p = await state();
    assert.equal(p.realLamports.toNumber(), 0);
    assert.equal(p.hostVaultLamports.toNumber(), 0);
    assert.equal(p.bornAt.toNumber(), 0);
    assert.isFalse(p.dead);
    assert.equal(p.host.toBase58(), host.publicKey.toBase58());
    assert.equal(p.recipient.toBase58(), recipient.publicKey.toBase58());
    assert.equal(p.hostHandle, "CrabCharybdis");
  });

  it("buy mints, skims the 2.2% fee, sets born_at", async () => {
    await buy(alice, ONE_SOL);
    const p = await state();
    const expectedFee = Math.floor((ONE_SOL * 220) / 10_000);
    assert.equal(p.hostVaultLamports.toNumber(), expectedFee, "fee mis-skimmed");
    assert.equal(p.realLamports.toNumber(), ONE_SOL - expectedFee, "reserve wrong");
    assert.isAbove(p.bornAt.toNumber(), 0, "born_at not set");
    assert.isAbove(Number(await tokenBalance(alice.publicKey)), 0, "no tokens minted");
  });

  it("price rises: a second equal buy mints fewer tokens", async () => {
    await buy(alice, ONE_SOL);
    const first = await tokenBalance(alice.publicKey);
    const bob = Keypair.generate();
    await fund(bob.publicKey, 100 * ONE_SOL);
    await buy(bob, ONE_SOL);
    const second = await tokenBalance(bob.publicKey);
    assert.isTrue(second < first, "price should have risen");
  });

  it("sell burns tokens, returns SOL (minus fee), grows the vault", async () => {
    await buy(alice, ONE_SOL);
    const tokens = await tokenBalance(alice.publicKey);
    const vaultBefore = (await state()).hostVaultLamports.toNumber();
    const solBefore = await solBalance(alice.publicKey);

    await sell(alice, tokens);

    assert.equal(Number(await tokenBalance(alice.publicKey)), 0, "tokens not burned");
    assert.isAbove(Number(await solBalance(alice.publicKey)), Number(solBefore), "no SOL returned");
    assert.isAbove((await state()).hostVaultLamports.toNumber(), vaultBefore, "no fee on sell");
    assert.isBelow(Number(await solBalance(alice.publicKey)), 100 * ONE_SOL, "seller profited");
  });

  it("claim: host-only, lands at the cold recipient, drains vault", async () => {
    await buy(alice, ONE_SOL);
    const vault = (await state()).hostVaultLamports;
    const recipBefore = await solBalance(recipient.publicKey);

    // wrong signer is rejected
    let rejected = false;
    try {
      await program.methods
        .claim(vault)
        .accountsPartial({ host: alice.publicKey, parasite, recipient: recipient.publicKey })
        .signers([alice])
        .rpc();
    } catch {
      rejected = true;
    }
    assert.isTrue(rejected, "non-host claim should fail");

    await program.methods
      .claim(vault)
      .accountsPartial({ host: host.publicKey, parasite, recipient: recipient.publicKey })
      .signers([host])
      .rpc();

    assert.equal((await state()).hostVaultLamports.toNumber(), 0, "vault not drained");
    assert.equal(
      Number(await solBalance(recipient.publicKey)) - Number(recipBefore),
      vault.toNumber(),
      "recipient did not receive the claim",
    );
  });

  it("feed: host pushes vault back into mass", async () => {
    await buy(alice, ONE_SOL);
    const p0 = await state();
    const vault = p0.hostVaultLamports.toNumber();
    const reserve = p0.realLamports.toNumber();

    await program.methods
      .feed(new BN(vault))
      .accountsPartial({ host: host.publicKey, parasite, incinerator: INCINERATOR })
      .signers([host])
      .rpc();

    const p1 = await state();
    assert.equal(p1.hostVaultLamports.toNumber(), 0, "vault not emptied");
    assert.equal(p1.realLamports.toNumber(), reserve + vault, "mass not refilled");
  });

  it("pulse after 1h decays the reserve ~0.5%", async () => {
    await buy(alice, ONE_SOL);
    const before = (await state()).realLamports.toNumber();
    await timeTravel(3600);
    await pulse(host);
    const after = (await state()).realLamports.toNumber();
    const eaten = before - after;
    const expected = Math.floor((before * 50) / 10_000);
    assert.approximately(eaten, expected, 2, "1h decay off");
  });

  it("terminates after 200h: dead, mass burned to incinerator, vault survives", async () => {
    await buy(alice, ONE_SOL);
    const vault = (await state()).hostVaultLamports.toNumber();
    const incinBefore = await solBalance(INCINERATOR);

    await timeTravel(200 * 3600 + 1);
    await pulse(host);

    const p = await state();
    assert.isTrue(p.dead, "should be dead");
    assert.equal(p.realLamports.toNumber(), 0, "reserve should be zero");
    assert.isAbove(p.terminatedAt.toNumber(), 0, "terminated_at not set");
    assert.equal(p.hostVaultLamports.toNumber(), vault, "vault drained on death");
    assert.isAbove(Number(await solBalance(INCINERATOR)), Number(incinBefore), "mass not burned");

    // buy reverts on the corpse
    let buyRejected = false;
    try {
      await buy(alice, ONE_SOL);
    } catch {
      buyRejected = true;
    }
    assert.isTrue(buyRejected, "buy should revert after death");

    // claim still works from the corpse
    await program.methods
      .claim(new BN(vault))
      .accountsPartial({ host: host.publicKey, parasite, recipient: recipient.publicKey })
      .signers([host])
      .rpc();
    assert.equal((await state()).hostVaultLamports.toNumber(), 0, "post-death claim failed");
  });
});
