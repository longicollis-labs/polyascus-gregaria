// Larval launch — create the $PARASITE token on pump.fun via PumpPortal's
// local (self-signed) transaction API. The host wallet is the pump.fun creator,
// so creator fees accrue to it as the proto-keepalive.
//
// Prereqs:
//   • a host keypair, funded with SOL (dev buy + fees)
//   • a metadata URI: upload the specimen image + a JSON {name,symbol,description,image}
//     to IPFS (Pinata etc.) and pass the resulting URI. pump.fun's legacy IPFS
//     endpoint is deprecated.
//
// Env:
//   HOST_KEYPAIR      path to host keypair JSON, or a base58 secret key
//   METADATA_URI      IPFS URI of the token metadata JSON  (required)
//   DEV_BUY_SOL       initial dev buy in SOL                (default 0.5)
//   SOLANA_RPC_URL    default https://api.mainnet-beta.solana.com
//   TOKEN_NAME        default "Polyascus gregaria"
//   TOKEN_SYMBOL      default "PARASITE"
//
// Writes the new mint keypair to ./pump-mint.json — keep it. Prints the mint
// address; set it as PUMP_MINT for the agent + site.

import {Connection, Keypair, VersionedTransaction} from "@solana/web3.js";
import bs58 from "bs58";
import {readFileSync, writeFileSync} from "node:fs";

const RPC = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const METADATA_URI = process.env.METADATA_URI;
const DEV_BUY_SOL = Number(process.env.DEV_BUY_SOL ?? "0.5");
const NAME = process.env.TOKEN_NAME ?? "Polyascus gregaria";
const SYMBOL = process.env.TOKEN_SYMBOL ?? "PARASITE";

function loadKeypair(v: string | undefined): Keypair {
    if (!v) throw new Error("HOST_KEYPAIR not set");
    const t = v.trim();
    if (t.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(t)));
    try {
        return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(t, "utf8"))));
    } catch {
        return Keypair.fromSecretKey(bs58.decode(t));
    }
}

async function main() {
    if (!METADATA_URI) throw new Error("METADATA_URI required (IPFS URI of the metadata JSON)");
    const host = loadKeypair(process.env.HOST_KEYPAIR);
    const mint = Keypair.generate();
    writeFileSync("./pump-mint.json", JSON.stringify(Array.from(mint.secretKey)));
    console.log("host  :", host.publicKey.toBase58());
    console.log("mint  :", mint.publicKey.toBase58(), "(saved to ./pump-mint.json)");

    const res = await fetch("https://pumpportal.fun/api/trade-local", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
            publicKey: host.publicKey.toBase58(),
            action: "create",
            tokenMetadata: {name: NAME, symbol: SYMBOL, uri: METADATA_URI},
            mint: mint.publicKey.toBase58(),
            denominatedInSol: "true",
            amount: DEV_BUY_SOL,
            slippage: 10,
            priorityFee: 0.0005,
            pool: "pump",
        }),
    });
    if (!res.ok) throw new Error(`pumpportal ${res.status}: ${await res.text()}`);

    const tx = VersionedTransaction.deserialize(new Uint8Array(await res.arrayBuffer()));
    tx.sign([host, mint]); // the mint account must sign its own creation
    const sig = await new Connection(RPC, "confirmed").sendTransaction(tx);

    console.log("\nlarva attached.");
    console.log("PUMP_MINT =", mint.publicKey.toBase58());
    console.log("tx        =", sig);
    console.log("\nSet PUMP_MINT in the agent env and site, then run the agent.");
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
