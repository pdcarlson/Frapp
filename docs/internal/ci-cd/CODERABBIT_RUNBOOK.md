# CodeRabbit Review Runbook

## Goal

Pull requests targeting `main` and `production` get an AI review from
CodeRabbit. Reviews are **advisory on both branches**; CodeRabbit is not a
required status check and does not gate merges.

## Review policy in this repo

- CodeRabbit findings are advisory everywhere. Address them when useful; ignore
  or resolve them when they are not applicable.
- No GitHub Actions workflow wraps CodeRabbit. Native auto-review handles PRs
  directly through the CodeRabbit GitHub App.
- Promotion to `production` remains gated by branch protection: CI checks,
  `branch-policy`, one approving review, and conversation resolution.
- Do not add CodeRabbit as a required check until it has been observed across
  several PRs and its exact emitted check name is captured from GitHub.

## How CodeRabbit is configured

### CodeRabbit app and dashboard

Verify in the CodeRabbit dashboard:

1. The CodeRabbit GitHub App is installed for `https://github.com/pdcarlson/Frapp`.
2. The repository is recognized as a **private** repository (Frapp went public → private on 2026-05-31). On a private repo, CodeRabbit's **Free** plan posts high-level summaries + walkthroughs only; the full line-by-line (assertive) reviews configured in `.coderabbit.yaml` require **CodeRabbit Pro** (paid). Decide whether to upgrade or accept summary-only reviews, and confirm plan/seat coverage for `pdcarlson/Frapp`.
3. Native auto-review is enabled.
4. Learnings are enabled and scoped to this repository.
5. Autofix is disabled in repository or organization settings if CodeRabbit
   exposes that control. If no hard-disable exists, maintain the operational
   rule below.

### Repo-tracked config

CodeRabbit reads `.coderabbit.yaml` from the pull request branch. This repo uses
that file for:

- assertive review profile
- automatic review for every base branch
- draft PR reviews
- incremental review on every push
- no auto-pause after reviewed commits
- advisory review mode (`request_changes_workflow: false`,
  `review_status: false`)
- path-scoped review instructions for API, web, mobile, shared packages,
  workflows, and Supabase migrations
- repository-local learnings
- CodeRabbit code-guideline auto-detection for `AGENTS.md` and `.cursor/rules/*`

## Triggering reviews

### Automatic

CodeRabbit should review PRs automatically when they are opened, marked ready for
review, or updated with new commits. The committed config uses:

- `reviews.auto_review.enabled: true`
- `reviews.auto_review.base_branches: [".*"]`
- `reviews.auto_review.drafts: true`
- `reviews.auto_review.auto_incremental_review: true`
- `reviews.auto_review.auto_pause_after_reviewed_commits: 0`

The repo does not define skip labels or skip-title keywords. CodeRabbit should
review every PR branch target covered by the app installation.

### Manual trigger

If CodeRabbit does not auto-run, post a top-level PR comment:

```text
@coderabbitai review
```

For a complete fresh review:

```text
@coderabbitai full review
```

## Autofix policy

Do **not** run CodeRabbit Autofix in this repo unless the maintainer explicitly
asks for it on that PR.

Avoid:

- `@coderabbitai autofix`
- `@coderabbitai autofix stacked pr`
- Autofix checkboxes in CodeRabbit review comments

Current CodeRabbit docs describe Autofix as manually triggered. No committed
`.coderabbit.yaml` hard-disable is documented, so the dashboard/support setting
should be checked periodically if a hard-disable is required.

## Teaching CodeRabbit

Use learnings for recurring preferences that emerge during review. Prefer
checked-in `.coderabbit.yaml` path instructions for durable standards.

Good learning comments explain the reason, not just the instruction:

```text
@coderabbitai We intentionally keep user IDs out of error messages because logs
are shipped to third-party monitoring. Track user context through tracing
instead.
```

Review and prune learnings periodically in the CodeRabbit dashboard so stale or
contradictory preferences do not accumulate.

## Cursor background-agent warning

Do not type `@cursor` or `@cursoragent` in a PR comment unless you explicitly
want to spawn a paid Cursor background agent. That is separate from CodeRabbit
review and can start an agent run against the PR branch.

## Troubleshooting

### "CodeRabbit did not review my PR"

1. Confirm the CodeRabbit GitHub App is installed for this repository.
2. Confirm `.coderabbit.yaml` exists on the PR branch.
3. Post `@coderabbitai review` as a top-level PR comment.
4. Check the CodeRabbit dashboard for quota, repository enablement, or app
   installation errors.

### "CodeRabbit is noisy"

1. Confirm whether the finding is covered by `.coderabbit.yaml`,
   `AGENTS.md`, `.cursor/rules/*`, or a learning.
2. If the rule is durable, update `.coderabbit.yaml`.
3. If the preference is contextual, teach CodeRabbit with a learning.
4. If reviews stay too noisy, consider changing `reviews.profile` from
   `assertive` to `chill`.

### "CodeRabbit is rate-limited"

OSS review capacity is rate-limited by CodeRabbit. If a PR is delayed:

1. Leave the review advisory; do not block merge solely on CodeRabbit.
2. Use human review and required CI as the merge gates.
3. Re-run with `@coderabbitai review` after quota refills if AI review is still
   useful.

### "A stale CodeRabbit check is blocking merge"

CodeRabbit should not be required in branch protection. If GitHub shows an
expected CodeRabbit context:

1. Inspect branch protection for the target branch.
2. Remove the stale CodeRabbit context from branch protection.
3. Re-run `npm run configure:branch-protection` to restore the documented
   required checks.
