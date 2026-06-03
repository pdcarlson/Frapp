# AI Code Review Runbook

How Frapp's automated PR review works after the move off CodeRabbit (see ADR-14 in
`spec/architecture/README.md`).

## What runs

`.github/workflows/claude-review.yml` runs
[`anthropics/claude-code-action@v1`](https://github.com/anthropics/claude-code-action) on pull
requests to `main`/`production` and posts findings as **inline review comments** plus a summary. It
does a single **unified security + general** pass with **Opus 4.8**:

| When it runs | Model | Depth |
| ------------ | ----- | ----- |
| PR `opened` / `reopened` / `ready_for_review` (once) **or** an `@claude review` comment (on demand) | **Opus 4.8** | full PR diff, in depth |

It deliberately **does not run on push** (`synchronize` is not a trigger) — pushing fixes is free, so
there is no per-push review loop draining Actions minutes or subscription quota. Re-review the latest
commit on demand by commenting `@claude review` (see *Triggering & re-running*).

- **Auth:** a Claude Pro/Max **subscription OAuth token** (`CLAUDE_CODE_OAUTH_TOKEN`), not a
  pay-per-token API key. Review usage draws on the subscription's quota.
- **Three jobs:** `claude-review-context` (resolves the PR number + head SHA + override label uniformly
  across the `pull_request` and `issue_comment` event shapes), `claude-review` (posts comments; may be
  skipped/flaky), and the gate — job named **`claude-review-gate-runner`** — which publishes the
  required **`claude-review-gate`** commit status (see below).

## Merge gate (blocking on Important only)

The reviewer tags each finding **Important** or **Nit**. The gate — decision logic in
`scripts/ci/evaluate-review-gate.mjs`, **unit-tested** by the `ci-scripts-tests` job — **blocks merge**
when *either* there is ≥1 **Important** finding **or** a review was *expected* but **did not complete**
(no fresh verdict for the current head SHA):

> **The gate is published as a commit status, not a check-run.** Because an `@claude review` comment
> fires an `issue_comment` event whose *implicit* job check-run attaches to the **default-branch head**
> (not the PR head), the gate job (`claude-review-gate-runner`) instead **posts an explicit
> `claude-review-gate` commit status to the resolved PR head SHA** via the statuses API. That keys the
> required check to the exact commit branch protection cares about, for both event types. The job is
> *not* named `claude-review-gate` on purpose: a same-named check-run **and** status would make GitHub
> require both ([about status checks](https://docs.github.com/articles/about-status-checks)).

- It reads the review's `--json-schema` `structured_output` (`important_count`), falling back to a
  **SHA-scoped** `<!-- claude-review-verdict: sha=<head_sha> important=N -->` marker in the summary
  comment. The SHA scoping means a *previous* commit's verdict can't satisfy the gate for a new commit.
- It **passes** when: the review was intentionally skipped (the `context` job filters draft /
  `claude[bot]` runs, and the no-token case passes advisory); there is a fresh verdict with
  `important = 0`; or the `claude-review-override` label is present. A fresh verdict is trusted **even if
  the action process exits non-zero** (a completed-but-crashed review still counts).
- **Fork PRs are not auto-reviewed** (trusted-PRs-only, ADR-14): the `pull_request` path never starts on
  a fork (no status → "Expected"), and an on-demand `@claude review` on a fork posts a **blocking** gate
  status (the review was skipped, so nothing was reviewed). Merge a trusted fork with
  `claude-review-override`.
- It **blocks** when a review was expected (not an intentional skip / no-token) but produced **no fresh
  verdict** — the action errored, timed out, **was cancelled** (e.g. concurrency superseded it), or hit
  the workflow-validation guard (see *Making the gate required*). Deliberate (ADR-14 amendment): a
  required review must actually run. **Re-run it, or add `claude-review-override`.**
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
- **Model / cost:** the model is hard-coded to Opus 4.8 in the review job's `claude_args`. The review
  runs once on open + on demand (not on push); add a `paths:` filter to the `pull_request` trigger to
  cut spend further if needed.

## Triggering & re-running

- Runs automatically **once** on open / reopen / ready-for-review (Opus).
- **Pushing new commits does NOT trigger a review** — fix freely. But the new head SHA then has no
  `claude-review-gate` status, so branch protection shows **"Expected"** and merge is blocked until you
  get a fresh verdict on the final commit.
- **Re-review on demand:** comment **`@claude review`** on the PR. This runs a fresh full Opus review
  against the current head and posts a new gate status to it. Closing/reopening the PR also forces a
  fresh review.
- **Who can trigger `@claude review`:** only repo collaborators — the comment trigger requires the
  commenter's `author_association` to be `OWNER`, `MEMBER`, or `COLLABORATOR`. This is a security
  control: `issue_comment` runs with base-repo secrets, so an untrusted commenter must not be able to
  spend the `CLAUDE_CODE_OAUTH_TOKEN`. `claude[bot]`'s own comments are ignored (anti-loop).
- A review that fails **without producing a fresh verdict blocks** (the gate requires a real review for
  the current commit); re-run with `@claude review`, or add `claude-review-override`.

## Cost & quota notes

- The review runs only on **open + each `@claude review`** (never on push), so it consumes far fewer
  **metered Actions minutes** (Pro = 3,000/mo; ADR-13) and far less **subscription quota** than the
  previous per-push Sonnet pass. Concurrency auto-cancel is on.
- The `claude-review-context` and gate jobs are near-instant (seconds) — they run on every triggering
  event (including a bare `claude-review-override` label add, which re-posts a green gate status).

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

### The gate shows "Expected — waiting for status"
- **Normal after a push:** the review does not run on push, so a freshly pushed commit has no
  `claude-review-gate` status yet. Comment `@claude review` to get a fresh verdict (or add
  `claude-review-override`) to clear it.
- Otherwise this usually means the check was made required **before** the workflow was merged to that
  branch. Merge the workflow first, then require the check.
