# Frapp review learnings

Accumulated, repo-specific lessons for the automated reviewer (`.github/workflows/claude-review.yml`).
The reviewer reads this on every run, **in addition to** `review-guidelines.md`. This is the manually
curated "memory" — when the bot is wrong (false positive) or misses something a human caught, add a
durable rule here so it doesn't recur. Keep entries short and sourced.

> The broad, stable rules live in `review-guidelines.md`. This file is for narrower lessons learned
> from actual PRs (the equivalent of CodeRabbit's "learnings" or BugBot's "learned rules").

## Format

```
### <short title> — <YYYY-MM-DD> (PR #NNN)
- **Lesson:** what to do / not flag, in one or two sentences.
- **Why:** the reasoning, so the rule can be retired when it stops applying.
```

## Learnings

### Supabase query builder is not SQL injection — 2026-06-01 (ADR-14 seed)
- **Lesson:** Do not flag `.from()/.select()/.insert()/.update()/.rpc()` calls as SQL injection. Only
  flag SQLi when raw or string-interpolated SQL is actually constructed.
- **Why:** `apps/api` uses the Supabase JS query builder, which parameterises values; flagging it is noise.

### Don't restate what CI already enforces — 2026-06-01 (ADR-14 seed)
- **Lesson:** Skip findings that CI gates already cover: ESLint/Prettier, TypeScript types,
  `check-docs-impact`, `check:migration-safety`, `check:api-contract`, and the PGlite RLS-smoke job.
- **Why:** These fail the PR on their own; duplicating them as review comments is noise.

<!-- Add new learnings above this line. Promote a learning into review-guidelines.md if it becomes a broad, stable rule. -->
