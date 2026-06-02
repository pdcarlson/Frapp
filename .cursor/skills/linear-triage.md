# Skill: Linear Triage (automation 2 of 2)

> Use when running the Cursor **"Linear Triage"** automation (or by hand). It runs **after** the
> [`linear-curator.md`](linear-curator.md) creation pass (≈1h later) and keeps the Linear board healthy.
> Triage is **not only the Triage inbox** — most work lives in the **Backlog**, so this automation does
> two jobs: **(A) process the Triage inbox**, and **(B) groom the existing Backlog** — get priorities
> right, and projectify only the suggestions that *clearly* fit a Project. Both feed
> [`/next`](../../.claude/commands/next.md) clean, ranked work. **Read-only on code** — this automation
> only organizes Linear; it never writes code, opens PRs, or creates GitHub issues.

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

## Pass B — Backlog grooming (priority first; projects only when they fit)

Most work lives in the **Backlog**, and much of the AI-filed `suggestion` backlog lands unprioritized.
`/next` ranks the Backlog **purely by Priority and ignores projects**, so the most valuable backlog job is
**getting priorities right** — that's what keeps genuine work from being buried under suggestions.
Projects are for *board cleanliness*, so assign them **sparingly**. Each run, groom a batch (~25 issues):

- **Prioritize (the main job):** set a sensible **Priority** on any `suggestion`-owned Backlog issue
  missing one, and fix obviously-wrong ones. **Don't inflate** — a routine suggestion is Medium/Low; High
  is for genuine high-impact (security, data-loss, broken core flows). Correct priority is what protects
  real work in `/next`.
- **Projectify ONLY clear fits:** assign a **Project** to a suggestion **only when it unambiguously
  belongs** to an active project's scope (e.g. a chat-rework gap → Chat rework). **Leave general,
  cross-cutting, infra, or speculative suggestions projectless — most suggestions stay projectless, and
  that's correct.** Never force-bucket to "clear the pile." For a `suggestion`-owned issue already sitting
  in a project it doesn't fit, you may **clear** that project.
- **Estimate:** optional Fibonacci estimate when scope is clear.
- **Stale / dups:** add `stale` to obvious aging `suggestion`s the curator missed; cancel/dedup only
  `suggestion`-owned issues, and only with proof.
- **Batch budget:** ~**25** Backlog issues reviewed per run; Memory lets the next run continue.
- **Ownership:** on human/planning issues, only fill an *absent* priority — never re-bucket, re-prioritize,
  cancel, or re-body them. Don't restructure epics/Projects.

Goal: a Backlog where every item has a **sane Priority**, and **only genuinely-scoped** suggestions sit in
Projects (the rest stay projectless by design).

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
