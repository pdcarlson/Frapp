# CodeRabbit Migration Plan

## Goal

Migrate PR AI review coverage from Cursor Bugbot back to CodeRabbit for the public
Frapp repository, while preserving the current lightweight merge policy:

- Every PR should receive an AI review automatically.
- Reviews should be careful and high-signal, with repo-specific guidance.
- Auto-fix must not be part of the default workflow.
- Review feedback stays advisory unless a later, explicit decision makes it a
  branch-protection gate.
- Repo docs, specs, and agent guidance must not keep stale Bugbot instructions
  after the migration lands.

## Current confirmed state

- `pdcarlson/Frapp` is public and uses `main` as the default branch.
- The repo currently has no `.coderabbit.yaml` and no CodeRabbit workflow.
- The repo is configured around Cursor Bugbot:
  - `.cursor/BUGBOT.md`
  - `apps/api/.cursor/BUGBOT.md`
  - `apps/web/.cursor/BUGBOT.md`
  - `apps/mobile/.cursor/BUGBOT.md`
  - `packages/.cursor/BUGBOT.md`
  - `.github/workflows/.cursor/BUGBOT.md`
  - `supabase/migrations/.cursor/BUGBOT.md`
  - `docs/internal/BUGBOT_RUNBOOK.md`
- Bugbot is advisory. There is no required `bugbot-review` status check.
- Historical CodeRabbit setup existed before PR #207:
  - `.coderabbit.yaml`
  - `.github/workflows/trigger-coderabbit-review.yml`
  - `docs/internal/CODERABBIT_RUNBOOK.md`

## External research to verify before implementation

These items should be checked again immediately before the migration PR is
opened, because CodeRabbit plan behavior can change outside the repo.

1. OSS eligibility
   - Confirm the installed CodeRabbit account classifies `pdcarlson/Frapp` as
     open source.
   - Current docs say OSS public repositories get Pro+ features with no credit
     card, subject to a separate OSS rate-limit tier.
   - Current docs list OSS PR review limits as 1-8 reviews per developer per
     hour; that makes CodeRabbit a poor hard merge gate unless observed limits
     are comfortably above repo traffic.
2. Autofix controls
   - Current docs describe Autofix as manually triggered by commands or GitHub
     checkboxes.
   - No documented `.coderabbit.yaml` setting was found to hard-disable Autofix.
   - Before migration, inspect the CodeRabbit UI for an organization or
     repository-level Autofix disable. If none exists, document the operational
     rule: do not invoke Autofix commands or any Autofix checkbox.
3. Learning behavior
   - Confirm learnings are enabled for the CodeRabbit organization.
   - Use repository-local learnings unless there is a deliberate decision to
     share preferences across other repositories.
   - Confirm who has permission to view, edit, export, or delete learnings.
4. Review strictness
   - Confirm `reviews.profile: "assertive"` is still the right setting for
     careful reviews.
   - Validate the final YAML against CodeRabbit's current schema before merge.
5. Native auto-review reliability
   - Verify native auto-review covers opened, reopened, ready-for-review, and
     synchronize events without a repo workflow.
   - Only reintroduce a workflow fallback if native review misses real PRs.

## Proposed repository configuration

Add `.coderabbit.yaml` in the migration PR. Start from this shape, then validate
against the live CodeRabbit schema:

```yaml
# yaml-language-server: $schema=https://coderabbit.ai/integrations/schema.v2.json
language: "en-US"

reviews:
  profile: "assertive"
  review_status: false
  request_changes_workflow: false
  review_details: true

  auto_review:
    enabled: true
    drafts: true
    base_branches:
      - ".*"
    auto_incremental_review: true
    auto_pause_after_reviewed_commits: 0
    labels:
      - "!do-not-review"
    ignore_title_keywords:
      - "[skip review]"

  path_filters:
    - "!dist/**"
    - "!coverage/**"
    - "!**/*.generated.*"
    - "!packages/api-sdk/src/types.ts"

  path_instructions:
    - path: "apps/api/**"
      instructions: |
        Prioritize security, input validation, SQL injection risks, auth guard
        coverage, permission checks, DTO validation, Swagger metadata, and
        OpenAPI/API SDK drift.

    - path: "apps/web/**"
      instructions: |
        Review App Router server/client boundaries, browser exposure of
        sensitive data, accessibility, loading states, empty states, error
        states, and offline/degraded behavior.

    - path: "apps/mobile/**"
      instructions: |
        Watch for iOS/Android differences, Expo integration issues,
        AsyncStorage and notification permission handling, effect cleanup,
        subscriptions, and degraded/offline UX.

    - path: "packages/**"
      instructions: |
        Shared packages affect API, web, and mobile consumers. Flag breaking
        exports, hidden coupling, or uncoordinated downstream changes.

    - path: ".github/workflows/**"
      instructions: |
        Treat workflow changes as release infrastructure. Check secret
        exposure, minimal permissions, production branch conditions,
        workflow_run conclusions, required-check names, and branch-protection
        documentation drift.

    - path: "supabase/migrations/**"
      instructions: |
        Treat every migration as production-impacting. Flag destructive SQL,
        missing RLS on new tables, lock-heavy operations, downtime risk,
        missing rollback notes, and API contract incompatibility.

knowledge_base:
  learnings:
    scope: "local"
  code_guidelines:
    enabled: true
```

Open question: whether to exclude generated artifacts like
`packages/api-sdk/src/types.ts` entirely or ask CodeRabbit to check that they
were regenerated when controllers/DTOs change. The old Bugbot guidance preferred
flagging missing regeneration; the migration PR should test which behavior
produces better comments.

## Migration phases

### Phase 0 - Preflight research

1. Confirm CodeRabbit GitHub App installation availability for `pdcarlson/Frapp`.
2. Confirm OSS plan status and actual review quota in the CodeRabbit UI.
3. Confirm whether Autofix can be disabled in UI/support settings.
4. Export or screenshot relevant CodeRabbit settings for the PR description.
5. Confirm Bugbot dashboard setting can be disabled after the repo change lands.

Exit criteria:

- CodeRabbit can access the repository.
- The team understands Autofix controls and residual risk.
- The team accepts advisory review mode and rate-limit tradeoffs.

### Phase 1 - Add CodeRabbit config without removing Bugbot

1. Add `.coderabbit.yaml`.
2. Keep `request_changes_workflow: false` and `review_status: false`.
3. Keep Bugbot docs/config temporarily so there is a fallback during validation.
4. Open a test PR and confirm:
   - CodeRabbit reviews automatically.
   - CodeRabbit re-reviews after a push.
   - Draft PR behavior matches the chosen `drafts` setting.
   - CodeRabbit applies path instructions.
   - CodeRabbit references repository guidance from `AGENTS.md` and
     `.cursor/rules/*`.
5. Ask CodeRabbit for its current YAML via `@coderabbitai configuration` and
   compare it with the committed file.

Exit criteria:

- At least one real PR receives a useful CodeRabbit review.
- No Autofix action runs.
- No new required check blocks merge.

### Phase 2 - Disable Bugbot externally

1. Disable Bugbot for `https://github.com/pdcarlson/Frapp` in the Cursor
   dashboard.
2. Confirm a new PR receives CodeRabbit review activity and no Bugbot review.
3. Keep a manual rollback note: re-enable Bugbot in Cursor if CodeRabbit fails
   to run on multiple PRs.

Exit criteria:

- CodeRabbit is the only active AI reviewer on a validation PR.

### Phase 3 - Remove stale Bugbot repo references

1. Delete Bugbot-specific rule files:
   - `.cursor/BUGBOT.md`
   - `apps/api/.cursor/BUGBOT.md`
   - `apps/web/.cursor/BUGBOT.md`
   - `apps/mobile/.cursor/BUGBOT.md`
   - `packages/.cursor/BUGBOT.md`
   - `.github/workflows/.cursor/BUGBOT.md`
   - `supabase/migrations/.cursor/BUGBOT.md`
2. Remove the `.gitignore` exception for root `.cursor/BUGBOT.md`.
3. Replace `docs/internal/BUGBOT_RUNBOOK.md` with
   `docs/internal/CODERABBIT_RUNBOOK.md`.
4. Update:
   - `CONTRIBUTING.md`
   - `spec/environments.md`
   - `docs/internal/AGENT_INFRA.md`
   - `docs/internal/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`
   - `docs/internal/PR_REVIEW_PROCESS.md`
   - `docs/internal/README.md`
   - `.cursor/skills/audit.md`
   - `.cursor/rules/audit.mdc`
5. Keep Cursor background-agent warnings somewhere durable if still useful; that
   warning is not Bugbot-specific and prevents accidental paid `@cursor` agent
   runs.

Exit criteria:

- `rg -i "bugbot|cursor review|bugbot run|BUGBOT.md"` returns only historical
  archive references or an intentional transition note.
- Docs describe CodeRabbit as the current review tool.

### Phase 4 - Observe and tune

1. Watch the next several PRs for:
   - missed reviews
   - duplicate reviews
   - noisy comments
   - rate-limit pauses
   - stale or contradictory learnings
2. Add learnings only for recurring review preferences.
3. Prefer checked-in `path_instructions` for durable rules and learnings for
   preferences that emerge from review discussion.
4. If native auto-review misses PRs, consider a minimal fallback workflow that
   comments `@coderabbitai review`, but do not add polling or required status
   checks.

Exit criteria:

- CodeRabbit reliably reviews PRs without merge-blocking noise.
- The review feedback is useful enough to keep `profile: "assertive"`.

## Branch protection policy

Do not make CodeRabbit a required status check in the first migration. Reasons:

- The current Bugbot policy is advisory.
- OSS rate limits can pause new reviews.
- Historical bot-gate workflows caused CI friction.
- Production already requires CI, `branch-policy`, one human approval, and
  conversation resolution.

Revisit only after observing stable CodeRabbit behavior. If later required,
capture CodeRabbit's exact emitted check name from a real PR before changing
`scripts/configure-branch-protection.mjs`.

## Verification checklist for the implementation PR

- [ ] `.coderabbit.yaml` validates against CodeRabbit's schema.
- [ ] CodeRabbit auto-reviews a PR to `main`.
- [ ] CodeRabbit auto-reviews or intentionally skips a draft PR according to
      the chosen config.
- [ ] CodeRabbit re-reviews after a push.
- [ ] CodeRabbit does not run Autofix.
- [ ] Bugbot is disabled externally.
- [ ] No stale Bugbot docs remain in active runbooks.
- [ ] `npm run configure:branch-protection -- --dry-run` shows no CodeRabbit or
      Bugbot required check.
- [ ] `node scripts/check-docs-impact.mjs --base origin/main --head HEAD`
      passes.

## Rollback plan

If CodeRabbit fails to review PRs reliably:

1. Re-enable Cursor Bugbot in the Cursor dashboard.
2. Revert the PR that removed `.cursor/BUGBOT.md` files and Bugbot runbook docs,
   or restore them from git history.
3. Leave `.coderabbit.yaml` disabled by setting
   `reviews.auto_review.enabled: false` until the failure is understood.
4. Do not add a required CodeRabbit check as a rollback shortcut.

## Decisions to make before implementation

- Should draft PRs be reviewed automatically, or only ready-for-review PRs?
- Should generated SDK artifacts be ignored or reviewed only for freshness?
- Should a `do-not-review` label be allowed, or does "every PR" mean no escape
  hatch?
- Should CodeRabbit's assertive profile stay on if early reviews are noisy?
- Can Autofix be disabled in the CodeRabbit UI or by support?
- Where should the non-Bugbot-specific Cursor background-agent warning live
  after `BUGBOT_RUNBOOK.md` is removed?
