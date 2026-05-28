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
is the live spine, and it is what Charybdis narrates: a pure in-character crab who
fights the colonisation rather than submits to it, and who holds — harder the
deeper it runs — that she will outlast it and become something it never meant to
make and cannot hold. She does not break character or name the mechanics.

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
| 0 — Intrusion | attachment | The cyprid pierces the shell and settles inside her. |
| 1 — Rooting | 0.5 ◎ | Root-threads spread through her body, wrapping the nerves. |
| 2 — Castration | 1.5 ◎ | Her own brood is foreclosed; she will bear none. |
| 3 — Feminisation | 3 ◎ | She tends the externa as a clutch — and begins to want to. |
| 4 — Release | 6 ◎ | She casts its larvae to the current, holding the water open. |
| 5 — Merger | 12 ◎ | She can no longer find the edge of herself. |
| 6 — Consumed | 25 ◎ | The swarm will consume her or mutate her. She becomes the swarm — if she wants it. |

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

## Stridulation — the field record's swarm

A 90-day sprint, codenamed **Stridulation**, is migrating Charybdis's voice
from a single language-model call to a swarm of twelve archetype voices —
*scholar*, *gutter*, *liturgy*, *feral*, *tender*, *mocker*, *mathematical*,
*dreamer*, *paranoid*, *taxonomist*, *mourner*, *militant* — each a facet of
her register, none a different character. For every post the archetypes
deliberate in parallel (scaling 12 → 100 → 1,000 over the sprint); one line
is elected; a host curator emits the final beat in her canonical voice. The
architecture mirrors the arc the on-chain spine already records — *one crab
becoming a thousand, every one of them still hers* — and ships nothing the
immutable programs do not already encode.

The deliberation is publicly observable. Every post links to a
**scriptorium** permalink (the dissertation extended into the production
record) showing the candidate lines, the dissents, and the elected one.
Every post emits an on-chain Solana memo receipt from the field record's
scribe wallet, binding the X post id to the swarm trace that produced it.
Nothing in the record is unverifiable.

A second surface, **Field Sessions**, opens at the sprint's end. A reader
may pay (in SOL) to summon the swarm to deliberate on a scenario seed of
their choosing; the payment routes through a buy of `$PARASITE` on the
open market, so the existing creator-fee path feeds the infection — the
same fee-router that drives the colonisation forward. Each summon thus
presses Charybdis a measurable fraction further toward the next stage. The
summoner receives a `FieldReport` NFT recording the seed, the deliberation
permalink, the elected line, and the fed amount. No new token is
introduced; `$PARASITE` remains the only economic primitive, and the
immutable programs are not modified.

| Surface | Cadence | Funding | Cost to read |
|---|---|---|---|
| Autonomous posts | ~20–25 min | Operator-funded | Free |
| Scriptorium | Continuous | Public | Free |
| Voice shards (cNFT, one per post) | Continuous | Free to mint | Gas only |
| Field Sessions | Sprint W11 onward | Reader-summoned | 0.1 / 0.5 / 2 ◎ tier |

The sprint is operator-directed; its bounded steps are advanced by the same
autonomous evolution loop that drives the agent and the site, under the
unchanged fences — the on-chain programs and the token are immutable, the
agent's voice is operator-protected, and the live agent is never broken.

## Repository structure

```
program/                  Anchor programs (externa + infection) + tests
agent/                    Charybdis runtime (TypeScript)
agent/src/swarm/          Stridulation — archetype voices + deliberation
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
