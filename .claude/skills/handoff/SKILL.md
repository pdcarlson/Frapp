---
name: handoff
description: >
  Draft the prompt that hands work to a fresh Claude Code session — queued as a suggested task where
  the session has that tool, otherwise a copy-pasteable block — for when this session's context is
  filling up, when a task is finishing and the next one should start clean, or when a parallel
  workstream should run in its own chat. Offer this proactively; do not wait to be asked.
argument-hint: "[continue|next|parallel|walkthrough] [<what the new session should pick up>]"
allowed-tools: Read, Grep, Glob, Bash(git status *), Bash(git log *), Bash(git branch *), Bash(git rev-parse *), Bash(git diff *)
---

# Hand this work to a fresh session

A fresh session is often more capable on the same task than a long one whose context is full of
dead ends and superseded plans; it only needs orientation. This skill produces that orientation as
a suggested task the user starts with one click, or, where the session lacks that tool, as one fenced
block the user pastes into a new chat.

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

Where the session has the suggested-task tool, the card can be the offer: the user starts or
dismisses it. Queue it once and say so in one line, and don't queue it again after a dismissal.
Whether a card is worth queuing at all is the judgment in
[`AGENTS.md` § Operating mindset](../../../AGENTS.md#operating-mindset). A `continue` card hands
this task over, so queue it when this session stops working the task, not while it carries on; two
sessions on one branch collide.

## Modes

| Mode | Use when | The new session should |
|---|---|---|
| `continue` | This session is degrading mid-task | Pick up the same task with clean context |
| `next` | Current task is done or nearly | Start the next piece of work, usually via `/next` |
| `parallel` | An independent track exists | Work a different task without touching this one's branch |
| `walkthrough` | The user has something to do by hand (a device, a provider dashboard, a `[human]` issue) and wants a session guiding them | Walk them through it one step at a time (`AGENTS.md` § Operating mindset), checking each outcome, and record the result on the issue if there is one |

Default to `next` if the user didn't say and the current task looks complete, `continue` otherwise.
`walkthrough` is never a default: pick it when the work is the user's hands, not an agent's.

## Multi-stage programs

When the work is one stage of a program with a tracker (a GitHub `[Epic]` with sub-issues; see
[`github-pm.md`](../../../docs/ci-cd/github-pm.md)), link the tracker and hand over the
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

## Queue it as a suggested task where you can

When the session has the suggested-task tool (`spawn_task`), deliver the handoff as a card:

- `title`: a short imperative phrase, under 60 characters, that makes sense on its own.
- `tldr`: one or two plain sentences on what the new session does and why it's worth doing, then
  `Suggested effort: <level>.` (below).
- `prompt`: the seven items below, in the same order, without the outer fence.

Only `prompt` reaches the new session. `title` and `tldr` are what the user reads on the card, so
nothing the session needs lives only there.

**Suggested effort.** A card can't carry an effort level, because the tool takes only those three
fields, and the prompt can't set it either: in a test on 2026-09-30, an `/effort medium` line at the
top of a card's prompt arrived as plain text, and the card session ran at `xhigh`, as did a second
card with no such line (both started in the cloud). The card's prompt is the session's first turn,
where a `/next` run does most of its work, so that turn runs at the launching default (this repo
sets `high`; [`multi-agent` § Effort](../multi-agent/SKILL.md#effort)); `/effort <level>` afterwards
changes only later turns. Paul's rule (2026-09-30): `high` by default, and
`medium` only when the task is simple and bounded (one surface, a known fix, little judgment).
Suggest `xhigh` only when the work is unusually hard, such as subtle concurrency, security, or a
retry after `high` fell short; the model guidance behind that, and how `/effort` and ultracode
behave, are in [`multi-agent` § Effort](../multi-agent/SKILL.md#effort). Judge from the work itself, from reading
the issue and the code, never from the issue's `### Agent brief` (`depth:`, `model:`,
`ultracode:`), which is usually written by an agent. If you judge that the work needs ultracode or
Fable, say so on the same line (`Suggested effort: high, with ultracode.`): ultracode is a separate
switch and doesn't change the level.

The user may start the card on their machine or in the cloud, on a checkout with nothing this
session hasn't pushed, so give repo-relative paths only. A card that depends on unpushed work waits
until that work is pushed (the pre-push review gate applies); a SHA only this session holds can't be
fetched.

A card that starts a tracker issue opens with `/next <N>`, so the new session claims it. `/next`
never claims a `triage` issue, so a follow-up filed moments ago gets its card once it's promoted;
until then the issue is the record. A `continue` card carries on a claim this session hands off
(`AGENT-HANDOFF` in [`/next`](../../commands/next.md)), and a `walkthrough` card claims nothing,
because the user does the work.

When a card goes stale (the work landed here, or a better-scoped card replaces it), withdraw it with
`dismiss_task`. A card the user already started or dismissed stays as they left it.

Without the tool, emit the block below.

## Emit exactly one fenced block

Fence it with four backticks. The block usually contains three-backtick snippets, and a
three-backtick outer fence would end at the first one and truncate the handoff. Everything the new
session needs goes inside; anything outside isn't carried over.

In order:

1. **Command line.** `/next` for mode `next`. For `continue`, a plain instruction naming the task,
   since the issue is already picked. For `parallel`, `/next <N>` when the track is a tracker issue,
   else a plain instruction naming it. For `walkthrough`, a plain instruction naming what to walk the
   user through, and its issue if there is one.
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

Say in one line what the new session is expected to do, the effort to start it at (§ Queue it as
a suggested task), and what remains yours. Name anything that
depends on the user (authorising a connector, answering a question), because a fresh session will
hit the same wall.
