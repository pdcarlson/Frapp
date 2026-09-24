---
name: diff-review
description: >
  Review the current working diff for correctness bugs, security holes, and cleanups before
  pushing. Use before any git push, when the pre-push review gate blocks a push, and whenever
  asked to review uncommitted or unpushed work on this branch.
argument-hint: "[full] [<target>]"
allowed-tools: Agent, Task, Workflow, Read, Grep, Glob, Edit, Write, ReportFindings, Bash(git diff *), Bash(git show *), Bash(git log *), Bash(git status *), Bash(git rev-parse *), Bash(git merge-base *), Bash(git fetch origin main), Bash(node scripts/diff-review-scope.mjs*), Bash(npm run check:*)
---

# Review this branch's diff

Frapp's pre-push review gate. A branch gets one thorough review with subagents, the first time it is
reviewed. After that the gate reviews only what changed since, and a fix round is reviewed inline,
by you, with no subagents. Merging `main` adds nothing to review. Done means the findings are
reported, each one is fixed or filed, and the commit you push carries a marker.

Never get past the gate with `git push --no-verify`: it leaves no review evidence.

**`/code-review` doesn't replace this skill.** A model can invoke it only when the current turn's
prompt carries the token whitespace-delimited (regex `(?<!\S)/code-review(?=$|\s)`), never inside a
subagent or a slash-command expansion. It knows none of Frapp's angles and doesn't write the marker.
When a turn does carry the token, run it as asked, then run this skill. Full rule:
`docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`.

## 1. Scope

Commit first: the marker keys to a commit. Then:

```sh
git fetch origin main                     # a stale origin/main makes main's commits look like the branch's
node scripts/diff-review-scope.mjs        # --full forces a full review
```

It prints one JSON line: `mode`, `review`, `base`, `head`, `branchBase`, `reviewed`, `root`,
`files`, `changedLines`, `dirty`. Use its SHAs as given and never re-resolve `origin/main`: a
background fetch can move it mid-review. State the scope in one line, then:

| `mode` / `review` | Means | Do |
|---|---|---|
| `full` / `workflow` | No reviewed commit on this branch yet, or the reviewed work conflicts with `main` | §2 |
| `delta` / `inline` | Under 300 changed lines since the last review: a fix round | §3 |
| `delta` / `workflow` | 300 lines or more since the last review: new work | §2 |
| `none` | Nothing unreviewed: HEAD has a marker, or only merges of `main` landed since the last review | Push; the hook accepts it |
| `empty` | The branch has no commits of its own | Stop |

A delta is HEAD against the last reviewed commit with the current `main` merged in cleanly, so it
holds your fix commits and anything a merge commit changed by hand, but none of `main`'s changes.
`base` may name a tree rather than a commit; `git diff <base> <head>` works either way. Generated
files (`package-lock.json`, `openapi.json`) count toward `files` but not `changedLines`.

If you must review a dirty tree (`dirty: true`), say so. An explicit `<target>` (a path, ref or
range) replaces the script: review exactly that as in §2, with pinned SHAs, and write no marker,
because it isn't the commit a push publishes.

## 2. Workflow round

Bundled `diff-finder`s cover every angle in [`angles.md`](angles.md). On a full review, one more
finder checks acceptance criteria and test adequacy in its own worktree. Each flagged line then goes
to an independent `claim-verifier`. A finding it refutes goes to a second verifier on a different
lens, and a finding is dropped only when both refute it. [`frapp-review.js`](../../workflows/frapp-review.js)
owns the bundles, caps and verify rule, and [ADR-23](../../../spec/architecture/adr/adr-23.md) says
why.

When you are opted into the Workflow tool (a session-level ultracode reminder, `ultracode` in the
arguments of the command that called you such as `/next ultracode`, or the user invoking
`/diff-review` themselves), run it:

```js
Workflow({ name: 'frapp-review', args: {
  ...scope,                   // the JSON line from scripts/diff-review-scope.mjs, unchanged
  acceptance: '<the issue's acceptance criteria, when there is an issue>',
} })
```

Otherwise run the same round with the Agent tool: the `diff-finder`s `BUNDLES` names in that file,
in one message (the acceptance-and-tests one with `isolation: "worktree"`), then one
`claim-verifier` per flagged line with the prompts `judge()` writes.

- Finders share this working tree, so they are read-only; only the worktree finder may mutate
  source, and it reverts before it returns. Don't commit, reset, merge, stash or check out while any
  agent is live: it would read a moving tree.
- A finder in `finderFailures` left angles unchecked, and an `unverified` finding is a check not
  run. Cover both inline before you report.

## 3. Inline round

Review the delta yourself: read `git diff <base> <head>` and the unchanged lines of each function it
touches, and check it against every angle in [`angles.md`](angles.md) that applies. Don't spawn
agents. You are reviewing your own fix, so look hardest at what it removed and at its callers, not
only at whether the finding it answered went away. Report only what has a concrete failure scenario.

## 4. Report and act

Report once with `ReportFindings`, most severe first: correctness and security above cleanups,
`CONFIRMED` above `PLAUSIBLE`, with `verdict` set on each finding from a workflow round. Merge
findings that share a root cause. Pass an empty array when nothing survived. If `ReportFindings` is
unavailable, write a numbered list with file, line, verdict, summary and failure scenario. Always
emit one or the other, because silence is indistinguishable from a clean diff.

Then act on every finding: fix it, or file a self-contained follow-up per
[`file-follow-up`](../file-follow-up/SKILL.md) with the reason for deferring. Record the dispositions
(`ReportFindings` again with `outcome`, or one line per finding). A `PLAUSIBLE` finding you can't
settle goes in the PR body under *Flagged for review*.

## 5. Mark

Check that `git rev-parse HEAD` is still the `head` you reviewed and that `git status` shows nothing
you didn't write. Then:

```sh
node scripts/diff-review-scope.mjs --mark
```

It writes `<repo-root>/.cache/diff-review/<HEAD SHA>`, the marker the pre-push hook checks. Committing
a fix changes HEAD, so run this skill again: §1 then scopes just the new commits, which is usually an
inline round.
