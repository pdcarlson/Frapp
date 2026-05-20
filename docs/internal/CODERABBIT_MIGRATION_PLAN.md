# CodeRabbit Migration Validation Plan

## Goal

Move PR AI review coverage from Cursor Bugbot back to CodeRabbit for the public
Frapp repository while preserving the current lightweight merge policy:

- Every PR should receive an automatic AI review.
- Reviews should be careful and high-signal, with repo-specific guidance.
- Autofix must not run by default.
- AI review feedback remains advisory unless a later decision makes it a branch
  protection gate.
- Active docs, specs, and agent guidance should describe CodeRabbit as the
  current reviewer.

## Repo-side status

Repo-side migration work is complete on this branch:

- `.coderabbit.yaml` is the checked-in CodeRabbit configuration.
- `docs/internal/CODERABBIT_RUNBOOK.md` is the active review runbook.
- Active contributor, branch-protection, PR-review, infrastructure, and
  environment docs now reference CodeRabbit.
- Bugbot rule files and `docs/internal/BUGBOT_RUNBOOK.md` were removed.
- `.gitignore` no longer keeps root `.cursor/BUGBOT.md` tracked.
- `.cursor/rules/audit.mdc` watches `.coderabbit.yaml` for audit/review-rule
  changes.

Historical context:

- Before this migration, the repo used Cursor Bugbot and no CodeRabbit config.
- Bugbot was advisory and was not a required status check.
- The old CodeRabbit setup before PR #207 used `.coderabbit.yaml`, a fallback
  `trigger-coderabbit-review.yml`, and `docs/internal/CODERABBIT_RUNBOOK.md`.
- This migration does **not** restore the fallback workflow because native
  CodeRabbit auto-review should be tested first and previous bot-gate workflows
  created CI noise.

## Current configuration source of truth

The source of truth is `.coderabbit.yaml`, not this plan. The current policy is:

- `reviews.profile: "assertive"` for careful review.
- `reviews.request_changes_workflow: false` and `reviews.review_status: false`
  so CodeRabbit remains advisory.
- `reviews.auto_review.enabled: true`.
- `reviews.auto_review.drafts: true`.
- `reviews.auto_review.base_branches: [".*"]`.
- `reviews.auto_review.auto_incremental_review: true`.
- `reviews.auto_review.auto_pause_after_reviewed_commits: 0`.
- No skip label or skip-title keyword is configured; every eligible PR should be
  reviewed.
- `knowledge_base.learnings.scope: "local"`.
- Path instructions cover API, web, mobile, shared packages, workflows, and
  Supabase migrations.

## External setup before testing

These steps happen outside the repo:

1. Confirm the CodeRabbit GitHub App is installed for `pdcarlson/Frapp`.
2. Confirm CodeRabbit recognizes the repo as open source and exposes the OSS
   plan/rate-limit tier.
3. Confirm native auto-review is enabled in CodeRabbit settings.
4. Confirm learnings are enabled and repository-scoped.
5. Check whether CodeRabbit exposes an organization or repository Autofix
   disable. If it does not, keep the operational rule from
   `CODERABBIT_RUNBOOK.md`: do not invoke Autofix commands or checkboxes.
6. Disable Cursor Bugbot for the repository in the Cursor dashboard.

## Validation PR checklist

Use this branch or a small follow-up test PR to verify behavior after external
setup:

- [ ] CodeRabbit reviews a PR to `main` automatically.
- [ ] CodeRabbit reviews a draft PR automatically, or the dashboard clearly
      explains why drafts are excluded.
- [ ] CodeRabbit re-reviews after a new push.
- [ ] CodeRabbit applies path-specific guidance from `.coderabbit.yaml`.
- [ ] CodeRabbit picks up repository guidance from `AGENTS.md` and
      `.cursor/rules/*` through code-guideline detection.
- [ ] No Autofix action runs automatically.
- [ ] No Bugbot review appears after Bugbot is disabled.
- [ ] No CodeRabbit status check is required by branch protection.
- [ ] `@coderabbitai review` manually triggers a review if auto-review misses.
- [ ] `@coderabbitai configuration` returns settings consistent with
      `.coderabbit.yaml`.

## Cleanup verification

Before merging the migration PR, run:

- `git ls-files '*BUGBOT.md' 'docs/internal/BUGBOT_RUNBOOK.md'`
- `rg -i "bugbot|cursor review|bugbot run|BUGBOT.md" AGENTS.md CONTRIBUTING.md spec docs/internal .cursor/rules .cursor/skills .github/workflows .gitignore .coderabbit.yaml --glob '!docs/internal/CODERABBIT_MIGRATION_PLAN.md'`
- `npm run configure:branch-protection -- --dry-run`
- `node scripts/check-docs-impact.mjs --base origin/main --head HEAD`

Expected result:

- No tracked Bugbot rule/runbook files remain.
- No active docs reference Bugbot outside this historical plan.
- Branch protection lists only CI/docs/branch-policy checks, not CodeRabbit or
  Bugbot.
- Docs/spec sync passes.

## Branch protection policy

Do not make CodeRabbit a required status check in the first migration. Reasons:

- The previous Bugbot policy was advisory.
- OSS rate limits can pause new reviews.
- Historical bot-gate workflows caused CI friction.
- Production already requires CI, `branch-policy`, one human approval, and
  conversation resolution.

Revisit only after observing stable CodeRabbit behavior. If later required,
capture CodeRabbit's exact emitted check name from a real PR before changing
`scripts/configure-branch-protection.mjs`.

## Rollback plan

If CodeRabbit fails to review PRs reliably:

1. Re-enable Cursor Bugbot in the Cursor dashboard.
2. Revert the commit that removed `.cursor/BUGBOT.md` files and the Bugbot
   runbook, or restore those files from git history.
3. Disable CodeRabbit automatic review by setting
   `reviews.auto_review.enabled: false` until the failure is understood.
4. Do not add a required CodeRabbit check as a rollback shortcut.

## Follow-up decisions after validation

- Keep `reviews.profile: "assertive"` if reviews are useful; switch to `chill`
  only if the signal-to-noise ratio is poor.
- Decide whether any generated artifacts need a path-specific review rule rather
  than a path filter.
- Periodically prune stale or contradictory CodeRabbit learnings.
- Add a fallback workflow only if native auto-review demonstrably misses PRs;
  do not add polling or required status checks.
