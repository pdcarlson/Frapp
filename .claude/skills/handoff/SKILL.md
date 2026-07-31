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

Long sessions decay. Context fills with dead ends, superseded plans, and tool output that no longer
matters, and the model starts reasoning from a corrupted picture rather than the code. A fresh
session with clean context is often *more* capable on the same task — it just needs orientation.

This skill produces that orientation: a single block the user pastes into a new chat.

## The one rule that matters

**Write orientation, not instructions.** The new session has something this one has lost — an
uncontaminated read of the codebase. Do not spend that advantage by handing it a script to execute.

| Do | Don't |
|---|---|
| Say what we're trying to achieve and why | Enumerate the steps to get there |
| Point at canonical files and let it read them | Summarise those files and hope the summary is right |
| Name traps you actually hit, with evidence | Speculate about traps you didn't hit |
| Say what's verified and how | Assert state you haven't rechecked |
| Tell it to confirm everything itself | Imply your picture is authoritative |

If you find yourself writing "then do X, then do Y", stop — you are tunnelling the fresh agent into
your own stale plan. The failure this skill exists to prevent is a new session inheriting a bad
assumption and spending its clean context defending it.

## When to offer this unprompted

Raise it yourself, briefly, without being asked, when any of these is true:

- Context is getting long and you notice yourself re-reading things you already read.
- A task just finished (PR opened, work merged) and the next one is separable.
- Work has split into two tracks that don't share state — one should run in parallel.
- You've hit a blocker that needs a different environment or a fresh tool state.
- The user asks a question whose answer needs research this session's context would bias.

One sentence is enough: *"This is a good handoff point — want me to draft a prompt for a fresh
session?"* Then run this skill if they say yes. Don't nag, and don't stop working to ask.

## Modes

| Mode | Use when | The new session should |
|---|---|---|
| `continue` | This session is degrading mid-task | Pick up the *same* task with clean context |
| `next` | Current task is done or nearly | Start the next piece of work, usually via `/next` |
| `parallel` | An independent track exists | Work a different task without touching this one's branch |

Default to `next` if the user didn't say and the current task looks complete; `continue` otherwise.

## Gather live state (don't recall it — check)

Run these and use the real output. Recalled state is exactly what's unreliable by this point.

```sh
git branch --show-current
git status --short
git log --oneline origin/main..HEAD
git rev-parse HEAD
```

Also check, where relevant: the PR number and its CI state, the Linear issue and its status, and
whether the working tree is clean. If you can't verify something, say so in the prompt rather than
asserting it.

## Emit exactly one fenced block

The user copies this whole thing into a new chat, so nothing outside the fence gets carried over.
Put no commentary inside it that isn't meant for the new session.

Structure:

1. **The command line.** `/next` for mode `next`. For `continue` or `parallel`, a plain instruction
   naming the task — those aren't `/next` work because the issue is already picked.
2. **Task and why** — 2–4 sentences. What we're achieving and what makes it worth doing. Not how.
3. **Live state** — branch, HEAD SHA, PR + CI, Linear issue, tree clean or not. Facts only, as just
   verified.
4. **Where to look** — canonical files and issue IDs. Pointers, not précis. Include `AGENTS.md` and
   the specific spec/doc the work touches.
5. **Traps and known-open items** — things that cost this session time, each with the evidence that
   makes it checkable. Include anything filed to Triage that's relevant.
6. **Don't redo** — work already verified, with how it was verified, so the new session doesn't burn
   context re-proving it.
7. **A closing instruction to verify independently**, in the new session's own words — something
   like: *"Treat all of the above as a starting point that may be stale. Verify it against the repo
   before relying on it, and if your own reading disagrees, trust your reading and say so."*

Keep it scannable — roughly 40–70 lines. If it's longer than that you're summarising instead of
pointing.

## Honesty rules

- Every factual claim comes from a command you just ran or a file you just read. No recall.
- Mark anything uncertain as uncertain. "I believe X, unverified" is useful; a confident wrong claim
  costs the new session more than saying nothing.
- Include failures and dead ends. What *didn't* work is often the most valuable thing to transfer,
  because it's the part the new session cannot cheaply rediscover.
- Never claim a check was run that wasn't — the same rule that applies to your own reporting.
- Don't paper over an unresolved disagreement or a decision the user hasn't made. Flag it as open so
  the new session asks rather than guessing.

## After emitting

Say in one line what the new session is expected to do and what remains yours. If any of it depends
on the user (authorising a connector, answering a question), say that explicitly — a fresh session
will hit the same wall.
