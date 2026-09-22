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

Blockers, flagged PR items, and the Human Action List accumulate in a tracker Paul doesn't read
continuously, so a two-minute toggle can hold up a queue for weeks. Survey wide and cheap, let him
pick one, and spend the real effort on that one. Done means that item is verifiably finished and
recorded where it lives, or the sweep found nothing that needs him.

This isn't the PR Follow-ups routine. It reads what already exists, files nothing, and rewrites no
tracking issue.

## Access

GitHub MCP only, schemas loaded first:
`ToolSearch("select:mcp__github__search_issues,mcp__github__issue_read,mcp__github__issue_write,
mcp__github__add_issue_comment,mcp__github__list_pull_requests,mcp__github__pull_request_read")`.
If the MCP is unavailable, stop and say so; there is no fallback tracker
([`ROUTINES.md` → Tracker access](../../../docs/internal/ci-cd/ROUTINES.md#tracker-access-shared-by-all-routines)).

## Phase 1 — Sweep

Run these in parallel and skim; save deep reads for Phase 3. Window: updated in the last ~14 days,
except open `[human]` items, which count at any age.

| Source | How | What you're looking for |
|---|---|---|
| Human Action List | `search_issues query:"PR Follow-ups — Human Action List in:title"` | Its "Needs you" section, an index rebuilt weekly and possibly stale |
| Session blockers | `search_issues query:"fp=human in:body state:open"` | `[human] …` issues filed per [`file-follow-up`](../file-follow-up/SKILL.md#proven-human-only-blockers) |
| PR follow-ups | `search_issues query:"fp=pr-followup in:body state:open"` | The `[human]` ones; agent-doable ones belong to `/next` |
| Triage inbox | `search_issues query:"label:triage state:open"`, newest first, ~30 max | Bodies opening "Human action required", or stating a decision only Paul can make |
| Open PRs | `list_pull_requests state:open` | Awaiting his review, red CI with no session driving it, merge conflicts, a review thread asking him a question |
| Recent sessions | `list_sessions mine:true limit:20` (Claude Code Remote) | Titles and status only, so a stalled session is a pointer to check, not a finding. If the server isn't connected, note it and sweep the rest |

The two `fp=… in:body` searches may miss older markers written as HTML comments; whether search
indexes comment text hasn't been re-measured. The `[human]` and `[pr-followup]` title prefixes are
reliable, so lean on the Human Action List and the triage inbox to cover the gap, and never conclude
from an empty `fp=` result that nothing is waiting.

Then:

- **Dedup.** One action often appears on the List, as its own issue, and in a PR thread. Collapse it
  to one candidate anchored on the issue, since closing updates that.
- **Drop what isn't his:** agent-doable work, anything `in-progress`, `routine-state` issues,
  `scope:production` items (parked by owner decision, not blocked or stale), and anything a thread
  shows he already decided.
- **Rank** by what clearing it releases, not by age: (1) it blocks agent work or a merge now; (2)
  it's cheap (a toggle or one-line answer) and has sat for weeks; (3) it gates several other issues;
  (4) age, as a tiebreaker.

Filter to the argument if one was given. If nothing needs him, say so in one line and stop.

## Phase 2 — Present and pick one

Show at most 6, ranked, one line each:

```
#N — <the action, imperative> — <why it needs you: decision / credential / dashboard / purchase> —
      unblocks <what> — ~<time>
```

Then ask with `AskUserQuestion`, the top 4 as options (his "Other" covers the rest of the list or
any issue number he names). One question, one pick. With `--list-only`, print the list and stop.

## Phase 3 — Walk that one to done

First check whether it's already handled, against the current code, config, or provider state. If
it is, close it with the proof and offer him the next item.

1. **Ground the steps in reality, not the issue.** Its "How to do it" was written at filing time and
   may have drifted; confirm names and paths against the repo, and provider state with
   [`/infrastructure-research`](../infrastructure-research/SKILL.md). Fix a doc you find wrong in
   the same pass (fix ladder in
   [`DOCUMENTATION_CONVENTIONS.md`](../../../docs/internal/DOCUMENTATION_CONVENTIONS.md)).
2. **Do everything you can yourself first**, and say what you did. Only what needs his account, his
   card, his dashboard, or his judgment reaches him.
3. **Hand him one step at a time** and wait for each outcome, per
   [`AGENTS.md` § Operating mindset](../../../AGENTS.md#operating-mindset).
4. **Prove it.** Name what makes it verifiably finished (a green run, a config read-back, a commit)
   and check that rather than accepting "done".
5. **Close the loop where the item lives.** An issue gets a comment with the proof and a close
   (`completed`, or `not_planned` with the reasoning if he chose to drop it); ask first before
   closing anything not `suggestion`-labeled, since that's outside the routines' ownership boundary
   and his call. An item with no issue gets its decision or answer on the PR or thread that asked;
   merging and approving stay his. Either way, record the outcome somewhere durable, not only in
   this chat.
6. **Leave the Human Action List alone.** PR Follow-ups rebuilds it from live issue state each run;
   a hand-edit is overwritten and can damage its state marker.

If the walk uncovers real work rather than a quick action, say so and offer to hand it to `/next` or
a fresh session ([`/handoff`](../handoff/SKILL.md)) instead of growing this one.

## Guardrails

- One item per invocation. Finish it, then offer the next.
- File nothing. Mention new work instead; the curator and triage routines own the inbox. The
  exception is a newly proven human-only blocker, which still gets its `[human]` issue.
- Every shortlist line comes from a live read this run.
- Secret names only, never values.
- No full PR body reads before Phase 3.
