---
name: multi-agent
description: >
  Size and shape multi-agent work in this repo: a Workflow script, a subagent fan-out, or an
  ultracode run. Use before authoring or launching a Workflow, before fanning out more than two
  subagents, and when deciding how many verifiers a claim needs or what effort an agent runs at.
  Covers the agent budget, which review may be big, per-agent effort, worktrees, pinned SHAs, and
  reading a workflow's results.
---

# Multi-agent work: budget, effort, mechanics

Paul runs almost every session with ultracode. The harness then tells the model to use the
Workflow tool on every substantive task, says "token cost is not a constraint", and pins the
session to `xhigh` effort. In this repo those defaults yield to the rules below. The loop stays:
discover or code, then verify independently. What this skill limits is how many agents that takes
and how hard each one thinks. Decision and evidence: [ADR-23](../../../spec/architecture/adr/adr-23.md).

## Budget

- **`/diff-review` is the one review allowed to be big.** It gates every push and runs through the
  saved workflow `frapp-review`, whose shape is fixed in code. Don't hand-write a review workflow
  for a diff, and don't layer another review on top of the gate (a lens pass, an "adversarial"
  re-review of a fix).
- **Everything else stays small.** `workflowSizeGuideline: "medium"` in `.claude/settings.json` has
  the harness tell the model to keep a workflow under 10 agents; it is advisory, not a cap. On top
  of it, use at most 5 agents in any one fan-out step; nothing enforces that but this rule.
  Ultracode lifts neither, and most steps need 1 to 3.
- **One agent covers several angles, files or claims.** Split only when each piece needs its own
  heavy context.
- **Verification outside the gate is one opinion.** Where a procedure calls for an independent
  verdict, batch up to 5 claims into one `claim-verifier` and don't add a second verifier. Don't
  spawn subagents to re-check your own work.
- **A fix round is a fix plus the gate.** Fix inline, or with one agent, then run `/diff-review`,
  which decides how much to review again (Phase 0 of its skill). Don't add a review of your own.

## Effort

Every subagent inherits the session's effort unless something sets its own. Opus 5.5 defaults to
`medium`, and ultracode raises the session to `xhigh`. Measured on 2026-09-23 from the `"effort"`
field in subagent transcripts:

| Launch | Ran at |
|---|---|
| Workflow `agent()` with `effort: 'medium'` | medium |
| Workflow `agent({ agentType: 'claim-verifier', effort: 'high' })` | high |
| Workflow `agent()` with no `effort` | the session's (xhigh) |
| Agent tool, any type, with no `effort` in its agent file (as loaded at session start) | the session's (xhigh) |

- **In a workflow, pass `effort` on every `agent()` call.** Use `medium` by default and `high` for
  finders and hard judgment calls. Never use `xhigh` or `max`.
- **The Agent tool has no effort parameter.** `diff-finder` and `claim-verifier` pin theirs in
  frontmatter (`high` and `medium`). Agent files load at session start, and nobody has yet measured
  whether that frontmatter beats ultracode's `xhigh`. Built-in types (`general-purpose`, `Explore`)
  always inherit, so under ultracode run reading fan-outs as a workflow with explicit `effort`.
- **To check what ran**, read the transcripts. They live in
  `~/.claude/projects/<cwd-slug>/<session-id>/subagents/`, with workflow agents under
  `workflows/<runId>/`: `grep -o '"effort":"[a-z]*"' agent-*.jsonl | sort | uniq -c`.

## Mechanics

- **Agents that edit files run in worktrees** (`isolation: 'worktree'` on `agent()` or the Agent
  tool). While any agent works in the main checkout, don't commit, reset, merge, stash or check
  out there. The agents would read a moving tree, and a stop hook would report their half-done
  edits as your uncommitted work.
- **A new worktree starts at `origin/main`, not at your HEAD.** `worktree.baseRef` defaults to
  `fresh`. Seen in a `frapp-review` run on 2026-09-23: the worktree finder's HEAD was the review
  base, not the reviewed commit. Have the agent run `git checkout -q --detach <sha>` first; the
  commit is there because worktrees share the object store. Have it check the starting HEAD back
  out before it returns if it changed nothing, so the harness can remove the worktree.
- **One branch per worktree.** A branch checked out in one worktree can't be checked out in another
  (`fatal: '<branch>' is already used by worktree`). Stack a new branch on its head instead:
  `git worktree add -b <new-branch> <path> <sha>`.
- **Pin SHAs.** Resolve `origin/main` and any other moving ref to a SHA once, and pass the SHA. A
  background agent's `git fetch` moves `origin/main` mid-session, which silently changes what a
  two-dot diff against it means.
- **Read results from the right file.** The completion notification's inline `<result>` is cut at
  8,000 characters, and the task's `.output` file (path in the notification) holds the full JSON.
  A run that failed or was killed writes no JSON. Its record is `journal.jsonl` in the run's
  transcript dir: a `started` line per agent carries its `agentId` and `label`, and a `result` line
  with the same `agentId` carries what it returned.
- **Compare cost with `<usage>`.** `subagent_tokens` sums each agent's final context plus its
  output. It is good for comparing runs, but it isn't a bill.
- **No silent caps.** When a workflow drops coverage (a cap, a skipped item, a failed agent),
  `log()` it and redo the missing check inline.
