Context: migrations currently reach staging via a manual runbook a human runs by hand. This just caused a real incident — two migrations from PR #1259 merged to main but were never promoted to staging, causing a live 500 that only surfaced during manual testing. Research confirms the fix: auto-apply migrations to staging on merge to main (this is Supabase's own documented GitHub Actions pattern), keep production on manual/gated promotion, and add a CI check that makes drift impossible to miss even if something slips through.

Build:

1. **Staging auto-apply on merge to main**
   - GitHub Actions workflow, triggered on merge to `main`, that runs `supabase link` + `supabase db push` against the staging Supabase project.
   - Use `supabase db push --dry-run` first and fail the job loudly (not silently) if the dry-run errors, before attempting the real push.
   - This must run as a single serialized job — confirm nothing else could race it (e.g., a manual runbook run at the same time), since concurrent `db push` calls conflict.
   - Alert clearly (however this repo currently surfaces CI failures — check existing patterns) if the apply step fails. A failed migration apply must not be a silent no-op.

2. **Production stays manual, but make the gate explicit, not a runbook someone has to remember**
   - Production migration promotion should be a deliberate, separate, manually-triggered workflow (`workflow_dispatch` or similar) — not folded into the automatic pipeline.
   - Check if a GitHub Environment with a required reviewer is a good fit here for an extra layer, given this repo already treats production changes as higher-stakes.

3. **Migration-drift required check (build this even if item 1 gets deprioritized — it's the minimum fix)**
   - A required CI check that runs `supabase migration list` against the staging project and fails if any migration present on `main` hasn't been applied to staging.
   - This is what would have caught the actual incident. Make sure it can't be silently skipped the way other required checks in this repo have been in the past (check existing required-check enforcement patterns first).

4. **Migration safety linting on PRs (new schema changes only, don't retroactively fail on existing migrations)**
   - Add a linter for lock-unsafe patterns (missing `CONCURRENTLY` on index creation, unsafe constraint additions, etc.) — Squawk is the commonly recommended tool for Postgres; check if it or an equivalent fits this repo's existing tooling before adding a new dependency.
   - This should be advisory-first (comment on the PR) unless you're confident it won't produce false positives on this repo's existing migration patterns — confirm with me before making it a hard required-check block.

5. **Update the promotion runbook**
   - Rewrite `docs/internal/ops/DB_PROMOTION_RUNBOOK.md` to reflect the new reality: staging is automatic, only production promotion is a manual runbook step. Remove staging-specific manual instructions that no longer apply.

For each item: write tests where applicable, flag ambiguity instead of guessing, and report back what shipped vs. what needs a follow-up issue. This is CI/CD infrastructure, not product code — be conservative and favor "fails loudly and safely" over "clever."