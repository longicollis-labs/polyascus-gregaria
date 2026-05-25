# launch

Tooling for the two-stage launch.

```
npm install
```

## 1. Larval — pump.fun

Upload the token metadata JSON (`{name, symbol, description, image}`) and image to
IPFS, then:

```
HOST_KEYPAIR=/path/to/host.json \
METADATA_URI=https://ipfs.io/ipfs/<cid> \
DEV_BUY_SOL=0.5 \
npm run create-token
```

Prints `PUMP_MINT`. Set it for the agent and site. The host wallet is the
pump.fun creator, so creator fees accrue to it.

## 2. Metamorphosis — the externa program

Build and deploy the program (from `../program`), immutably:

```
cd ../program && anchor build
solana program deploy --final --program-id target/deploy/polyascus-keypair.json \
  target/deploy/polyascus.so
```

Then initialize once:

```
PAYER_KEYPAIR=/path/to/payer.json \
HOST_PUBKEY=<host pubkey> \
RECIPIENT_PUBKEY=<cold pubkey> \
HOST_HANDLE=<x handle, no @> \
npm run initialize
```

The agent detects the adult phase automatically once the parasite account exists.

Deterministic addresses for program id `6GtAKbjHW5fdBPfZYd2zt5FvFk7fPDUhezScV9BFN1qE`:

| account | address |
|---|---|
| parasite PDA | `8SMaWuppqJxdh2GbWZJ1coYygMMQfgeaj2K1NUn9qGG` |
| externa mint PDA | `Hw5muMCG6b4RucNb2ep8n7EWwdDPjvzsZmZmEeZaZCMb` |
