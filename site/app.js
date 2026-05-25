// Polls the externa program (adult) or the pump.fun shell (larval) and the
// host's field record. No build step. Set PUMP_MINT after the pump.fun launch;
// the program id + PDAs are fixed.

const PROGRAM_ID = "6GtAKbjHW5fdBPfZYd2zt5FvFk7fPDUhezScV9BFN1qE";
const PARASITE_PDA = "8SMaWuppqJxdh2GbWZJ1coYygMMQfgeaj2K1NUn9qGG";
const EXTERNA_MINT = "Hw5muMCG6b4RucNb2ep8n7EWwdDPjvzsZmZmEeZaZCMb";
const PUMP_MINT = "CAqw4VTrgYoeW8s9qox19hNs1p4W6DhCce2DfBgEpump"; // larval phase
const INFECTION_PDA = "6FVKnUGGv3LuwNGVwyiuCPsQKt9MrhZwDDU7ZybmTgtc"; // on-chain colonisation stage
const STAGE_NAMES = ["intrusion", "rooting", "castration", "feminisation", "release", "merger", "consumed"];

const SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com";
const DEXSCREENER = "https://api.dexscreener.com/latest/dex/tokens/";
const LOG_URL =
    "https://raw.githubusercontent.com/longicollis-labs/polyascus-gregaria/main/charybdis-log.json";
const POLL_MS = 15_000;

const VIRTUAL_SOL = 1; // 1 SOL virtual reserve
const MAX_SUPPLY = 10_000_000;
const DECAY_RATE_HR = 0.005; // 0.5%/hr
const UNTOUCHED_LIFESPAN_H = 200;

// ── RPC ─────────────────────────────────────────────────────────────────

async function rpc(method, params) {
    const res = await fetch(SOLANA_RPC_URL, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params}),
    });
    return (await res.json()).result;
}

function b64ToBytes(b64) {
    const bin = atob(b64);
    const a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
}

// Parse the Parasite account (after the 8-byte Anchor discriminator).
function decodeParasite(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u64 = (o) => Number(dv.getBigUint64(o, true));
    const i64 = (o) => Number(dv.getBigInt64(o, true));
    return {
        real_lamports: u64(104),
        vault_lamports: u64(112),
        last_touch_ts: i64(120),
        born_at: i64(128),
        terminated_at: i64(136),
        dead: bytes[144] === 1,
    };
}

// ── Formatters ────────────────────────────────────────────────────────────

function fmtSol(n) {
    if (!Number.isFinite(n) || n === 0) return "0.000000";
    if (n < 0.0001) return n.toExponential(3);
    return n.toFixed(6);
}
function fmtSolShort(n) {
    if (!Number.isFinite(n) || n === 0) return "0";
    if (n < 0.001) return n.toExponential(2);
    return n.toFixed(4);
}
function fmtSupply(n) {
    if (!n) return "0";
    if (n < 1_000) return n.toFixed(2);
    if (n < 1_000_000) return (n / 1_000).toFixed(2) + "k";
    return (n / 1_000_000).toFixed(3) + "m";
}
function fmtPrice(n) {
    if (!Number.isFinite(n) || n === 0) return "—";
    if (n < 1e-9) return n.toExponential(4);
    return n.toFixed(12);
}
function fmtDuration(seconds) {
    if (!seconds) return "—";
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d} d ${h} h`;
    if (h > 0) return `${h} h ${m} min`;
    return `${m} min`;
}
function fmtDurationShort(seconds) {
    if (!seconds) return "—";
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    if (d > 0) return `${d}d${h}h`;
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h${m}m`;
    return `${m}m`;
}
function fmtUsd(n) {
    if (!Number.isFinite(n) || n <= 0) return "$0";
    if (n < 1) return "<$1";
    if (n < 1_000) return "$" + Math.round(n);
    if (n < 1_000_000) return "$" + (n / 1_000).toFixed(1) + "k";
    if (n < 1_000_000_000) return "$" + (n / 1_000_000).toFixed(2) + "m";
    return "$" + (n / 1_000_000_000).toFixed(2) + "b";
}
function fmtTimestamp(iso) {
    const d = new Date(iso);
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const dd = String(d.getUTCDate()).padStart(2, "0");
    const hh = String(d.getUTCHours()).padStart(2, "0");
    const mi = String(d.getUTCMinutes()).padStart(2, "0");
    return `${dd} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${hh}:${mi} UTC`;
}

// ── SOL/USD (60s cache) ─────────────────────────────────────────────────

let solUsdCache = {price: null, at: 0};
async function getSolUsd() {
    const now = Date.now();
    if (solUsdCache.price !== null && now - solUsdCache.at < 60_000) return solUsdCache.price;
    try {
        const res = await fetch(
            "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd",
        );
        const data = await res.json();
        if (typeof data?.solana?.usd === "number") solUsdCache = {price: data.solana.usd, at: now};
    } catch (e) {
        /* keep stale */
    }
    return solUsdCache.price;
}

// ── Renderers ───────────────────────────────────────────────────────────

function setStats(items) {
    document.getElementById("status-text").innerHTML = items
        .map((s) => `<span class="stat"><span class="k">${s.k}</span><span class="v">${s.v}</span></span>`)
        .join('<span class="sep">·</span>');
}

async function refreshVitals() {
    const stateEl = document.getElementById("v-state");
    try {
        const info = await rpc("getAccountInfo", [PARASITE_PDA, {encoding: "base64"}]);

        // ── Adult: the externa program is live. ──
        if (info && info.value && info.value.data) {
            const p = decodeParasite(b64ToBytes(info.value.data[0]));
            const reserve = p.real_lamports / 1e9;
            const vault = p.vault_lamports / 1e9;

            let supply = 0;
            try {
                const s = await rpc("getTokenSupply", [EXTERNA_MINT]);
                supply = s?.value?.uiAmount ?? 0;
            } catch (e) {}

            const price = supply < MAX_SUPPLY ? (reserve + VIRTUAL_SOL) / (MAX_SUPPLY - supply) : 0;
            const now = Math.floor(Date.now() / 1000);
            const lifetime = p.born_at === 0 ? 0 : p.dead ? p.terminated_at - p.born_at : now - p.born_at;
            const label = p.dead ? "terminated" : p.born_at === 0 ? "unborn (externa formed, no inflow)" : "alive";

            stateEl.textContent = label;
            stateEl.classList.toggle("dead", p.dead);
            document.getElementById("contract-addr").textContent = EXTERNA_MINT;

            const stats = [{k: "phase", v: p.dead ? "terminated" : "externa"}];
            const solUsd = await getSolUsd();
            if (supply > 0 && solUsd) stats.push({k: "market cap", v: fmtUsd(supply * price * solUsd)});
            if (lifetime > 0) stats.push({k: "age", v: fmtDurationShort(lifetime)});
            setStats(stats);

            document.getElementById("v-reserve").textContent = fmtSol(reserve) + " SOL";
            document.getElementById("v-supply").textContent = fmtSupply(supply) + " $PARASITE";
            document.getElementById("v-price").textContent = fmtPrice(price) + " SOL / $PARASITE";
            document.getElementById("v-vault").textContent = fmtSol(vault) + " SOL";
            document.getElementById("v-lifetime").textContent = lifetime === 0 ? "not yet born" : fmtDuration(lifetime);
            document.getElementById("v-projeat").textContent = p.dead ? "—" : (reserve * DECAY_RATE_HR).toExponential(3) + " SOL · hour⁻¹";
            document.getElementById("v-projdeath").textContent = p.dead ? "—" : `${UNTOUCHED_LIFESPAN_H} hours (≈ 8.33 days)`;
            document.getElementById("side-reserve").textContent = fmtSolShort(reserve);
            document.getElementById("side-vault").textContent = fmtSolShort(vault);
            document.getElementById("side-lifetime").textContent = lifetime === 0 ? "—" : fmtDurationShort(lifetime);
            return;
        }

        // ── Larval: the cyprid on pump.fun. ──
        if (PUMP_MINT) {
            const res = await fetch(DEXSCREENER + PUMP_MINT);
            const data = await res.json();
            const pairs = data?.pairs ?? [];
            const pair = pairs.find((x) => (x.dexId ?? "").toLowerCase().includes("pump")) ?? pairs[0];
            stateEl.textContent = "alive · the brood rides her";
            stateEl.classList.remove("dead");
            document.getElementById("contract-addr").textContent = PUMP_MINT;

            if (pair) {
                const liq = Number(pair?.liquidity?.quote ?? 0);
                const price = Number(pair?.priceNative ?? 0);
                const mcap = Number(pair?.marketCap ?? pair?.fdv ?? 0);
                setStats([
                    {k: "phase", v: "infected"},
                    ...(mcap ? [{k: "market cap", v: fmtUsd(mcap)}] : []),
                ]);
                document.getElementById("v-reserve").textContent = fmtSol(liq) + " SOL (pool)";
                document.getElementById("v-price").textContent = fmtPrice(price) + " SOL / $PARASITE";
            } else {
                setStats([{k: "phase", v: "infected"}]);
            }
            document.getElementById("v-supply").textContent = "—";
            document.getElementById("v-vault").textContent = "creator fees (off-chart)";
            document.getElementById("v-lifetime").textContent = "the externa has erupted";
            document.getElementById("v-projeat").textContent = "— (no decay yet)";
            document.getElementById("v-projdeath").textContent = "— (no decay yet)";
            document.getElementById("side-reserve").textContent = "—";
            document.getElementById("side-vault").textContent = "—";
            document.getElementById("side-lifetime").textContent = "infected";
            return;
        }

        // ── Unborn ──
        stateEl.textContent = "awaiting launch";
        setStats([{k: "status", v: "awaiting launch"}]);
    } catch (e) {
        console.error("vitals fetch failed", e);
        stateEl.textContent = "telemetry error";
        document.getElementById("status-text").textContent = "telemetry error";
    }
}

async function refreshPosts() {
    const statusEl = document.getElementById("poly-status");
    try {
        const res = await fetch(LOG_URL + "?_=" + Date.now());
        if (!res.ok) throw new Error("log fetch failed");
        const log = await res.json();
        const posts = log.filter((e) => e.post_text && e.post_text.length > 0).slice(-20).reverse();

        const ol = document.getElementById("poly-posts");
        ol.innerHTML = "";
        for (const p of posts) {
            const li = document.createElement("li");
            const time = document.createElement("time");
            time.dateTime = p.ts;
            time.textContent = fmtTimestamp(p.ts);
            li.appendChild(time);
            const body = document.createElement("span");
            body.className = "body";
            body.textContent = p.post_text;
            li.appendChild(body);
            ol.appendChild(li);
        }
        statusEl.textContent =
            posts.length === 0 ? "No observations recorded. The parasite has not yet spoken." : "";
    } catch (e) {
        console.error("posts fetch failed", e);
        statusEl.textContent = "Observation log unavailable.";
    }
}

// ── Scrollspy ─────────────────────────────────────────────────────────────

function initScrollspy() {
    const links = Array.from(document.querySelectorAll("nav.toc a"));
    const targets = links
        .map((a) => {
            const id = a.getAttribute("href")?.slice(1);
            const el = id ? document.getElementById(id) : null;
            return el ? {a, el} : null;
        })
        .filter(Boolean);

    function setActive(id) {
        links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + id));
    }

    const observer = new IntersectionObserver(
        (entries) => {
            const visible = entries
                .filter((e) => e.isIntersecting)
                .sort((a, b) => a.target.offsetTop - b.target.offsetTop);
            if (visible.length > 0) setActive(visible[0].target.id);
        },
        {rootMargin: "-30% 0px -55% 0px", threshold: 0},
    );
    targets.forEach((t) => observer.observe(t.el));
    if (targets.length > 0) setActive(targets[0].el.id);
}

// ── Stage (the irreversible on-chain colonisation) ──────────────────────

function fmtSolLadder(lamports) {
    const sol = lamports / 1e9;
    const s = sol >= 10 ? sol.toFixed(0) : sol >= 1 ? sol.toFixed(2) : sol.toFixed(3);
    return s.replace(/\.?0+$/, "");
}

async function refreshStage() {
    const stageEl = document.getElementById("infection-stage");
    const ladder = document.getElementById("stage-ladder");
    const prog = document.getElementById("feed-progress");
    try {
        const info = await rpc("getAccountInfo", [INFECTION_PDA, {encoding: "base64"}]);
        if (!info || !info.value || !info.value.data) {
            if (stageEl) stageEl.textContent = "dormant";
            if (prog) prog.textContent = "the colony has not yet gathered.";
            return;
        }
        // layout after disc(8): host(32) recipient(32) thresholds(6×8) stage(1) fed(8)…
        const bytes = b64ToBytes(info.value.data[0]);
        const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const u64 = (o) => Number(dv.getBigUint64(o, true));
        const thresholds = [];
        for (let i = 0; i < 6; i++) thresholds.push(u64(72 + i * 8));
        const stage = bytes[120];
        const fed = u64(121);

        if (stageEl) stageEl.textContent = STAGE_NAMES[Math.min(stage, 6)] || "dormant";

        if (ladder) {
            ladder.querySelectorAll("li").forEach((li) => {
                const s = Number(li.dataset.stage);
                li.classList.toggle("reached", s <= stage);
                li.classList.toggle("current", s === stage);
            });
        }
        if (prog) {
            if (stage >= 6) {
                prog.textContent = `she is consumed · ${fmtSolLadder(fed)} ◎ fed in all · nothing remains to advance`;
            } else {
                const remain = Math.max(0, thresholds[stage] - fed);
                prog.textContent = `${fmtSolLadder(fed)} ◎ fed · ${fmtSolLadder(remain)} ◎ more tips her into ${STAGE_NAMES[stage + 1]}`;
            }
        }
    } catch (e) {
        /* leave as-is */
    }
}

window.__refreshStage = refreshStage;

// ── Loop ────────────────────────────────────────────────────────────────

async function loop() {
    await Promise.all([refreshVitals(), refreshPosts(), refreshStage()]);
    setTimeout(loop, POLL_MS);
}

document.addEventListener("DOMContentLoaded", () => {
    initScrollspy();
    loop();
});
