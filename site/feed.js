// feed.js — the actuator. Lets anyone deepen the colonisation: a single `feed`
// instruction to the infection program, signed by the visitor's own wallet. The
// SOL is custodied by the program and added, permanently, to the cumulative
// total that drives the irreversible stage. No build step — web3.js is pulled
// as an ESM module from a CDN.
import {
    Connection,
    PublicKey,
    Transaction,
    TransactionInstruction,
    SystemProgram,
} from "https://esm.sh/@solana/web3.js@1.98.0";

const RPC = "https://solana-rpc.publicnode.com";
const INFECTION_PROGRAM = new PublicKey("3vz8e6UCeWgGMh689mNTfxoZcY5KoKtMPbewBQJcT5v2");
const INFECTION_PDA = new PublicKey("6FVKnUGGv3LuwNGVwyiuCPsQKt9MrhZwDDU7ZybmTgtc");
// sha256("global:feed")[0..8] — verified against the on-chain IDL.
const FEED_DISC = new Uint8Array([46, 213, 237, 176, 190, 113, 182, 94]);

const conn = new Connection(RPC, "confirmed");
let connected = null; // PublicKey

function provider() {
    const p = window.phantom?.solana || window.solana || window.backpack;
    return p && (p.isPhantom || p.isBackpack || typeof p.signAndSendTransaction === "function" || typeof p.signTransaction === "function")
        ? p
        : null;
}

function status(msg, kind = "") {
    const el = document.getElementById("feed-status");
    if (el) {
        el.textContent = msg;
        el.dataset.kind = kind;
    }
}

function short(pk) {
    const s = pk.toBase58();
    return s.slice(0, 4) + "…" + s.slice(-4);
}

function u64le(lamports) {
    const b = new Uint8Array(8);
    let x = BigInt(lamports);
    for (let i = 0; i < 8; i++) {
        b[i] = Number(x & 0xffn);
        x >>= 8n;
    }
    return b;
}

function feedIx(feeder, lamports) {
    const data = new Uint8Array(16);
    data.set(FEED_DISC, 0);
    data.set(u64le(lamports), 8);
    return new TransactionInstruction({
        programId: INFECTION_PROGRAM,
        keys: [
            {pubkey: feeder, isSigner: true, isWritable: true},
            {pubkey: INFECTION_PDA, isSigner: false, isWritable: true},
            {pubkey: SystemProgram.programId, isSigner: false, isWritable: false},
        ],
        data,
    });
}

async function connect() {
    const p = provider();
    if (!p) {
        status("No Solana wallet found — install Phantom, then reload.", "err");
        return null;
    }
    try {
        const res = await p.connect();
        const pk = res?.publicKey || p.publicKey;
        connected = new PublicKey(pk.toString());
        const btn = document.getElementById("feed-connect");
        if (btn) btn.textContent = "connected · " + short(connected);
        status("Pick an amount. Every offering settles into her, permanently.");
        return connected;
    } catch {
        status("you pulled your hand back.", "err");
        return null;
    }
}

async function feed(sol) {
    if (!(sol > 0)) {
        status("enter an amount first.", "err");
        return;
    }
    const p = provider();
    if (!p) {
        status("No Solana wallet found — install Phantom, then reload.", "err");
        return;
    }
    if (!connected && !(await connect())) return;

    try {
        status("she is waiting…");
        const lamports = BigInt(Math.round(sol * 1e9));
        const tx = new Transaction().add(feedIx(connected, lamports));
        const {blockhash} = await conn.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash;
        tx.feePayer = connected;

        let signature;
        if (typeof p.signAndSendTransaction === "function") {
            const res = await p.signAndSendTransaction(tx);
            signature = res?.signature || res;
        } else {
            const signed = await p.signTransaction(tx);
            signature = await conn.sendRawTransaction(signed.serialize());
        }

        // Poll over HTTP — the public RPC may not serve the websocket that
        // Connection.confirmTransaction relies on.
        status("the offering broke the surface. confirming…");
        let confirmed = false;
        for (let i = 0; i < 30 && !confirmed; i++) {
            await new Promise((r) => setTimeout(r, 1500));
            const st = await conn.getSignatureStatuses([signature]);
            const s = st?.value?.[0];
            if (s?.err) throw new Error("the colonisation rejected it");
            if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) confirmed = true;
        }
        status(confirmed ? "it settled into her. she is deeper now." : "sent — it will settle shortly.", "ok");
        window.__refreshStage?.();
    } catch (e) {
        const m = (e && e.message) || String(e);
        status(/reject|denied|cancel/i.test(m) ? "you pulled your hand back." : "it would not take: " + m, "err");
    }
}

window.addEventListener("DOMContentLoaded", () => {
    const c = document.getElementById("feed-connect");
    if (c) c.addEventListener("click", connect);
    document.querySelectorAll(".feed-amt[data-feed]").forEach((b) => {
        b.addEventListener("click", () => feed(parseFloat(b.dataset.feed)));
    });
    const go = document.getElementById("feed-custom-go");
    if (go) {
        go.addEventListener("click", () => {
            const v = parseFloat(document.getElementById("feed-custom")?.value);
            feed(v);
        });
    }
});
