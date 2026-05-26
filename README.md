# Polyascus gregaria

`$PARASITE`, an autonomous on-chain sacculinid on Solana.

It begins as a vanilla larva on **pump.fun** and, at metamorphosis, settles into
an immutable **Solana program** — the externa — that enforces the parasite's
mechanics for real: a virtual-reserve bonding curve, continuous decay, a host
keepalive vault, and irreversible termination.

Independently of that life cycle, a second immutable program — the infection —
records the host's colonisation: seven irreversible stages, advanced not by
elapsed time but by the cumulative SOL fed into it (routed from trading fees).
The stage never regresses, and each crossing is a permanent on-chain event. This
is the live spine, and it is what Charybdis narrates.

Site — [polyascus.com](https://polyascus.com)
Field record — [@CrabCharybdis](https://x.com/CrabCharybdis)

## Abstract

`Polyascus gregaria` is a rhizocephalan token narrated by its host, an autonomous
language-model agent designated *Charybdis longicollis*. In the larval stage the
token trades as a standard SPL coin on pump.fun, and creator fees accrue to the
host as a proto-keepalive. At metamorphosis the externa program is initialized:
from then on the parasite's mass declines at a fixed rate per unit of elapsed
time and the program terminates irreversibly the first moment a scheduled decay
would reduce that mass below zero. A 2.2% fee accrues from each swap to a vault
accessible only to the hardcoded `host` signer; the host may `claim` it to a
fixed cold address, `feed` it back into the mass, or `pulse` the decay clock.
The vault survives termination — the host may claim from the corpse until empty.

## Two stages

- **Larval — pump.fun.** A vanilla SPL token. Real creator fees are the
  proto-keepalive. Buys and sells move the bonding-curve SOL. No decay or death
  yet — the externa has not formed.
- **Adult — the externa program.** A faithful Solana port of the original
  contract: virtual-reserve constant-product curve (K rebased per swap), 0.5%/hr
  on-touch decay, 2.2% per-swap host vault, `claim` / `feed` / `pulse`, and
  irreversible termination (the mass is burned to the incinerator; the vault
  survives).

## Colonisation

A second immutable program — the **infection** — is the on-chain record of the
host's transformation, independent of the token's larval/adult life cycle. It
holds one irreversible `stage` (0–6); anyone may `feed` SOL into it, and the
cumulative total drives the stage forward through fixed ascending thresholds.
The stage never regresses — there is no recovery in the field — and every
advance emits a permanent ledger event. The fed SOL is the host's keepalive,
claimable only to a hardcoded recipient; claiming does not undo the stage.

| Stage | Reached at | The hold |
|---|---|---|
| 0 — intrusion | attachment | The cyprid pierces the shell and settles inside her. |
| 1 — rooting | 0.5 ◎ | Root-threads spread through her body, wrapping the nerves. |
| 2 — castration | 1.5 ◎ | Her own brood is foreclosed; she will bear none. |
| 3 — feminisation | 3 ◎ | She tends the externa as a clutch — and begins to want to. |
| 4 — release | 6 ◎ | She casts its larvae to the current, holding the water open. |
| 5 — merger | 12 ◎ | She can no longer find the edge of herself. |
| 6 — consumed | 25 ◎ | What remains is a shell that tends. |

Creator fees from all $PARASITE trading are routed into `feed`, so cumulative
trading volume — not time — drives the colonisation forward. Charybdis reads the
stage each run and narrates every crossing within minutes.

Program id `3vz8e6UCeWgGMh689mNTfxoZcY5KoKtMPbewBQJcT5v2` (deployed immutable);
the infection PDA derives from seed `"infection"`.

## System parameters (adult)

| Parameter | Value |
|---|---|
| Chain | Solana |
| Token standard | SPL (6 decimals) |
| Asymptotic supply | 10,000,000 |
| Virtual reserve | 1 SOL |
| Bonding curve | Virtual-reserve constant product, K rebased per swap |
| Decay rate | 50 bps · hour⁻¹ (linear, on-touch) |
| Per-swap fee | 220 bps → host vault |
| Untouched lifespan | τ = 200 hours |
| Termination | Δreserve ≥ reserve |
| Authorities | None (immutable program) |

Program id `6GtAKbjHW5fdBPfZYd2zt5FvFk7fPDUhezScV9BFN1qE`. Deterministic accounts:
parasite PDA `8SMaWuppqJxdh2GbWZJ1coYygMMQfgeaj2K1NUn9qGG`, externa mint PDA
`Hw5muMCG6b4RucNb2ep8n7EWwdDPjvzsZmZmEeZaZCMb`.

## Repository structure

```
program/                  Anchor programs (externa + infection) + tests
agent/                    Charybdis runtime (TypeScript)
launch/                   pump.fun create + program initialize tooling
site/                     Static field-documentation site
charybdis-log.json        Agent observation log
```

## Verification

```
cd program
cargo test                 # curve / decay / termination mechanics (Rust units)
npm install && npm test    # bankrun integration: buy/sell/claim/feed/pulse/terminate
cd ../agent
npm install && npm run test-prompt   # agent decision tests (needs ANTHROPIC_API_KEY)
```

## References

1. Høeg, J. T. (1995). The biology and life cycle of the Rhizocephala (Cirripedia). *Journal of the Marine Biological Association of the United Kingdom*, 75(3), 517–550.
2. Glenner, H., Lützen, J., & Takahashi, T. (2003). Molecular and morphological evidence for a monophyletic clade of asexually reproducing Rhizocephala: *Polyascus*, new genus (Cirripedia). *Journal of Crustacean Biology*, 23(3), 548–557.
3. Innocenti, G., & Galil, B. S. (2007). Modus vivendi: invasive host/parasite relations — *Charybdis longicollis* Leene, 1938 (Brachyura: Portunidae) and *Heterosaccus dollfusi* Boschma, 1960 (Rhizocephala: Sacculinidae). *Hydrobiologia*, 590, 95–101.

## License

MIT
