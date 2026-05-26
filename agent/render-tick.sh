#!/usr/bin/env bash
# Charybdis cron tick — runs the agent DIRECTLY on the host (Render), instead of
# dispatching the GitHub Actions workflow. Removes the dependency on the flaky
# workflow_dispatch endpoint; the only GitHub surface used is git (pull/push),
# which is resilient to Actions incidents.
#
# Run every ~5 min by the Render cron (see render.yaml). Each tick: refresh the
# repo, gate on cadence (trigger.mjs GATE_ONLY — ~20–25 min, or immediately on a
# stage crossing), and if it is time, run the cycle (fee-router → post → replies)
# and commit her log/state back to main. The agent's own post-side backstop
# (index.ts) is the second line against doubles if a tick ever overlaps.
set -uo pipefail
cd "$(dirname "$0")/.." # repo root

if [[ -z "${GH_TOKEN:-}" ]]; then echo "GH_TOKEN unset — cannot pull/push the log"; exit 1; fi

# Authenticated remote so the cron can pull the latest log/state and push the new
# one (GH_TOKEN needs contents:write on this repo).
git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/longicollis-labs/polyascus-gregaria.git"
git config user.name "charybdis"
git config user.email "charybdis@polyascus.com"
# Latest code + log/state. reset --hard so a half-finished prior tick can't wedge it.
if ! (git fetch origin main && git reset --hard origin/main); then
    echo "git refresh failed — holding this tick"
    exit 0
fi

# Cadence gate: exit 0 = post now, anything else (3 = not yet / error) = hold.
GATE_ONLY=1 node agent/trigger.mjs
if [[ $? -ne 0 ]]; then exit 0; fi

# Run the cycle, mirroring the GitHub Actions workflow. fee-router + replies are
# non-fatal: a failure there must never block (or unwind) her post.
(cd agent && npm run fee-router) || echo "fee-router failed (non-fatal)"
(cd agent && npm run run) || echo "run (post) failed"
(cd agent && npm run replies) || echo "replies failed (non-fatal)"

# Commit her updated log/state back to main, rebasing if the remote moved.
if [[ -n "$(git status --porcelain charybdis-log.json replies-log.json charybdis-state.json)" ]]; then
    git add charybdis-log.json replies-log.json charybdis-state.json
    git commit -m "log: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    for _ in 1 2 3; do
        git push origin HEAD:main && exit 0
        echo "push raced — rebasing and retrying"
        git fetch origin main && git rebase origin/main || git rebase --abort
    done
    echo "push failed after retries — next tick will re-sync"
else
    echo "no log changes"
fi
