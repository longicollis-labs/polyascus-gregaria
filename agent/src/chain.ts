// Phase-aware dispatch of the host's three verbs.
//
//                 larval (pump.fun)              adult (externa program)
//   claim   →     collectCreatorFee()            program.claim → cold recipient
//   feed    →     buyback(sol)                   program.feed  → mass
//   pulse   →     no-op (no decay clock yet)      program.pulse → crystallize decay

import * as program from "./program.js";
import * as pump from "./pumpfun.js";
import type {Phase} from "./state.js";

export async function sendClaim(sol: number, phase: Phase): Promise<string | null> {
    if (phase === "larval") return pump.collectCreatorFee();
    return program.sendClaim(sol);
}

export async function sendFeed(sol: number, phase: Phase): Promise<string | null> {
    if (phase === "larval") return pump.buyback(sol);
    return program.sendFeed(sol);
}

export async function sendPulse(phase: Phase): Promise<string | null> {
    if (phase === "larval" || phase === "unborn") return null; // no decay to advance
    return program.sendPulse();
}
