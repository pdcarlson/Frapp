---
name: issue-triage
description: >
  Run the Issue Triage routine (2 of 4) — process the GitHub `triage` inbox (dedup, set priority,
  backfill Agent briefs, promote to Backlog) and groom the existing Backlog so `/next` always has
  clean, correctly-ranked work. Use when the scheduled "Issue Triage" routine fires, or when asked
  to triage the inbox or groom the board.
---

# Issue Triage (routine 2 of 4)

You keep the board clean so [`/next`](../../commands/next.md) always has good work to pull. This
routine runs **after** the [`issue-curator`](../issue-curator/SKILL.md) creation pass (≈1h later)
and keeps the GitHub Issues board healthy. Triage is **not only the `triage` inbox** — most work
lives in the **Backlog** (open issues without a state label), so this routine does two jobs:
**(A) process the `triage` inbox**, and **(B) groom the existing Backlog** — get priority labels
right (the main job, since `/next` ranks by priority), backfill
[Agent briefs](../../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode),
and attach issues to epics only when they *clearly* fit.

**Ownership, tracker, and the product-code ban** —
[`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines).
This routine only organizes the tracker. The single exception is the shared
[self-maintenance step](#self-maintenance-update-yourself).

## Tracker access

Use the **GitHub MCP** — load schemas first, e.g.
`ToolSearch("select:mcp__github__list_issues,mcp__github__issue_read,mcp__github__issue_write,
mcp__github__add_issue_comment,mcp__github__search_issues,mcp__github__sub_issue_write")` — and
verify access at the start of the run. **If the GitHub MCP is unavailable, stop and report — no
fallback.** The label roster and shared routine config live in
[`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md).

> **Never source a body edit from an MCP read — `search_issues` included.** All three read paths
> (`issue_read`, `list_issues`, `search_issues`) corrupt the body they return, three independent
> ways: HTML comments deleted (a legacy `<!-- agent-suggestion: v1 fp=… -->` dedup marker),
> unrecognised tags deleted (including JSX inside ` ```tsx ` fences), and `'`/`"`/`&`/`>`
> entity-escaped. `search_issues` was the lossless exception until it regressed on all three —
> confirmed 2026-08-20. Rewriting from that text silently destroys content — a dropped marker makes
> the curator re-file the issue as a duplicate, and a dropped code snippet is **unrecoverable**.
> Full table, the probe, and the narrow escape hatch:
> [`GITHUB_PM.md` → Reading a body you intend to rewrite](../../../docs/internal/ci-cd/GITHUB_PM.md#reading-a-body-you-intend-to-rewrite-mcp-read-fidelity).
> The same hazard applies to every routine that re-bodies an issue.
>
> **Agent-brief backfills are blocked again — and that is the correct behavior.** Runs on
> 2026-08-10 and -08-12 refused to write briefs; 2026-08-14 unblocked them on the strength of
> `search_issues` being lossless; the 2026-08-20 run refused again, correctly, because it is not.
> **Add a brief by leaving a comment**, or by authoring the full replacement body yourself under
> the escape hatch. Do not round-trip a body through a read to add a brief to it — that is exactly
> the destructive edit Pass A step 3 and Pass B would otherwise perform at scale.
>
> **What still works:** the `fp=` **lookup**. `search_issues` resolves fingerprints precisely (1 hit
> for a real one, 0 for a fabricated one), so dedup needs no redesign — only the marker format
> changed, to a **visible line**. Start each run with the marker-count guard in `GITHUB_PM.md`.
>
> `search_issues` is a **semantic** search, not a fetch-by-number, so it can miss or mis-rank the
> issue you want. Query it with distinctive words from the target's own title, then **check that a
> returned item's `number` is the issue you intend** before using it.

## Ownership: organize freely, destroy narrowly

Shared rules:
[`ROUTINES.md` → Shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines).
Triage's job is to **organize the whole inbox**, whoever filed it — so setting a **priority
label**, an **`Estimate:` line**, and **`Blocked by #N`** lines on any `triage` item is in scope.
But **destructive** actions (close, mark duplicate, re-body) are limited to **`suggestion`-owned**
issues:

- **Organize (any `triage` item):** fill an *absent* priority label (never overwrite a human-set
  one), record Blocked-by (as a comment — see Pass A step 4), attach to an epic where it clearly
  belongs, promote to Backlog (remove `triage`).
- **Destroy (`suggestion`-owned only):** close as junk/obsolete (`not_planned`), mark duplicate
  (`duplicate` + `duplicate_of`), edit the body (including adding an Agent brief). **Never** close
  or re-body a human/internal issue — a human-filed item that looks wrong stays in triage with a
  comment for the human. One that merely lacks an Agent brief is **not** held: an absent brief
  simply reads as `depth:deep` to `/next`, so nothing is blocked.

Run the pre-write gate (`issue_read get_labels`, confirm `suggestion` is present) before any
**destructive** write. And remember `issue_write`'s `labels` field **replaces the whole set** —
always send the union of existing labels plus your change.

## Pass A — the `triage` inbox (the main job)

Pull everything labeled **`triage`** (`list_issues` with `labels: ["triage"]`, state OPEN). For
each:

1. **Dedup.** If it duplicates an existing open issue: when the triage item is
   `suggestion`-owned, close it as `duplicate` with `duplicate_of` the canonical; otherwise leave
   it and comment the likely duplicate for a human.
2. **Prioritize.** Set a **priority label** (`P1`–`P4`) from impact — **required**: an issue may
   not leave triage without one. On human-filed items, only fill an *absent* priority — never
   overwrite one a human set. Optionally add an `Estimate: <fibonacci>` body line if scope is
   clear.
3. **Agent brief.** On `suggestion`-owned items missing one, add the `### Agent brief` section
   (template in the [curator skill](../issue-curator/SKILL.md#agent-brief); field policy in
   [`GITHUB_PM.md`](../../../docs/internal/ci-cd/GITHUB_PM.md#agent-briefs-depth--model--ultracode));
   fix a brief that is obviously mis-calibrated (a schema-touching change marked `skim`). **Err
   deeper**: when unsure between two depths, pick the deeper one. **Deliver it as a comment**, not
   as a body edit — per the read-fidelity block above, adding a section to an existing body means
   round-tripping that body through a lossy read. `/next` reads the brief either way.
4. **Blocked-by.** Record `Blocked by #N` where a dependency is obvious. **Deliver it as a
   comment**, not as a body edit, for exactly the reason step 3 does: adding a line to an existing
   body means round-tripping that body through a lossy read, and most `triage` items were authored
   by someone else. Writing the line into the body is correct only for a body you authored this
   run. `/next` §1.1 verifies blockers against the repo rather than the tracker, so a commented
   blocker is honored either way.
5. **Epic attach.** Attach as a sub-issue (`sub_issue_write`) when it clearly belongs to an open
   `[Epic]`. If none fit, leave it standalone.
6. **Promote or hold:**
   - `suggestion`-owned **or** clearly well-formed and actionable → **remove the `triage` label**
     (that is the promotion to Backlog).
   - **Exception — human-action holds:** a `[pr-followup][human]` or bare `[human]` title
     prefix, or a body opening with `**Human action required — hold in triage`, means the item
     needs Paul, not an agent — **never promote it** (that would hand `/next` work it cannot do);
     leave it in triage untouched apart from priority/estimate. The weekly
     [`pr-followups`](../pr-followups/SKILL.md) routine owns its lifecycle (namespaces
     `fp=pr-followup/` and `fp=human/`). If a `[human]`-titled item is missing the `suggestion`
     label or the `fp=human/` marker, backfill both (that's organizational repair, and the label
     is what lets its owner routine close it).
   - Ambiguous, under-specified, or a significant human-filed decision → **leave in triage** + a
     short comment on what's needed. Don't force-promote work a human should accept.

## Pass B — Backlog grooming (priority first; epics only when they fit)

Most work lives in the **Backlog** (open, no state label), and much of the AI-filed `suggestion`
backlog lands unprioritized. `/next` ranks the Backlog **purely by priority label**, so the most
valuable backlog job is **getting priorities right** — that's what keeps genuine work from being
buried under suggestions. Each run, groom a batch (~25 issues, oldest-groomed first so successive
runs walk the whole Backlog):

- **Prioritize (the main job):** set a sensible **priority label** on any `suggestion`-owned
  Backlog issue missing one, and fix obviously-wrong ones. **Don't inflate** — a routine
  suggestion is `P3`/`P4`; `P2` is for genuine high-impact (security, data-loss, broken core
  flows). Correct priority is what protects real work in `/next`.
- **Agent briefs:** within the same batch, backfill missing briefs on `suggestion`-owned issues
  and correct mis-calibrated ones — same rules as Pass A step 3, **including delivering them as
  comments rather than body edits**.
- **Epic-attach ONLY clear fits:** attach a suggestion as an epic's sub-issue **only when it
  unambiguously belongs** to that epic's scope. **Leave general, cross-cutting, infra, or
  speculative suggestions standalone — most suggestions stay standalone, and that's correct.**
  Never force-bucket to "clear the pile." For a `suggestion`-owned issue already attached to an
  epic it doesn't fit, you may detach it.
- **Estimate:** optional `Estimate:` body line when scope is clear.
- **Stale / dups:** add `stale` to obvious aging `suggestion`s the curator missed; close/dedup
  only `suggestion`-owned issues, and only with proof. Never mark a **`scope:production`** issue
  `stale` or age-bump its priority — those are parked by owner decision (see the label roster in
  [`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md)).
- **Ownership:** on human/planning issues, only fill an *absent* priority — never re-bucket,
  re-prioritize, close, or re-body them. Don't restructure epics.

Goal: a Backlog where every item has a **sane priority label** and an **Agent brief** (on
`suggestion`-owned issues), and **only genuinely-scoped** suggestions sit under epics.

## Board-health report

End every run with a short report (in your reply — routines surface it to the maintainer):

- Inbox: items processed, promoted, held (and why, one line each for holds).
- Backlog: batch groomed, priorities set/corrected, briefs backfilled.
- Anomalies you did **not** act on: `in-progress` issues that look abandoned (leave the sweep to
  `/next` §0.7 — report only), human-filed items waiting on a decision, suspected duplicates
  across the ownership boundary.
- One-line signal for the curator: open-`suggestion` count and whether consolidation mode binds.

## Self-maintenance (update yourself)

End the run by checking this file and the shared config in
[`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md) against the live repo (label roster,
links, tool names). Mechanical drift → a docs-only PR **per the binding contract in
[`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract)**
(that section — not this paragraph — defines the allowed paths and limits). Judgment-laden drift →
file a `suggestion` (`area:docs`) instead. That contract is the **only** repo write this routine is
permitted, ever.

## Guardrails

- **Organize broadly, destroy narrowly** — close/duplicate/re-body only `suggestion`-owned issues
  ([shared ownership boundary](../../../docs/internal/ci-cd/ROUTINES.md#shared-ownership-boundary-all-routines));
  never close a human-filed issue.
- **Never** auto-promote a human-filed triage item that reads like a real decision — surface it
  instead.
- **Never** print secret values.
- Setting a priority label is mandatory when removing `triage` (promotion).
- Leave **`in-progress`** and **`in-review`** issues alone entirely — claims and sweeps belong to
  `/next`, not this routine. Leave **`routine-state`** issues alone too — routine infrastructure,
  never inbox or Backlog work.
- A run that only organizes/holds and promotes nothing is still a success.
