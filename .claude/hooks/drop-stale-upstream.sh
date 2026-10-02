#!/bin/bash
# PostToolUse hook (Bash): drop the current branch's remote-tracking ref once origin no longer
# has that branch and everything the ref makes look unpushed is already on origin/main.
#
# Why: Claude Code's own Stop hook (~/.claude/stop-hook-git-check.sh, written by the
# harness, not this repo) counts `origin/<branch>..HEAD` as unpushed work. After Paul
# squash-merges a PR, GitHub deletes the branch, but the session's clone keeps
# `origin/<branch>` pointing at the old PR head. When the session then resets the branch to
# main (`git checkout -B <branch> origin/main`, next.md Phase 4), the squash commit and
# everything else main gained since are "unpushed", and the session stops to explain it.
# The harness hook can't be edited from here, so this removes the stale ref it reads,
# which is what `git fetch --prune` would have done.
#
# It acts only when all of these hold:
#   - the Bash command mentioned git (the command, not its output);
#   - HEAD is on a branch whose `origin/<branch>` ref exists and is behind HEAD
#     (the Stop hook would fire);
#   - every commit that makes it fire is already on origin/main (none of it is the
#     session's own);
#   - `git ls-remote` says origin no longer has the branch. Any other answer (an error, no
#     network, a timeout) leaves the ref alone. "Still there" is remembered for this branch
#     and ref value for ten minutes, so a branch kept on origin costs one network call per
#     ten minutes, not one per Bash call.
#
# What deleting the ref changes, beyond the count: with no `origin/<branch>`, the Stop hook
# treats the branch like any branch never pushed. It compares against origin/HEAD, which a
# cloud clone lacks, so it reports nothing until the next push, and it skips its
# unsigned-commit check, which runs only when `origin/<branch>` resolves. The cloud sandbox
# signs every commit as noreply@anthropic.com by default, so that check only matters for a
# commit made with signing or the identity overridden. The ref's reflog goes with it, so the
# note below names the commit it pointed at.
#
# Never fatal and never blocks: every path exits 0.

input=$(cat 2>/dev/null || true)
# Look only inside tool_input.command: the payload also carries the command's output, where
# "git" turns up in nearly everything (.github, .gitignore, digit).
command_re='"command"[[:space:]]*:[[:space:]]*"([^"\\]|\\.)*git'
[[ "$input" =~ $command_re ]] || exit 0

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

marker="$(git rev-parse --git-path frapp-upstream-still-on-origin 2>/dev/null)" || exit 0
if [[ -f "$marker" && "$(cat "$marker" 2>/dev/null)" == "$branch $stale" ]] &&
   [[ -n "$(find "$marker" -mmin -10 2>/dev/null)" ]]; then
  exit 0
fi

# Never prompt: an HTTPS credential prompt or an SSH passphrase would hang the session. The
# SSH command keeps whatever this clone already uses and only adds BatchMode; GIT_SSH, an
# older way to name it, is left alone.
if [[ -z "${GIT_SSH_COMMAND:-}" && -z "${GIT_SSH:-}" ]]; then
  GIT_SSH_COMMAND="$(git config core.sshCommand 2>/dev/null || echo ssh) -o BatchMode=yes"
  export GIT_SSH_COMMAND
fi
limit=()
command -v timeout >/dev/null 2>&1 && limit=(timeout 10)
GIT_TERMINAL_PROMPT=0 "${limit[@]}" git ls-remote --exit-code --heads origin "refs/heads/$branch" >/dev/null 2>&1
status=$?
# 0 is "still there"; 2 is ls-remote's "no matching ref", the only answer that proves it gone.
if [[ $status -eq 0 ]]; then
  printf '%s %s\n' "$branch" "$stale" >"$marker" 2>/dev/null
  exit 0
fi
[[ $status -eq 2 ]] || exit 0

# The old value guards against the ref having moved since it was read.
git update-ref -d "$tracking" "$stale" >/dev/null 2>&1 || exit 0
rm -f "$marker" 2>/dev/null

note="Removed the stale origin/$branch ref (it pointed at ${stale:0:12}): origin no longer has that branch, and the $ahead commit(s) it made look unpushed are already on origin/main. This does not show whether that branch's PR was merged or closed."
# A ref name may hold a double quote; nothing else it can hold needs escaping in JSON.
printf '{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"%s"}}\n' "${note//\"/\\\"}"
exit 0
