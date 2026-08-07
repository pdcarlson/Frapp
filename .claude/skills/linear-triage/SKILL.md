---
name: linear-triage
description: >
  Run the Linear Triage routine (2 of 3) — process Linear's Triage inbox (dedup, set Project +
  Priority, backfill Agent briefs, promote to Backlog) and groom the existing Backlog so `/next`
  always has clean, correctly-ranked work. Use when the scheduled "Linear Triage" routine fires, or
  when asked to triage the inbox or groom the Linear board.
---

# Linear Triage (routine 2 of 3)

You keep the board clean so [`/next`](../../commands/next.md) always has good work to pull. This
routine runs **after** the [`linear-curator`](../linear-curator/SKILL.md) creation pass (≈1h later)
and keeps the Linear board healthy. Triage is **not only the Triage inbox** — most work lives in the
**Backlog**, so this routine does two jobs: **(A) process the Triage inbox**, and **(B) groom the
existing Backlog** — get priorities right (the main job, since `/next` ranks by Priority and ignores
projects), backfill [Agent briefs](../../../docs/internal/ci-cd/LINEAR_PM.md#agent-briefs-depth--model--ultracode),
and projectify only suggestions that *clearly* fit.

**Read-only on product code** — this routine only organizes Linear; it never writes application
code, opens feature PRs, or creates GitHub issues. The single exception is the shared
[self-maintenance step](#self-maintenance-update-yourself).

## Linear access

Use the **native Linear MCP** — load schemas first, e.g.
`ToolSearch("select:mcp__Linear__list_issues,mcp__Linear__get_issue,mcp__Linear__save_issue,
mcp__Linear__save_comment,mcp__Linear__list_comments,mcp__Linear__list_projects,
mcp__Linear__get_team")` — and verify access at the start of the run. **If the Linear MCP is
unavailable, stop and report — no fallback.** The ID cache and shared routine config live in
[`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md).

## Ownership: organize freely, destroy narrowly

Triage's job is to **organize the whole inbox**, whoever filed it — so setting **Project**,
**Priority**, **estimate**, and relations on any Triage item is in scope. But **destructive**
actions (Cancel, mark duplicate, re-body) are limited to **`suggestion`-owned** issues, exactly as
in the curator skill:

- **Organize (any Triage item):** set project, optional estimate, fill an *absent* priority (never
  overwrite a human-set one), add blocked-by relations, promote to Backlog.
- **Destroy (`suggestion`-owned only):** Cancel as junk/obsolete, mark duplicate, edit the body
  (including adding an Agent brief). **Never** cancel or re-body a human/internal issue — a
  human-filed item that looks wrong stays in Triage with a comment for the human. One that merely
  lacks an Agent brief is **not** held: an absent brief simply reads as `depth:deep` to `/next`,
  so nothing is blocked.

Run the pre-write gate (fetch the issue, confirm `suggestion` is among its labels) before any
**destructive** write.

## Pass A — Triage inbox (the main job)

Pull everything in the **Triage** state for team Frapp Live. For each:

1. **Dedup.** If it duplicates an existing open issue: when the Triage item is `suggestion`-owned,
   Cancel it + `duplicate` relation to the canonical; otherwise leave it and comment the likely
   duplicate for a human.
2. **Bucket.** Set the project when it clearly belongs to one. If none fit, leave projectless.
3. **Prioritize.** Set **Priority** (1 Urgent…4 Low) from impact — **required**: Linear is
   configured to require a priority to leave Triage. On human-filed items, only fill an *absent*
   Priority — never overwrite one a human set. Optionally set a Fibonacci **estimate** if
   scope is clear.
4. **Agent brief.** On `suggestion`-owned items missing one, add the
   `### Agent brief` section (template in the [curator skill](../linear-curator/SKILL.md#agent-brief);
   field policy in [`LINEAR_PM.md`](../../../docs/internal/ci-cd/LINEAR_PM.md#agent-briefs-depth--model--ultracode));
   fix a brief that is obviously mis-calibrated (a schema-touching change marked `skim`). **Err
   deeper**: when unsure between two depths, pick the deeper one.
5. **Relations.** Add blocked-by relations where a dependency is obvious.
6. **Promote or hold:**
   - `suggestion`-owned **or** clearly well-formed and actionable → move state to **Backlog**.
   - **Exception — human-action holds:** a `[pr-followup][human]` title or a body opening with
     `**Human action required — hold in Triage` means the item needs Paul, not an agent — **never
     promote it** (that would hand `/next` work it cannot do); leave it in Triage untouched apart
     from priority/estimate. The weekly [`pr-followups`](../pr-followups/SKILL.md) routine owns its
     lifecycle.
   - Ambiguous, under-specified, or a significant human-filed decision → **leave in Triage** + a
     short comment on what's needed. Don't force-promote work a human should accept.

## Pass B — Backlog grooming (priority first; projects only when they fit)

Most work lives in the **Backlog**, and much of the AI-filed `suggestion` backlog lands
unprioritized. `/next` ranks the Backlog **purely by Priority and ignores projects**, so the most
valuable backlog job is **getting priorities right** — that's what keeps genuine work from being
buried under suggestions. Projects are for *board cleanliness*, so assign them **sparingly**. Each
run, groom a batch (~25 issues, oldest-groomed first so successive runs walk the whole Backlog):

- **Prioritize (the main job):** set a sensible **Priority** on any `suggestion`-owned Backlog issue
  missing one, and fix obviously-wrong ones. **Don't inflate** — a routine suggestion is Medium/Low;
  High is for genuine high-impact (security, data-loss, broken core flows). Correct priority is what
  protects real work in `/next`.
- **Agent briefs:** within the same batch, backfill missing briefs on `suggestion`-owned issues and
  correct mis-calibrated ones — same rules as Pass A step 4.
- **Projectify ONLY clear fits:** assign a project to a suggestion **only when it unambiguously
  belongs** to an active project's scope. **Leave general, cross-cutting, infra, or speculative
  suggestions projectless — most suggestions stay projectless, and that's correct.** Never
  force-bucket to "clear the pile." For a `suggestion`-owned issue already sitting in a project it
  doesn't fit, you may **clear** that project.
- **Estimate:** optional Fibonacci estimate when scope is clear.
- **Stale / dups:** add `stale` to obvious aging `suggestion`s the curator missed; cancel/dedup only
  `suggestion`-owned issues, and only with proof.
- **Ownership:** on human/planning issues, only fill an *absent* priority — never re-bucket,
  re-prioritize, cancel, or re-body them. Don't restructure epics/Projects.

Goal: a Backlog where every item has a **sane Priority** and an **Agent brief** (on
`suggestion`-owned issues), and **only genuinely-scoped** suggestions sit in Projects.

## Board-health report

End every run with a short report (in your reply — routines surface it to the maintainer):

- Inbox: items processed, promoted, held (and why, one line each for holds).
- Backlog: batch groomed, priorities set/corrected, briefs backfilled.
- Anomalies you did **not** act on: issues In Progress that look abandoned (leave the sweep to
  `/next` §0.7 — report only), human-filed items waiting on a decision, suspected duplicates across
  the ownership boundary.
- One-line signal for the curator: open-`suggestion` count and whether consolidation mode binds.

## Self-maintenance (update yourself)

End the run by checking this file and the shared config in
[`ROUTINES.md`](../../../docs/internal/ci-cd/ROUTINES.md) against the live workspace (ID cache,
states, labels, projects, links). Mechanical drift → a docs-only PR **per the binding contract in
[`ROUTINES.md` → Self-maintenance](../../../docs/internal/ci-cd/ROUTINES.md#self-maintenance-the-update-themselves-contract)**
(that section — not this paragraph — defines the allowed paths and limits). Judgment-laden drift →
file a `suggestion` (`area:docs`) instead. That contract is the **only** repo write this routine is
permitted, ever.

## Guardrails

- **Organize broadly, destroy narrowly** — Cancel/duplicate/re-body only `suggestion`-owned issues;
  never cancel a human-filed issue.
- **Never** modify product code, open feature PRs, or create GitHub issues — Linear only (docs-only
  self-maintenance PR excepted).
- **Never** auto-promote a human-filed Triage item that reads like a real decision — surface it
  instead.
- **Never** print secret values.
- Setting Priority is mandatory when promoting out of Triage (mirrors Linear's "require explicit
  prioritization" team setting).
- Leave **In Progress** and **In Review** issues alone entirely — claims and sweeps belong to
  `/next`, not this routine.
- A run that only organizes/holds and promotes nothing is still a success.
