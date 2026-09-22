---
name: file-follow-up
description: >
  File out-of-scope, deferred, or blocked work as a GitHub issue a fresh agent can execute cold —
  including proven human-only blockers. Use when work surfaces that does not belong in the current
  PR, when verification is blocked, when a review finding is deferred, or when something has been
  proven to need the human (environment/network policy, missing credential, dashboard-only toggle,
  purchase, product decision).
---

# File follow-up work as a GitHub issue

When work surfaces that doesn't belong in the current PR, file it as a GitHub issue (`issue_write`
create) written so a fresh agent can execute it cold. Cloud VMs are ephemeral, so anything left only
in chat or in the next session's memory is lost. Policy on labels, states, Agent briefs, and
ownership lives in [`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md); this is the agent
playbook.

## When to file

- Deferred or out-of-scope work found mid-task (data backfills, follow-up refactors).
- Blocked verification: the sandbox can't run something (Docker or Supabase won't start, missing
  external creds). Say it's blocked and link the issue; never check a verification box you couldn't
  run.
- Review findings you aren't fixing in this PR, with the reason.
- A bug or security hole outside the current scope.
- Cross-cutting prerequisites or blockers.
- A proven human-only blocker (below).

Fix trivial nits in the current PR instead of filing them. Search first (`search_issues`, open and
closed, including `[human]` titles) and refresh a near-match rather than duplicating it.

## How to write one (so an agent can execute it)

Labels: `triage`, exactly one `area:<x>`, and a priority (`P1` urgent, `P2` high, `P3` medium, `P4`
low). The `area:` roster lives in
[`ROUTINES.md` → Tracker access](../../../docs/internal/ci-cd/ROUTINES.md#tracker-access-shared-by-all-routines).

Body:

- **Meta block:** `Blocked by #N` lines where relevant (dependencies are body lines, not labels),
  the originating PR, and an `### Agent brief` (`depth:` / `model:` / `ultracode:`; lean toward
  `depth:deep`; syntax in
  [`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode)).
- **Problem/context:** what's wrong and why it matters, with exact file paths and line refs.
- **Acceptance criteria:** objectively verifiable checkboxes.
- **Implementation notes:** constraints, helpers to reuse, gotchas.
- **Definition of done:** "PR linked with `Fixes #N`, criteria met, CI green."

Lifecycle: filed with `triage` → accepted to Backlog (label removed, priority confirmed) → claimed
via `/next` → PR with `Fixes #N`. An issue with an open `Blocked by #N` isn't started.

## Proven human-only blockers

File one the moment you have proven that something needs the human: an environment or
network-policy change only the owner can make, a missing credential or external account, a
dashboard-only toggle, a purchase, or a product decision.

- *Proven* means at least one real attempt, with the failure output in hand.
- *Needs the human* means no agent session could do it either. If a better-provisioned session
  could (Docker, creds, a different environment), it's ordinary blocked work, filed as above.

Title `[human] <imperative action>`; labels `triage`, `suggestion`, one `area:<x>`, and a priority.
Body:

```markdown
**Human action required — hold in triage; not for /next.**

Tried: <what you ran>. Output: <the exact error, as proof>.
Steps for the owner: <numbered, with exact setting, secret, and file names>.

`agent-suggestion: v1 fp=human/<slug> source=<session|pr#N|issue#N>`
```

Keep the marker a visible line, not an HTML comment: lossy reads have stripped comment-form markers
from bodies and the search index before. The weekly PR Follow-ups routine owns `fp=human/`: it
audits these against reality, lists every open one on the Human Action List, and closes them on
proof. The `suggestion` label is what permits that close, so always include it.

## Filing is necessary but not sufficient — end the run by *asking*

An issue is durable, but it reaches no one until the owner looks. When a run hits a blocker only the
owner can clear:

1. Keep building everything that doesn't depend on it. One blocked acceptance criterion doesn't
   stall the unit.
2. File the issue as you go.
3. Ask, choosing the channel by what the blocker is and who is there:
   - **A choice, with the owner reachable:** `AskUserQuestion`, since options are answered in a
     click and prose has to be reconstructed from a report. Give each option the trade-off that
     decides it and the exact steps its answer commits to, and lead with your recommendation.
     Release any claim before asking, because deliberation is unbounded and a held claim starves
     other sessions ([`next.md`](../../commands/next.md) §1.3, which also covers re-claiming).
   - **An action only they can take, or any blocker in an unattended run:** the end-of-run report,
     as the last thing they read, with exact steps. A prompt nobody is there to answer is a stall,
     and a `/next` batch blocked on one starves the sibling claims it holds; that command never asks
     mid-batch and routes the question to the release comment and the report (§1.3 and its Exits
     table).

Ask at the end of the run, so the owner gets one interruption at a predictable moment. The one
exception to filing as you go: if the owner is present and the blocker is small, ask on the spot
first, and if they clear it then and there, there's nothing to file. Anything they don't clear on
the spot gets filed right away, because a blocker with no issue behind it is invisible to the next
session and to the Human Action List, whatever the owner said in the moment.

A PR body is neither channel. Still write its *Flagged for review* block (`/next` requires it, and
PR Follow-ups harvests those sections into the Human Action List), but it is a record, not an ask.
Anything there that needs the owner to act or decide also goes through one of the two channels
above.

## Filing from a routine

Routines file through this skill under their own limits: the
[shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines)
plus their own skill's rules ([`docs-upkeep`](../docs-upkeep/SKILL.md) files only human-only
blockers; [`hygiene-scan`](../hygiene-scan/SKILL.md) adds a visible `fp=hygiene/…` marker and a
per-run cap). Those limits bind the routines, not feature work that uses this skill.
