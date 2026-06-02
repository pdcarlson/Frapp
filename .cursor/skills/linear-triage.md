# Skill: Linear Triage (automation 2 of 2)

> Use when running the Cursor **"Linear Triage"** automation (or by hand). It runs **after** the
> [`linear-curator.md`](linear-curator.md) creation pass (≈1h later) and keeps the Linear board healthy.
> Triage is **not only the Triage inbox** — most work lives in the **Backlog**, so this automation does
> two jobs: **(A) process the Triage inbox**, and **(B) groom the existing Backlog** (projectify and
> prioritize what's already there). Both feed [`/next`](../../.claude/commands/next.md) clean, ranked,
> bucketed work. **Read-only on code** — this automation only organizes Linear; it never writes code,
> opens PRs, or creates GitHub issues.

All reads/writes go to **Linear** via the `LINEAR_API_KEY` — see
[Linear API access](../../docs/internal/ci-cd/CURSOR_AUTOMATIONS.md#linear-api-access-shared-by-both-automations)
for auth, the GraphQL helper, and the ID cache (team, states, projects, labels).

---

## Ownership: organize freely, destroy narrowly

Triage's job is to **organize the whole inbox**, whoever filed it — so setting **Project**, **Priority**,
**estimate**, and relations on any Triage item is in scope. But **destructive** actions (Cancel, mark
duplicate, re-body) are limited to **`suggestion`-owned** issues, exactly as in the curator skill:

- **Organize (any Triage item):** set `projectId`, `priority`, optional `estimate`, add blocked-by
  relations, promote to Backlog.
- **Destroy (`suggestion`-owned only):** Cancel as junk/obsolete, mark duplicate. **Never** cancel or
  re-body a human/internal issue — if a human-filed item looks wrong, leave it in Triage with a comment
  for the human.

Run the pre-write gate (read the issue's `labels`) before any **destructive** write.

---

## Pass A — Triage inbox (the main job)

Pull everything in the **Triage** state for team Frapp Live. For each:

1. **Dedup.** If it duplicates an existing open issue: when the Triage item is `suggestion`-owned, Cancel
   it + `duplicate` relation to the canonical; otherwise leave it and comment the likely duplicate for a
   human.
2. **Bucket.** Set `projectId` to the right Project (Chat rework / AI features / Pricing & billing /
   Analytics / Platform / Security) when it clearly belongs to one. If none fit, leave projectless.
3. **Prioritize.** Set **Priority** (1 Urgent…4 Low) from impact — **required**: Linear is configured to
   require a priority to leave Triage. Optionally set a Fibonacci **estimate** if scope is clear.
4. **Relations.** Add blocked-by relations where a dependency is obvious.
5. **Promote or hold:**
   - `suggestion`-owned **or** clearly well-formed and actionable → move state to **Backlog**.
   - Ambiguous, under-specified, or a significant human-filed decision → **leave in Triage** + a short
     comment on what's needed. Don't force-promote work a human should accept.

---

## Pass B — Backlog grooming (a real job, not a token sweep)

Most work lives in the **Backlog**, and much of it (especially the AI-filed `suggestion` backlog) lands
**projectless and unprioritized**. Each run, groom a meaningful batch so the projectless pile steadily
shrinks and `/next` always has clean, ranked, bucketed work:

- **Projectify (the main backlog job):** for `suggestion`-owned Backlog issues with **no Project**, read
  the issue and assign the right **Project** (Chat rework / AI features / Pricing & billing / Analytics /
  Platform / Security) from its topic. Keep chipping away at the projectless pile every run.
- **Prioritize:** set a **Priority** on any `suggestion`-owned Backlog issue missing one.
- **Estimate:** add a Fibonacci estimate when scope is clear (optional).
- **Stale / dups:** add `stale` to obvious aging `suggestion`s the curator missed; cancel/dedup only
  `suggestion`-owned issues, and only with proof.
- **Batch budget:** process up to ~**25** Backlog issues per run so the pile shrinks steadily without one
  giant run — Memory lets the next run continue where this one left off.
- **Ownership:** on human/planning issues, at most fill an *absent* project/priority — never re-bucket,
  re-prioritize, cancel, or re-body them. Don't restructure epics/Projects.

Goal: over a handful of runs, the projectless `suggestion` backlog gets fully bucketed and ranked.

---

## Guardrails
- **Organize broadly, destroy narrowly** — Cancel/duplicate/re-body only `suggestion`-owned issues; never
  cancel a human-filed issue.
- **Never** modify code, open PRs, or create GitHub issues — Linear only.
- **Never** auto-promote a human-filed Triage item that reads like a real decision — surface it instead.
- **Never** print secret values.
- Setting Priority is mandatory when promoting out of Triage (mirrors Linear's "require explicit
  prioritization" team setting).
- A run that only organizes/holds and promotes nothing is still a success.
