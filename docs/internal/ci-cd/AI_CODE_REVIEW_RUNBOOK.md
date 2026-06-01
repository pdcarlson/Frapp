# AI Code Review Runbook

How Frapp's automated PR review works after the move off CodeRabbit (see ADR-14 in
`spec/architecture/README.md`). Reviews are **advisory** — comment-only, never a required check.

## What runs

A GitHub Actions workflow, `.github/workflows/claude-review.yml`, runs
[`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action) on pull
requests and posts findings as **inline review comments** (via the action's
`github_inline_comment` MCP tool) plus a short summary comment. It does a **unified security +
general** pass — there is no separate security job.

- **Auth:** a Claude Pro/Max **subscription OAuth token**, not a pay-per-token API key. Review usage
  draws on the subscription's quota; there is no separate Anthropic API invoice.
- **Model:** Opus 4.8 (`--model claude-opus-4-8`).
- **Trigger:** PR `opened`, `reopened`, or `ready_for_review`. `synchronize` (per-push re-review) is
  intentionally **off** to bound quota/minute cost.
- **Gating:** comment-only. Promotion to `production` remains gated by branch protection (CI +
  `branch-policy` + one approving review + conversation resolution) — the reviewer never blocks merge.
- **Trusted PRs only:** the job skips draft PRs and fork PRs (`if:` guard). The action runs with
  `pull-requests: write` and is not hardened against prompt injection, so only self-authored
  (same-repo) PRs are reviewed.

## One-time setup (required)

1. **Add the OAuth token secret.** Locally run `claude setup-token` (Pro/Max), then add the output
   as repo secret **`CLAUDE_CODE_OAUTH_TOKEN`** under Settings → Secrets and variables → Actions.
   The job no-ops/fails closed without it.
2. **Remove CodeRabbit.** Uninstall the CodeRabbit GitHub App (Settings → GitHub Apps). The
   `.coderabbit.yaml` config has been deleted from the repo.
3. *(Optional)* Install the [Claude GitHub App](https://github.com/apps/claude) for nicer comment
   attribution. The default `GITHUB_TOKEN` is sufficient for comment-only review without it.

## Tuning what gets flagged

- **Rubric:** `.github/claude-review/review-guidelines.md` — the Frapp-specific review rules
  (auth-guard chain, permission decorators, migration RLS, per-path rules, false-positive guards).
  Ported from the old `.coderabbit.yaml` path instructions. Edit it to change review focus.
- **Model / cost:** to cut quota and Actions-minute burn, change `--model claude-opus-4-8` to
  `claude-sonnet-4-6` in the workflow.
- **Per-push reviews:** add `synchronize` to the `on.pull_request.types` list (more thorough, more
  cost).
- **Scope:** add a `paths:` filter under the `pull_request` trigger to skip doc-only / non-code PRs.

## Triggering & re-running

- Reviews run automatically on PR open / reopen / ready-for-review.
- To force a fresh review without `synchronize`, **close and reopen** the PR (or temporarily enable
  `synchronize`).
- A failed/timed-out run never blocks the PR. Re-run it from the Actions tab or by reopening.

## Cost & quota notes

- The reviewer consumes **metered GitHub Actions minutes** (private repo on Pro = 3,000 min/month;
  see ADR-13) — this stacks on the existing CI suite, so it interacts with the deferred CI-cost audit.
- It also consumes **Claude Max subscription quota**. Opus burns quota fastest; heavy PR bursts can
  throttle interactive Claude usage. Concurrency auto-cancel is enabled to avoid stacking runs.

## Supply-chain note

`anthropics/claude-code-action@v1` is a first-party Anthropic action pinned to the `v1` major tag
(receives security patches). For stricter control, pin it to a specific release commit SHA and bump
deliberately.

## Cursor background-agent warning

Do not type `@cursor` or `@cursoragent` in a PR comment unless you explicitly want to spawn a paid
Cursor background agent. That is separate from this review workflow and can start an agent run
against the PR branch.

## Troubleshooting

### Review didn't run

1. Confirm the **`CLAUDE_CODE_OAUTH_TOKEN`** secret exists and is valid (re-run `claude setup-token`
   if it expired).
2. Confirm the PR is **not a draft** and is **not from a fork** (the `if:` guard skips both).
3. Check the **Claude Review** workflow run in the Actions tab for errors.

### Review is too noisy

1. Tighten or add a false-positive note in `.github/claude-review/review-guidelines.md`.
2. Downgrade the model to `claude-sonnet-4-6` (often less verbose) in the workflow.

### A stale review check is blocking merge

This workflow is comment-only and should **not** be a required check. If GitHub shows an expected
`Claude Review` context blocking merge, remove it from branch protection and re-run
`npm run configure:branch-protection` to restore the documented required checks.
