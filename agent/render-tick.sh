#!/usr/bin/env bash
# Charybdis cron tick — runs the agent DIRECTLY on the host (Render), instead of
# dispatching the GitHub Actions workflow. Removes the dependency on the flaky
# workflow_dispatch endpoint; the only GitHub surface used is git clone/push,
# which survives Actions incidents.
#
# The Render runtime checkout has no .git/origin, so each tick we clone main
# FRESH (auth via GH_TOKEN, contents:write), reuse the dependencies the build
# already installed (symlink node_modules), gate on cadence (trigger.mjs
# GATE_ONLY — ~20–25 min, or immediately on a stage crossing), run the cycle
# (fee-router → post → replies), and push her log/state back to main. The agent's
# own post-side backstop (index.ts) is the second line against doubles.
set -uo pipefail
if [[ -z "${GH_TOKEN:-}" ]]; then echo "GH_TOKEN unset — cannot clone/push the log"; exit 1; fi

DEPLOYED="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="https://x-access-token:${GH_TOKEN}@github.com/longicollis-labs/polyascus-gregaria.git"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

if ! git clone --depth 1 "$REMOTE" "$WORK" 2>/dev/null; then echo "clone failed — holding this tick"; exit 0; fi
git -C "$WORK" config user.name "charybdis"
git -C "$WORK" config user.email "charybdis@polyascus.com"
# Reuse the deps the build installed (the fresh clone has no node_modules).
ln -s "$DEPLOYED/agent/node_modules" "$WORK/agent/node_modules"
cd "$WORK"

# Cadence gate: exit 0 = post now, anything else (3 = not yet / error) = hold.
GATE_ONLY=1 node agent/trigger.mjs
if [[ $? -ne 0 ]]; then exit 0; fi

# Run the cycle, mirroring the GitHub Actions workflow. fee-router + replies are
# non-fatal: a failure there must never block (or unwind) her post.
(cd agent && npm run fee-router) || echo "fee-router failed (non-fatal)"
(cd agent && npm run run) || echo "run (post) failed"
(cd agent && npm run replies) || echo "replies failed (non-fatal)"
# Proactive comments in the wild (self-limited: daily cap + min-gap + probability
# inside comment.ts). Autonomous reply only when COMMENT_AUTOPOST=1 in the env.
(cd agent && npm run comment) || echo "comment failed (non-fatal)"

# Commit her updated log/state back to main, rebasing if the remote moved.
FILES="charybdis-log.json replies-log.json charybdis-state.json charybdis-currents.json comments-log.json comment-queue.json"
if [[ -n "$(git status --porcelain $FILES 2>/dev/null)" ]]; then
    for f in $FILES; do [ -f "$f" ] && git add "$f"; done
    git commit -m "log: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    for _ in 1 2 3; do
        git push origin HEAD:main && exit 0
        echo "push raced — rebasing and retrying"
        git pull --rebase origin main || break
    done
    echo "push failed after retries — next tick will re-sync"
else
    echo "no log changes"
fi
