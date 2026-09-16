# PR Review Process (Frapp)

## Why this exists

Large infrastructure PRs are hard to review, hard to debug, and can leave checks in ambiguous states. This process keeps PRs small, reviewable, and merge-safe.

## PR design rules

1. **One concern per PR**
   - Good: branch protection only, CI-only, deploy-only, docs-only.
   - Avoid: changing CI, CD, release automation, and docs in one PR.
2. **Prefer ≤ 400 changed lines**
   - If a PR exceeds this, split it unless there is a strong reason not to.
3. **Stable check names**
   - If workflow/job names change, update:
     - `scripts/ci/lib/required-checks.mjs` (the rosters; the applying script is
       `scripts/configure-branch-protection.mjs`)
     - `docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md` § Required Status Checks — the one
       doc that restates the roster, and since the docs gates were deleted, a copy **no check
       asserts**. It can only drift from the arrays, so update it in the same PR and treat the
       arrays as the answer whenever the two disagree.
   - Do not add a third place. A roster copy no gate watches is the one that drifts.
4. **No required workflow-level `paths` filters**
   - Required checks must always report a result on protected-branch PRs.
5. **A changed documented fact is updated where it lives**
   - No check requires a doc edit; the one that did was deleted in #1597 for producing filler. Most PRs alter no documented fact and need no doc change.
   - When one does, it goes in the doc that owns the fact — usually **`docs/`** (e.g. [`docs/guides/`](../../guides/README.md)) and/or **`spec/`** — never a stray file or an unrelated doc. Rationale: [`DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md).

## Reviewer workflow

1. **Author opens PR to `main`**
   - Run the local gate before opening: `npm run ci:local-gate`
   - If targeting a different base branch, use `npm run ci:local-gate -- --base-ref <ref>`.
   - Ensure the PR includes docs/spec changes that explain every non-doc code change.
   - Fill out `.github/pull_request_template.md` completely.
   - Include a rollback note for infra changes.
2. **Automation pass**
   - Required checks pass.
   - Code review happens before the push through the repository-managed
     [`.githooks/pre-push`](../../../.githooks/pre-push). The root `prepare` script installs it for
     agents and humans, and every pushed commit needs exact-SHA evidence. There is no CI Claude
     review or `claude-review-gate` check. Details:
     [`AI_CODE_REVIEW_RUNBOOK.md`](../ci-cd/AI_CODE_REVIEW_RUNBOOK.md).
3. **Human review pass** — a convention, **not a merge gate**. Branch protection sets
   `required_pull_request_reviews: null` and `required_conversation_resolution: false`. The local
   hook can also be deliberately bypassed with Git's `--no-verify`, a changed hooks path, or skipped
   installation, so a diff can still reach `main` without a review. Confirm live protection with
   `npm run configure:branch-protection:verify`; agents never apply it.
4. **Merge**
   - Feature work: squash merge into `main`.
   - Production: no PR. Dispatch **Deploy production** with the SHA you want live (#1340).

## CI/CD change rollout plan (replace a mega-PR like #20)

Use this order so each PR has a single failure domain:

1. **PR A — Branch protection + runbook only**
   - `scripts/configure-branch-protection.mjs`
   - `docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`
2. **PR B — CI workflow only**
   - `.github/workflows/ci.yml`
3. **PR C — Docs workflow/check behavior only**
   - `.github/workflows/docs.yml`
4. **PR D — Deploy workflow only**
   - `.github/workflows/deploy-api.yml`
5. **PR E — Release workflow only**
   - `.github/workflows/release.yml`
6. **PR F — Contributor/spec docs follow-up**
   - `CONTRIBUTING.md`, `spec/environments/README.md`, related runbooks

Each PR should merge before opening the next one, unless you explicitly need stacked PRs.

## "Hanging checks" quick triage

If a required check is stuck on `Expected — Waiting for status to be reported`:

1. Compare required checks vs reported checks:
   - `gh api repos/pdcarlson/Frapp/branches/main/protection`
   - `gh pr checks <PR_NUMBER>`
2. If a required workflow did not run, remove workflow-level `paths` filters.
3. If check names changed, update branch protection config and re-apply it.
4. If external providers (e.g. Vercel) are stuck, use emergency override, merge, then immediately restore protections.
