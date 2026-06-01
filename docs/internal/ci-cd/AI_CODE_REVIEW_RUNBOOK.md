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

The reviewer tags each finding **Important** or **Nit**. The `claude-review-gate` job — decision logic
in `scripts/ci/evaluate-review-gate.mjs`, **unit-tested** by the `ci-scripts-tests` job — **blocks
merge** when *either* there is ≥1 **Important** finding **or** a review was *expected* but **did not
complete** (no fresh verdict for the current head SHA):

- It reads the review's `--json-schema` `structured_output` (`important_count`), falling back to a
  **SHA-scoped** `<!-- claude-review-verdict: sha=<head_sha> important=N -->` marker in the summary
  comment. The SHA scoping means a *previous* commit's verdict can't satisfy the gate for a new commit.
- It **always reports a conclusion** (never hangs "pending"). It **passes** when: the review was
  intentionally skipped (draft / fork / `claude[bot]` commit / **missing token**); there is a fresh
  verdict with `important = 0`; or the `claude-review-override` label is present. A fresh verdict is
  trusted **even if the action process exits non-zero** (a completed-but-crashed review still counts).
- It **blocks** when a review was expected (token present; not draft/fork/bot) but produced **no fresh
  verdict** — the action errored, timed out, or hit the workflow-validation guard (see *Making the gate
  required*). Deliberate (ADR-14 amendment): a required review must actually run. **Re-run it, or add
  `claude-review-override`.**
- **Bypass:** the **`claude-review-override`** label passes the gate immediately (works even with
  `enforce_admins: true`).

The gate stays decoupled from `claude-code-action`'s exit code — avoiding its permanent-red required
check on bot runs ([#1299](https://github.com/anthropics/claude-code-action/issues/1299)) and spurious
non-zero exits ([#846](https://github.com/anthropics/claude-code-action/issues/846)) — but unlike the
original fail-open design, a review that produces **nothing** now blocks rather than silently passing.

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

> **Caveat — a PR that edits `claude-review.yml` itself can't be reviewed.** `claude-code-action`'s
> OIDC→app-token exchange requires the workflow file to be **identical to the version on the default
> branch** (anti-tampering). A PR modifying `claude-review.yml` gets no token → no review → no fresh
> verdict → **the gate blocks it** (fail-closed by design: changing the review process needs explicit
> sign-off). Merge such changes with `claude-review-override`, or land them *before* the gate is
> required. Edits to the rubric/learnings markdown are fine — they're read at runtime, not validated.

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
- A review that fails **without producing a fresh verdict now blocks** (the gate requires a real
  review for the current commit); re-run from the Actions tab, or add `claude-review-override`.

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
4. If the PR **edits `.github/workflows/claude-review.yml`**, the action's anti-tampering check
   ("Workflow validation failed … must be identical to the default branch") fails until the change is
   on the default branch — expected; the gate blocks (override, or merge the workflow change first).

### The gate is blocking a false positive
- Add the **`claude-review-override`** label (gate passes immediately), **and** add a rule to
  `.github/claude-review/learnings.md` so the reviewer stops flagging it.

### The gate is stuck "Expected — waiting for status"
- The gate job always reports, so this usually means it was made a required check **before** the
  workflow was merged to that branch. Merge the workflow first, then require the check.
