# Skill: Linear Triage (automation 2 of 2)

> Use when running the Cursor **"Linear Triage"** automation (or by hand). It runs **after** the
> [`linear-curator.md`](linear-curator.md) creation pass (≈1h later) and keeps the Linear board healthy:
> process the **Triage inbox**, set **Priority**, bucket issues into the right **Project**, dedup, and
> promote clearly-actionable work into **Backlog** so [`/next`](../../.claude/commands/next.md) can pick it
> up. **Read-only on code** — this automation only organizes Linear; it never writes code, opens PRs, or
> creates GitHub issues.

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

## Pass B — Light board hygiene (Backlog)

A quick, conservative sweep of the **Backlog** to keep `/next` fed with clean, ranked work:

- **Missing Priority** on a `suggestion`-owned Backlog issue → set it. (Leave human issues' priority alone
  unless clearly absent and obvious.)
- **Wrong/empty Project** on a `suggestion`-owned issue → re-bucket.
- **Obvious stale `suggestion`** the curator missed → add `stale` (don't cancel without proof).
- Do **not** restructure epics/Projects or touch human planning items beyond setting an absent project/priority.

Keep this pass small — it's hygiene, not a re-plan.

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
