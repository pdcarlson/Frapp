#!/bin/bash
# PostToolUse hook (Bash): drop the current branch's remote-tracking ref once GitHub has
# deleted that branch and everything the ref hides is already on origin/main.
#
# Why: Claude Code's own Stop hook (~/.claude/stop-hook-git-check.sh, written by the
# harness, not this repo) counts `origin/<branch>..HEAD` as unpushed work. After Paul
# squash-merges a PR, GitHub deletes the branch, but the session's clone keeps
# `origin/<branch>` pointing at the old PR head. When the session then resets the branch
# to main (`git checkout -B <branch> origin/main`, next.md Phase 4), the squash commit and
# everything else main gained since are "unpushed", and the session stops to explain it.
# The harness hook can't be edited from here, so this removes the stale ref it reads,
# which is what `git fetch --prune` would have done.
#
# It acts only when all of these hold, so it never hides real work:
#   - HEAD is on a branch whose `origin/<branch>` ref exists and is behind HEAD
#     (the Stop hook would fire);
#   - every commit that makes it fire is already on origin/main (none of it is the
#     session's own);
#   - `git ls-remote` says the branch no longer exists on origin. Any other answer
#     (an error, no network, a timeout) leaves the ref alone.
# The first two are local and cheap, so the network call happens only in that state.
#
# With the ref gone the Stop hook compares against origin/HEAD. A clone made from one
# fetched branch has none, and a missing origin/HEAD makes the Stop hook count nothing at
# all, so this points it at origin/main when it is missing: new commits on the branch are
# then still reported as unpushed.
#
# Never fatal and never blocks: every path exits 0.

input=$(cat 2>/dev/null || true)
# Most Bash calls have nothing to do with git; skip them before running anything.
[[ "$input" == *git* ]] || exit 0

git rev-parse --git-dir >/dev/null 2>&1 || exit 0
branch=$(git branch --show-current 2>/dev/null) || exit 0
[[ -n "$branch" ]] || exit 0

tracking="refs/remotes/origin/$branch"
stale=$(git rev-parse -q --verify "$tracking" 2>/dev/null) || exit 0
git rev-parse -q --verify refs/remotes/origin/main >/dev/null 2>&1 || exit 0

ahead=$(git rev-list --count "$stale..HEAD" 2>/dev/null) || exit 0
[[ "$ahead" -gt 0 ]] || exit 0
own=$(git rev-list --count HEAD --not "$stale" refs/remotes/origin/main 2>/dev/null) || exit 0
[[ "$own" -eq 0 ]] || exit 0

# Exit 2 is ls-remote's "no matching ref", the only answer that proves the branch is gone.
limit=()
command -v timeout >/dev/null 2>&1 && limit=(timeout 20)
GIT_TERMINAL_PROMPT=0 GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh} -o BatchMode=yes" \
  "${limit[@]}" git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null 2>&1
[[ $? -eq 2 ]] || exit 0

# The old value guards against the ref having moved since it was read.
git update-ref -d "$tracking" "$stale" >/dev/null 2>&1 || exit 0
if ! git rev-parse -q --verify refs/remotes/origin/HEAD >/dev/null 2>&1; then
  git symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main >/dev/null 2>&1 || true
fi

note="Removed the stale origin/$branch ref: GitHub deleted that branch (it was merged), and the $ahead commit(s) it made look unpushed are already on origin/main. Nothing needs pushing for them."
# A ref name may hold a double quote; nothing else it can hold needs escaping in JSON.
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "${note//\"/\\\"}"
exit 0
