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

## Multi-stage programs

Some work is one stage of a longer program — a sequenced refactor, a migration, a rebuild — and the
program has a tracker (a GitHub `[Epic]` with sub-issues; see
[`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md)). When it does, **link the tracker and
hand over the current stage only.**

Do not restate the plan in the handoff. A restated plan is a second copy that starts drifting from
the issue the moment either changes, and the fresh session cannot tell which one is current — which
is the same failure as summarising a canonical file instead of pointing at it, one level up. It is
also how a program ends up existing only as one agent's summary of another agent's summary.

So: name the tracker issue, name the stage being handed over, and give live state and traps for
*that stage*. Everything the next session needs about the other stages is in the tracker.

If you learned something the tracker does not know, update the tracker rather than the handoff — but
this skill requests no GitHub tools, so you may not be able to. When you cannot, say so in the
handoff in one line ("the tracker is stale on X; update it before relying on that section") and let
the fresh session, which will have the tools, correct it. Never route around it with `gh` or raw
REST: the GitHub MCP is the only sanctioned tracker path (`AGENTS.md` § Work tracking).

## Gather live state (don't recall it — check)

Run these and use the real output. Recalled state is exactly what's unreliable by this point.

```sh
git branch --show-current
git status --short
git log --oneline origin/main..HEAD
git rev-parse HEAD
```

PR number and CI state, and the tracker issue and its status, are worth including too — but those need
GitHub tools this skill does not itself request, and they are often unavailable (a
disconnected MCP server, an unauthorised connector). Include them **only** if you can read them live
in this session. If you can't, say "unverified" rather than reaching for what you remember; a stale
CI verdict is worse than none, because the new session will act on it.

## Emit exactly one fenced block

The user copies this whole thing into a new chat, so nothing outside the fence gets carried over.
Put no commentary inside it that isn't meant for the new session.

**Fence it with four backticks.** The block will usually contain command snippets or file excerpts
that are themselves fenced with three, and a three-backtick outer fence terminates at the first inner
one — silently truncating the handoff at exactly the point where the useful detail starts.

Structure:

1. **The command line.** `/next` for mode `next`. For `continue` or `parallel`, a plain instruction
   naming the task — those aren't `/next` work because the issue is already picked.
2. **Task and why** — 2–4 sentences. What we're achieving and what makes it worth doing. Not how.
3. **Live state** — branch, HEAD SHA, PR + CI, tracker issue, tree clean or not. Facts only, as just
   verified.
4. **Where to look** — canonical files and issue IDs. Pointers, not précis. Include `AGENTS.md` and
   the specific spec/doc the work touches, and the program tracker if there is one.
5. **Traps and known-open items** — things that cost this session time, each with the evidence that
   makes it checkable. Include anything filed to Triage that's relevant.
6. **Already verified, and how** — not "don't redo this". State the claim and the evidence
   (*"952 tests pass — `npm run test -w apps/api`, run at HEAD abc123"*) and let the new session
   decide whether to re-check. Phrased as a prohibition this section becomes the most dangerous part
   of the handoff: it is the one place where a stale claim is armour-plated against the fresh
   context that would otherwise catch it. Anything you cannot name the evidence for does not belong
   here at all.
7. **A closing instruction to verify independently**, in the new session's own words — something
   like: *"Treat all of the above as a starting point that may be stale. Verify it against the repo
   before relying on it, and if your own reading disagrees, trust your reading and say so."*

Aim for scannable — very roughly 40–70 lines. Treat that as a signal, not a budget: if sections 5 and
6 need more room to keep each item's evidence attached, take it. Compressing evidence away to hit a
line count produces exactly the unfalsifiable assertions this skill is trying to avoid. If it runs
long, cut *scope* — hand off less — rather than cutting the evidence.

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
