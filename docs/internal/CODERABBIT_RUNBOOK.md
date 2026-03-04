# CodeRabbit Review Runbook

## Goal

Ensure pull requests targeting `preview` and `main` always receive a CodeRabbit review request.

## Configuration in this repo

1. **Repository config**: `.coderabbit.yaml`
   - Enables auto-review.
   - Sets `base_branches` to:
     - `preview`
     - `main`

2. **Workflow fallback trigger**: `.github/workflows/trigger-coderabbit-review.yml`
   - Runs on `pull_request_target` for `preview` and `main`.
   - Auto-comments `@coderabbitai review` on:
     - opened
     - reopened
     - ready_for_review
   - This forces a review request even when CodeRabbit auto-review settings in UI are restrictive.

## If reviews are still skipped

1. Verify CodeRabbit GitHub App is installed and active for this repository.
2. Verify CodeRabbit UI repository settings:
   - Auto review enabled.
   - Base branch settings include `preview` / `main` if required by plan.
3. Check workflow run status:
   - `Trigger CodeRabbit Review` should succeed and post the review command comment.
4. Manually comment on PR:
   - `@coderabbitai review`

## Future-agent policy

- Keep `.coderabbit.yaml` and this runbook in sync.
- If default branches or promotion flow changes, update:
  - `.coderabbit.yaml`
  - `trigger-coderabbit-review.yml`
  - `AGENTS.md` policy section
