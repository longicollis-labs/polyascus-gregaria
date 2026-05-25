// Reads the on-chain colonisation stage from the infection program. The stage
// (0..=6) only ever deepens and is driven by what the community feeds in. We
// decode the single `stage` byte directly — no IDL needed.

import {PublicKey} from "@solana/web3.js";
import {INFECTION_PROGRAM_ID} from "./constants.js";
import {connection} from "./program.js";

export const STAGE_NAMES = [
    "intrusion",
    "rooting",
    "castration",
    "feminisation",
    "release",
    "merger",
    "consumed",
] as const;

// Byte layout after the 8-byte discriminator: host(32) + recipient(32) +
// thresholds(6×8) = 120, so `stage: u8` sits at offset 120.
const STAGE_OFFSET = 8 + 32 + 32 + 6 * 8;

/** Current colonisation stage, or null if the infection program isn't live yet. */
export async function readStage(): Promise<{stage: number; name: string} | null> {
    try {
        const [pda] = PublicKey.findProgramAddressSync([Buffer.from("infection")], INFECTION_PROGRAM_ID);
        const info = await connection.getAccountInfo(pda);
        if (!info || info.data.length <= STAGE_OFFSET) return null;
        const stage = Math.min(info.data[STAGE_OFFSET]!, 6);
        return {stage, name: STAGE_NAMES[stage]!};
    } catch {
        return null;
    }
}
