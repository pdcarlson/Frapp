# Research: migration promotion — auto-apply staging vs manual

**Verdict: switch to auto-apply on staging, keep production manually gated.** This is the mainstream CI/CD pattern (Bytebase, DeployHQ) and Supabase's own documented GitHub Actions example does exactly this split by branch. The manual-runbook approach didn't just fail to prevent the incident — it structurally causes this class of bug ("merged but never promoted" is a named, common drift failure). A human remembering to run a runbook is the exact step that gets skipped under frequent merges.

**Why this matters more, not less, given AI agents merge multiple times a day:** high cadence makes manual promotion unreliable by nature, and argues for automating the mechanical staging apply. But it also argues for *sharper* human review specifically on destructive/high-risk schema changes before production — the two aren't in tension, they're complementary (automate the routine step, gate the risky one).

**Minimum fix regardless of the auto/manual decision:** a required CI check running `supabase migration list` against staging that fails if main has unapplied migrations. This alone would have caught the exact incident. Build this first.

**Recommended pipeline:**
- On merge to main → auto-apply migrations to staging (`supabase db push` against the staging project), via GitHub Actions — this is Supabase's own documented pattern.
- Production stays a separate, manually-triggered workflow (or a required-reviewer GitHub Environment).
- Guardrails to add regardless: migration linting in CI (Squawk for lock-safety, catches missing CONCURRENTLY etc.), a dry-run diff posted on the PR, `lock_timeout`/`statement_timeout` set at apply time so a bad migration fails fast instead of freezing a table.
- Design discipline: expand-contract migrations (additive first, drop old structures later) — this is what makes auto-apply to staging actually safe even with fast-moving agent-authored schema changes.
- Don't rely on auto-rollback for schema changes with real data — the realistic plan is roll-forward with a fix, not undo.

**Bottom line:** this isn't a "tighten discipline" fix, it's a pipeline change. The human checkpoint moves from "someone runs SQL by hand" to "CI blocks merge on unsafe migrations, a human explicitly approves production."