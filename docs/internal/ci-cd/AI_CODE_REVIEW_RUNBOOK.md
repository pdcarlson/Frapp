# AI Code Review Runbook

How Frapp's automated PR review works after the move off CodeRabbit (see ADR-14 in
`spec/architecture/README.md`).

## What runs

`.github/workflows/claude-review.yml` runs
[`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action) on pull
requests to `main`/`production` and posts findings as **inline review comments** plus a summary. It
does a **unified security + general** pass in **two tiers**:

| Event | Model | Depth |
| ----- | ----- | ----- |
| PR `opened` / `reopened` / `ready_for_review` | **Opus 4.8** | full PR diff, in depth |
| PR `synchronize` (each push) | **Sonnet 4.6** | incremental — newest commits |

- **Auth:** a Claude Pro/Max **subscription OAuth token** (`CLAUDE_CODE_OAUTH_TOKEN`), not a
  pay-per-token API key. Review usage draws on the subscription's quota.
- **Two jobs:** `claude-review` (posts comments; may be skipped/flaky) and **`claude-review-gate`**
  (the required check — see below).

## Merge gate (blocking on Important only)

The reviewer tags each finding **Important** or **Nit**. The `claude-review-gate` job blocks merge
**only when there is ≥1 Important finding**:

- It reads the review's `--json-schema` `structured_output` (`important_count`), falling back to the
  `<!-- claude-review-verdict: important=N -->` marker in the summary comment.
- It **always reports a conclusion**, so the required check never hangs "pending". It **passes** when:
  the review was skipped (draft / fork / `claude[bot]` commit / missing secret), the review job
  failed, no verdict was produced, or `important = 0`.
- **Bypass a false positive:** add the **`claude-review-override`** label to the PR. The gate passes
  immediately (works even with `enforce_admins: true`, which otherwise blocks admin bypass).

This decoupling avoids `claude-code-action`'s known failure modes — permanent-red required checks on
bot-triggered runs ([#1299](https://github.com/anthropics/claude-code-action/issues/1299)) and
spurious non-zero exits ([#846](https://github.com/anthropics/claude-code-action/issues/846)).

## One-time setup (required)

1. **Add the OAuth token secret.** Locally run `claude setup-token` (Pro/Max), then add the output as
   repo secret **`CLAUDE_CODE_OAUTH_TOKEN`** under Settings → Secrets and variables → Actions. Without
   it the review skips and the gate passes (advisory).
2. **Remove CodeRabbit.** Uninstall the CodeRabbit GitHub App (Settings → GitHub Apps).
3. *(Optional)* Install the [Claude GitHub App](https://github.com/apps/claude) for nicer comment
   attribution; the default `GITHUB_TOKEN` is sufficient otherwise.

## Making the gate a required check — ORDER MATTERS

Branch protection uses `strict: true` + `enforce_admins: true`, so a required check that is missing or
red blocks **all** merges. Roll out in this order:

1. Merge the workflow to the target branch (`main`) — the gate runs but is **not yet required**.
2. Verify on a real PR that `claude-review-gate` reports **green**.
3. **Then** run `npm run configure:branch-protection` to add `claude-review-gate`
   (already listed in `scripts/configure-branch-protection.mjs`) as a required context.

## Tuning what gets flagged

- **Rubric:** `.github/claude-review/review-guidelines.md` — broad, stable rules (auth-guard chain,
  migration RLS, per-path rules, false-positive guards).
- **Learnings:** `.github/claude-review/learnings.md` — narrow, dated lessons from real PRs, read on
  every run. Add an entry when the bot is wrong (false positive) or misses something a human caught.
  This is the curated "memory" (the equivalent of CodeRabbit learnings / BugBot learned rules);
  `claude-code-action` has no automatic cross-run learning.
- **Model / cost:** the per-event models are set in the `Select model by event` step. Drop
  `synchronize` from the trigger `types`, or add a `paths:` filter, to cut quota/minute spend.

## Triggering & re-running

- Runs automatically on open / reopen / ready-for-review (Opus) and each push (Sonnet).
- Force a fresh full review: close and reopen the PR.
- A failed/timed-out review run never blocks (the gate fails open); re-run from the Actions tab.

## Cost & quota notes

- Reviewing **every push** (Sonnet) + every open (Opus) consumes **metered Actions minutes** (Pro =
  3,000/mo; ADR-13) and **Max subscription quota** (Opus heaviest). Concurrency auto-cancel is on.
- The `claude-review-gate` job itself is near-instant (seconds).

## Supply-chain note

`anthropics/claude-code-action@v1` is a first-party Anthropic action pinned to the `v1` major tag.
For stricter control, pin it to a specific release commit SHA and bump deliberately.

## Cursor background-agent warning

Do not type `@cursor` or `@cursoragent` in a PR comment unless you explicitly want to spawn a paid
Cursor background agent. That is separate from this review workflow.

## Troubleshooting

### Review didn't run
1. Confirm **`CLAUDE_CODE_OAUTH_TOKEN`** exists and is valid (re-run `claude setup-token` if expired).
2. Confirm the PR is **not a draft**, **not from a fork**, and the triggering commit isn't `claude[bot]`'s.
3. Check the **Claude Review** workflow run in the Actions tab.

### The gate is blocking a false positive
- Add the **`claude-review-override`** label (gate passes immediately), **and** add a rule to
  `.github/claude-review/learnings.md` so the reviewer stops flagging it.

### The gate is stuck "Expected — waiting for status"
- The gate job always reports, so this usually means it was made a required check **before** the
  workflow was merged to that branch. Merge the workflow first, then require the check.
