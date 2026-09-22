---
name: handoff
description: >
  Draft a copy-pasteable prompt that hands work to a fresh Claude Code session — for when this
  session's context is filling up, when a task is finishing and the next one should start clean, or
  when a parallel workstream should run in its own chat. Offer this proactively; do not wait to be
  asked.
argument-hint: "[continue|next|parallel] [<what the new session should pick up>]"
allowed-tools: Read, Grep, Glob, Bash(git status *), Bash(git log *), Bash(git branch *), Bash(git rev-parse *), Bash(git diff *)
---

# Hand this work to a fresh session

A fresh session is often more capable on the same task than a long one whose context is full of
dead ends and superseded plans; it only needs orientation. This skill produces that orientation as
one fenced block the user pastes into a new chat.

## Write orientation, not instructions

The new session's advantage is an uncontaminated read of the codebase. Handing it a script to
execute spends that advantage and lets it inherit your bad assumptions.

| Do | Don't |
|---|---|
| Say what we're trying to achieve and why | Enumerate the steps to get there |
| Point at canonical files and let it read them | Summarise those files |
| Name traps you actually hit, with evidence | Speculate about traps you didn't hit |
| Say what's verified and how | Assert state you haven't rechecked |
| Tell it to confirm everything itself | Imply your picture is authoritative |

If you're writing "then do X, then do Y", you're tunnelling the fresh agent into your own stale
plan.

## When to offer this unprompted

Offer it in one sentence, without stopping work, when:

- Context is long and you notice yourself re-reading things you already read.
- A task just finished (PR opened, work merged) and the next one is separable.
- Work has split into two tracks that don't share state.
- A blocker needs a different environment or fresh tool state.
- The user asks something whose research this session's context would bias.

For example: *"This is a good handoff point — want me to draft a prompt for a fresh session?"* Run
the skill if they say yes, and don't repeat the offer.

## Modes

| Mode | Use when | The new session should |
|---|---|---|
| `continue` | This session is degrading mid-task | Pick up the same task with clean context |
| `next` | Current task is done or nearly | Start the next piece of work, usually via `/next` |
| `parallel` | An independent track exists | Work a different task without touching this one's branch |

Default to `next` if the user didn't say and the current task looks complete, `continue` otherwise.

## Multi-stage programs

When the work is one stage of a program with a tracker (a GitHub `[Epic]` with sub-issues; see
[`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md)), link the tracker and hand over the
current stage only: its live state and traps. Don't restate the plan. A second copy drifts from the
issue, and the fresh session can't tell which is current.

If you learned something the tracker doesn't know, it belongs in the tracker. This skill requests no
GitHub tools, so when you can't update it, say so in one line of the handoff ("the tracker is stale
on X; update it before relying on that section") and let the fresh session fix it. Don't route
around this with `gh` or raw REST; the GitHub MCP is the only sanctioned tracker path (`AGENTS.md`
§ Work tracking).

## Gather live state

Run these and use the real output, since recalled state is what's unreliable by now:

```sh
git branch --show-current
git status --short
git log --oneline origin/main..HEAD
git rev-parse HEAD
```

Include PR number, CI state, and the tracker issue's status only if you can read them live in this
session (they need GitHub tools this skill doesn't request). Otherwise write "unverified". A stale CI
verdict is worse than none, because the new session will act on it.

## Emit exactly one fenced block

Fence it with four backticks. The block usually contains three-backtick snippets, and a
three-backtick outer fence would end at the first one and truncate the handoff. Everything the new
session needs goes inside; anything outside isn't carried over.

In order:

1. **Command line.** `/next` for mode `next`. For `continue` or `parallel`, a plain instruction
   naming the task, since the issue is already picked.
2. **Task and why.** Two to four sentences on what we're achieving and why it's worth doing. Not
   how.
3. **Live state.** Branch, HEAD SHA, PR and CI, tracker issue, tree clean or not, as just checked.
4. **Where to look.** `AGENTS.md`, the specific spec or doc the work touches, the program tracker if
   any, and issue IDs. Pointers, not précis.
5. **Traps and known-open items.** What cost this session time, each with the evidence that makes it
   checkable: dead ends and failures (the part a new session can't cheaply rediscover), relevant
   Triage filings, and any unresolved disagreement or decision the user hasn't made, flagged open so
   the new session asks.
6. **Already verified, and how.** Each claim with its evidence (*"952 tests pass —
   `npm run test -w apps/api`, run at HEAD abc123"*), so the new session can decide whether to
   re-check. Don't phrase it as "don't redo this": a prohibition shields a stale claim from the fresh
   context that would catch it. Leave out anything you can't name evidence for.
7. **A closing instruction to verify independently**, such as: *"Treat all of the above as a
   starting point that may be stale. Verify it against the repo before relying on it, and if your
   own reading disagrees, trust your reading and say so."*

Every factual claim comes from a command you just ran or a file you just read; mark anything
uncertain as uncertain. Aim for roughly 40–70 lines. If it runs long, hand off less scope rather than
stripping the evidence from items 5 and 6.

## After emitting

Say in one line what the new session is expected to do and what remains yours. Name anything that
depends on the user (authorising a connector, answering a question), because a fresh session will
hit the same wall.
