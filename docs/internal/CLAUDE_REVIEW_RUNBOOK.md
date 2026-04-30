# Claude Review Runbook

## Goal

Pull requests targeting `main` and `production` get an AI review from `anthropics/claude-code-action@v1` on **every push**, including drafts. Reviews are advisory — they do not gate merges.

## Review policy in this repo

- Findings are advisory everywhere. Address them if useful; ignore if not.
- Promotion to `production` is already gated by branch protection (CI checks + the `branch-policy` check + approval + conversation resolution). The Claude review layered on top is intentionally not a required status check.
- The action is configured to focus on **real bugs** (logic errors, security, RLS, contract drift, migration safety, race conditions, leaks). It is told to skip style, naming, and anything CI already enforces.

## How the review is configured

### GitHub workflow

- File: [`.github/workflows/claude-review.yml`](../../.github/workflows/claude-review.yml)
- Action: `anthropics/claude-code-action@v1`
- Auth: GitHub repo secret `CLAUDE_CODE_OAUTH_TOKEN`
- Trigger: `pull_request` events `opened`, `synchronize`, `reopened`, `ready_for_review` against branches `main` and `production`
- **Drafts are NOT skipped** — every push runs a review regardless of draft status
- Concurrency group is keyed by PR number with `cancel-in-progress: true`, so pushing a new commit cancels an in-flight review on the same PR (a partial run may leave a partial set of inline comments behind; the next push's review will overwrite them)
- Permissions: `contents: read`, `pull-requests: write`, `id-token: write`. The action uses GitHub's OIDC to authenticate to Anthropic's backend even when you're using a `CLAUDE_CODE_OAUTH_TOKEN` — without `id-token: write` the very first step fails with `Could not fetch an OIDC token. Did you remember to add id-token: write to your workflow permissions?`
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

Anthropic's action reads the `CLAUDE.md` in every directory it touches. Add or refine rules in the directory closest to the code they govern.

## Triggering reviews

### Automatic

The action auto-runs on every `opened`, `synchronize`, `reopened`, and `ready_for_review` event for PRs targeting `main` and `production`. This means every push fires a review (drafts included). Pushing a new commit while a review is in flight will cancel the older run via the concurrency group.

### Manually re-run

Three ways to re-trigger a review without changing code:

1. **Re-run from the Actions tab.** GitHub → Actions → "Claude Review" → pick the PR's run → "Re-run all jobs". This re-runs the workflow against the same commit SHA.
2. **Close and re-open the PR.** Triggers the `reopened` event.
3. **Push a no-op commit** (e.g. `git commit --allow-empty -m "retrigger review"` then push). Triggers `synchronize`.

> The action does **not** listen for `@claude` mentions in PR comments — that requires an `issue_comment` workflow trigger we have not added. If we ever want comment-based mentions, add an `issue_comment: { types: [created] }` trigger and a separate job with an `if:` checking `contains(github.event.comment.body, '@claude')`.

### Disable per-PR

Add the label `skip-claude-review` to the PR. The job's `if:` condition skips when this label is present:

```yaml
if: ${{ !contains(github.event.pull_request.labels.*.name, 'skip-claude-review') }}
```

The label must be applied **before** the next push (the workflow only checks labels at trigger time). Removing the label and pushing again will re-enable the review.

## Debugging

When a review behaves unexpectedly:

1. **GitHub Actions tab → Claude Review run** for the PR. Inspect the step logs for the `anthropics/claude-code-action@v1` step — it prints model invocation summaries and any tool errors.
2. Check that `CLAUDE_CODE_OAUTH_TOKEN` is still valid in repo settings → Secrets and variables → Actions.
3. Confirm the PR base branch is `main` or `production` and the workflow is enabled. (Drafts are reviewed; that is no longer a skip reason.)
4. If runs queue but never start, check the `concurrency` group for stuck cancelled-but-not-completed runs. A subsequent push will create a fresh run and supersede the stuck one.
5. If output quality is poor or off-topic, refine the closest `CLAUDE.md` (root vs. nested) — the action prioritizes those rules over its priors.
6. If the action complains about too many turns, raise `--max-turns` in `claude_args:` (currently 12).

## Switching to a different reviewer

If the team ever wants to swap to a different AI reviewer (or none at all):

1. Disable or delete `.github/workflows/claude-review.yml`.
2. Update `CONTRIBUTING.md`, `spec/environments.md`, and `docs/internal/AGENT_INFRA.md` to reflect the new state.
3. Update branch-protection expectations in `docs/internal/GITHUB_BRANCH_PROTECTION_RUNBOOK.md` if the new reviewer needs to be a required status check (this one is not).
4. The hierarchical `CLAUDE.md` files remain useful for any reviewer that reads project rules from the tree, including future versions of this action.
