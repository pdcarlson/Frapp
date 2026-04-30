# Claude Review Runbook

## Goal

Pull requests targeting `main` and `production` get an AI review from `anthropics/claude-code-action@v1`. Reviews are **advisory on both branches** — the action does not gate merges.

## Review policy in this repo

- Findings are advisory everywhere. Address them if useful; ignore if not.
- Promotion to `production` is already gated by branch protection (CI checks + the `branch-policy` check + approval + conversation resolution). The Claude review layered on top is not a required status check.
- The action is configured to focus on **real bugs** (logic errors, security, RLS, contract drift, migration safety, race conditions, leaks). It is told to skip style, naming, and anything CI already enforces.

## How the review is configured

### GitHub workflow

- File: [`.github/workflows/claude-review.yml`](../../.github/workflows/claude-review.yml)
- Action: `anthropics/claude-code-action@v1`
- Auth: GitHub repo secret `CLAUDE_CODE_OAUTH_TOKEN` (already added)
- Trigger: `pull_request` events `opened`, `synchronize`, `ready_for_review` against branches `main` and `production`
- Skips drafts (`if: github.event.pull_request.draft == false`)
- Concurrency group is keyed by PR number with `cancel-in-progress: true`, so pushing a new commit cancels an in-flight review on the same PR
- Model: `claude-opus-4-7`, capped at `--max-turns 12`

### Repo-tracked rules

The action reads project rules from the hierarchical `CLAUDE.md` files. This repo uses:

- `CLAUDE.md` — root, repo-wide review expectations + operating guide
- `apps/api/CLAUDE.md`
- `apps/web/CLAUDE.md`
- `apps/mobile/CLAUDE.md`
- `packages/CLAUDE.md`
- `.github/workflows/CLAUDE.md`
- `supabase/migrations/CLAUDE.md`

Anthropic's action merges these by reading the `CLAUDE.md` in every directory it touches. Add or refine rules in the directory closest to the code they govern.

## Triggering reviews

### Automatic

The action auto-runs on every `opened`, `synchronize`, and `ready_for_review` event for PRs targeting `main` and `production`. Push a new commit to re-trigger — the previous run will be cancelled by the concurrency group.

### Manual trigger / re-review

- **Push** a new commit (any change, including a no-op trailing whitespace) to retrigger the workflow on a `synchronize` event.
- **Comment** `@claude review this PR` (or any natural-language ask that mentions `@claude`) on the PR. The action listens for `@claude` mentions.

### Disable per-PR

- Add the label `skip-claude-review` to the PR before opening, **or**
- Convert the PR to a **draft** (the workflow skips drafts via `if: github.event.pull_request.draft == false`).

> The `skip-claude-review` label is enforced only if you wire it into the workflow's `if:`. If the team starts using this label often, update `claude-review.yml` to short-circuit when it's present.

## Debugging

When a review behaves unexpectedly:

1. **GitHub Actions tab → Claude Review run** for the PR. Inspect the step logs for the `anthropics/claude-code-action@v1` step — it prints model invocation summaries and any tool errors.
2. Check that `CLAUDE_CODE_OAUTH_TOKEN` is still valid in repo settings → Secrets and variables → Actions.
3. Confirm the PR is not draft, the base branch is `main` or `production`, and the workflow is enabled.
4. If runs queue but never start, check the `concurrency` group for stuck cancelled-but-not-completed runs.
5. If output quality is poor, refine the closest `CLAUDE.md` (root vs. nested) — the action prioritizes those rules over its priors.

## Restoring a different reviewer

If you ever want to switch back to Cursor Bugbot or another AI reviewer:

1. Disable or delete `.github/workflows/claude-review.yml`.
2. Re-enable the integration in the new tool's dashboard (e.g. Cursor Bugbot at https://cursor.com/dashboard/bugbot).
3. Re-add or restore the directory-local rule files the new tool expects (`.cursor/BUGBOT.md` files for Cursor).
4. Update `CONTRIBUTING.md` and `docs/internal/AGENT_INFRA.md` to point at the new reviewer.
5. Update branch-protection expectations in `docs/internal/GITHUB_BRANCH_PROTECTION_RUNBOOK.md` if the new reviewer needs to be a required status check.

## History

- **April 2026:** migrated from Cursor Bugbot to `anthropics/claude-code-action@v1`. The previous `BUGBOT_RUNBOOK.md` is the renamed predecessor of this file.
- **Earlier:** an older `trigger-bugbot-review.yml` polling workflow was removed because it hung CI for ~10 minutes per PR synchronize event without reliably matching Bugbot output. Do not re-add that pattern.
