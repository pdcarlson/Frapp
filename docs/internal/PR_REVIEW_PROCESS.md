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
     - `scripts/configure-branch-protection.mjs`
     - `docs/internal/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`
     - `CONTRIBUTING.md`
4. **No required workflow-level `paths` filters**
   - Required checks must always report a result on protected-branch PRs.
5. **Docs/spec delta is mandatory for every non-doc change**
   - Any PR that changes files outside `docs/` or `spec/` must also touch at least one path under those prefixes in the same PR (usually **`docs/`** — e.g. [`docs/guides/`](../guides/README.md) — and/or **`spec/`**).
   - This is enforced by `scripts/check-docs-impact.mjs` in the Docs workflow and local CI gate. Rationale: [`DOCS_CI.md`](./DOCS_CI.md).
   - No local bypass is allowed for this check.

## Reviewer workflow

1. **Author opens PR to `main`**
   - Run the local gate before opening: `npm run ci:local-gate`
   - If targeting a different base branch, use `npm run ci:local-gate -- --base-ref origin/production`.
   - Ensure the PR includes docs/spec changes that explain every non-doc code change.
   - Fill out `.github/pull_request_template.md` completely.
   - Include a rollback note for infra changes.
2. **Automation pass**
   - Required checks pass.
   - Bugbot auto-reviews the PR once it is marked ready. Findings are advisory on both `main` and `production` — Bugbot does not gate merges.
3. **Human review pass**
   - At least one approval from a write-access reviewer.
   - All review threads resolved.
4. **Merge**
   - Feature work: squash merge into `main`.
   - Promotion: merge `main` into `production` via dedicated PR.

## CI/CD change rollout plan (replace a mega-PR like #20)

Use this order so each PR has a single failure domain:

1. **PR A — Branch protection + runbook only**
   - `scripts/configure-branch-protection.mjs`
   - `docs/internal/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`
2. **PR B — CI workflow only**
   - `.github/workflows/ci.yml`
3. **PR C — Docs workflow/check behavior only**
   - `.github/workflows/docs.yml`
   - `scripts/check-docs-impact.mjs` (if needed)
4. **PR D — Deploy workflow only**
   - `.github/workflows/deploy-api.yml`
5. **PR E — Release workflow only**
   - `.github/workflows/release.yml`
6. **PR F — Contributor/spec docs follow-up**
   - `CONTRIBUTING.md`, `spec/environments.md`, related runbooks

Each PR should merge before opening the next one, unless you explicitly need stacked PRs.

## "Hanging checks" quick triage

If a required check is stuck on `Expected — Waiting for status to be reported`:

1. Compare required checks vs reported checks:
   - `gh api repos/pdcarlson/Frapp/branches/main/protection`
   - `gh pr checks <PR_NUMBER>`
2. If a required workflow did not run, remove workflow-level `paths` filters.
3. If check names changed, update branch protection config and re-apply it.
4. If external providers (e.g. Vercel) are stuck, use emergency override, merge, then immediately restore protections.
