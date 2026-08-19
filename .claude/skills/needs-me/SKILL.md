---
name: needs-me
description: >
  Sweep the places where work piles up waiting on Paul — the PR Follow-ups Human Action List and
  its `[human]` issues, the triage inbox, open PRs, and recent agent sessions — surface the handful
  that genuinely need his decision or his hands, let him pick exactly one, then walk that one to
  done. Use on "what needs me", "what am I blocking", "what do I have to decide", "anything waiting
  on me", "unblock me", or a bare `/needs-me`.
argument-hint: "[<area or keyword to narrow the sweep>] [--list-only]"
---

# What needs Paul

Agent sessions file their blockers, PRs end with flagged items, routines publish a Human Action
List — and all of it accumulates in a tracker Paul doesn't read continuously. The failure this
skill fixes is a two-minute dashboard toggle sitting for three weeks while four issues wait behind
it.

**The shape of the run: survey wide and cheap, then go deep on exactly one.** Do not research every
candidate — that turns a five-minute unblock into an audit. Skim to a shortlist, let Paul choose,
and spend the real effort on his choice.

**This is not the PR Follow-ups routine.** That routine harvests, files, and republishes. This one
files nothing and rewrites no tracking issue — it reads what already exists and clears one item.

## Access

GitHub MCP only, schemas loaded first:
`ToolSearch("select:mcp__github__search_issues,mcp__github__issue_read,mcp__github__issue_write,
mcp__github__add_issue_comment,mcp__github__list_pull_requests,mcp__github__pull_request_read")`.
If the MCP is unavailable, stop and say so — there is no fallback tracker
([`ROUTINES.md` → Tracker access](../../../docs/internal/ci-cd/ROUTINES.md#tracker-access-shared-by-all-routines)).

## Phase 1 — Sweep (bounded, parallel, no deep reads)

Run these together. Window: **updated in the last ~14 days**, except open `[human]` items, which
count regardless of age — they don't expire.

| Source | How | What you're looking for |
|---|---|---|
| Human Action List | `search_issues query:"PR Follow-ups — Human Action List in:title"` | The "Needs you" section — an **index**, rebuilt weekly, so possibly stale |
| Session blockers | `search_issues query:"fp=human in:body state:open"` | `[human] …` issues any agent session filed per the [AGENTS.md hard rule](../../../AGENTS.md) |
| PR follow-ups | `search_issues query:"fp=pr-followup in:body state:open"` | Keep the `[human]` ones; agent-doable ones belong to `/next`, not to Paul |
| Triage inbox | `search_issues query:"label:triage state:open"`, newest first, ~30 max | Bodies opening **"Human action required"**, or that state a decision only Paul can make |
| Open PRs | `list_pull_requests state:open` | Awaiting his review, red CI with no session driving it, merge conflicts, a review thread asking him a question |
| Recent sessions | `list_sessions mine:true limit:20` (claude-code-remote) | Only titles and status are visible — a stalled session is a **pointer** to check, never a finding on its own. Optional: if the server isn't connected, note it and sweep the rest |

Then:

- **Dedup.** One action commonly appears three times — on the List, as its own issue, and in a PR
  thread. Collapse to one candidate and anchor it on the **issue**, since that's what closing
  updates.
- **Drop what isn't his.** Agent-doable work, anything already `in-progress`, `routine-state`
  issues, and `scope:production` items (parked by owner decision — not blocked, not stale).
- **Rank** by what clearing it releases, not by age: (1) it's blocking agent work or a merge right
  now; (2) it's cheap — a toggle or a one-line answer that has been sitting for weeks; (3) it gates
  several other issues; (4) age, as a tiebreaker only.

If an argument was given, filter to it. If nothing needs him, say exactly that in one line and
stop — a clean sweep is a good outcome, not a reason to pad the list.

## Phase 2 — Present and pick ONE

Show **at most 6**, one line each, ranked:

```
#N — <the action, imperative> — <why it needs you: decision / credential / dashboard / purchase> —
      unblocks <what> — ~<time>
```

Then `AskUserQuestion` with the top 4 as options (his "Other" covers the rest of the list, and
naming a different issue number is always fair game). One question, one pick. With `--list-only`,
print the list and stop.

## Phase 3 — Walk that one to done

**Re-verify before you walk.** The item may already be handled — check the current code, config, or
provider state before spending Paul's time. If it's done, say so, close it with the proof, and
offer him the next item on the list instead.

Then:

1. **Ground the steps in reality, not in the issue.** The issue's "How to do it" section was
   written when it was filed and may have drifted; confirm names and paths against the repo and,
   for provider state, [`/infrastructure-research`](../infrastructure-research/SKILL.md). If a doc
   you rely on turns out to be wrong, [`/check-our-docs`](../check-our-docs/SKILL.md) fixes it in
   the same pass.
2. **Do everything you can do yourself first**, and say what you did. Only what genuinely requires
   his account, his card, his dashboard, or his judgment should reach him.
3. **Hand him one step at a time.** Exact setting names, exact secret names (never values), exact
   URLs, and what he should see when it worked. Wait for the outcome before the next step —
   a numbered wall of nine steps is how items get half-done.
4. **Prove it.** Name what makes it verifiably finished — a green run, a config read-back, a
   commit — and check that, rather than accepting "done".
5. **Close the loop where the item lives.** An issue-anchored item gets a comment with the proof
   and a close (`completed`; or `not_planned` with the reasoning if the decision was to drop it) —
   but ask first for anything not `suggestion`-labeled, which is outside the routines' ownership
   boundary and therefore his call. An item with no issue behind it lands where it came from: a
   decision or answer goes on the PR or review thread that asked for it, and merging or approving
   stays his. Record the outcome *somewhere durable* either way — a decision that exists only in
   this chat is the failure mode this skill was built against.
6. **Leave the List alone.** The PR Follow-ups routine rebuilds it from live issue state on its
   next run; a hand-edit there will be overwritten and can damage its state marker.

If the walkthrough uncovers real work rather than a quick action, don't grow the session into it —
say so and offer to hand it to `/next` or a fresh session
([`/handoff`](../handoff/SKILL.md)).

## Guardrails

- **One item per invocation.** Finish it, then offer the next — don't chain without being asked.
- **File nothing.** New work found mid-walk gets mentioned, not filed; the curator and triage
  routines own the inbox. The exception is the AGENTS.md hard rule: a *newly proven* human-only
  blocker still gets its `[human]` issue.
- Every line in the shortlist comes from a live read this run. No recall, no assumed state.
- Never print secret values; secret **names** only.
- Don't re-open a decision Paul already made — if the thread shows he decided, it's closed, not a
  candidate.
- Keep the sweep cheap: search over crawling, and no full PR body reads before Phase 3.
