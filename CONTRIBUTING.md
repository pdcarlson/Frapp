# Contributing to Frapp

---

## Branch Model

Frapp uses a **two-branch model** with `main` (staging) and `production` (production). There is no `develop` branch.

```text
feature/xyz ──PR──▶ main (staging) ──PR──▶ production (production)
```

| Branch       | Purpose                    | Deployment                                                                     |
| ------------ | -------------------------- | ------------------------------------------------------------------------------ |
| `main`       | Staging integration        | Triggers staging deploys (Vercel preview, Render staging)                      |
| `production` | Production-ready code      | Triggers production deploys (Vercel, Render)                                   |
| `feature/*`  | Short-lived feature work   | No automatic Vercel deploys; merged into `main`                                |
| `hotfix/*`   | Emergency production fixes | Branch from `main`, PR to `main`, then fast-track promotion PR to `production` |

### Rules

- **Never commit directly** to `main` or `production`. All changes go through PRs.
- **Feature branches** are created from `main` and target `main` via PR.
- **Production promotion** is done via PR from `main` → `production`.
- **PRs to `production`** must come from `main` (enforced by CI).
- **Hotfixes** branch from `main`, merge to `main`, then fast-track a promotion PR to `production`.

---

## Merge Strategy

| Merge type        | Strategy         | Rationale                                             |
| ----------------- | ---------------- | ----------------------------------------------------- |
| Feature → main    | **Squash merge** | Clean history, one commit per feature                 |
| main → production | **Merge commit** | Preserves promotion audit trail, triggers version tag |

---

## Required Status Checks

Every PR must pass these checks before merging. Branch protection enforces this for all users, including admins.

### CI Jobs (GitHub Actions)

| Check                | What it validates                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `packages-build`     | Shared packages compile                                                                            |
| `lint-and-typecheck` | ESLint + TypeScript across all workspaces, **`nest build` for `apps/api`** (matches Render compile), landing + `@repo/validation` unit tests |
| `api-docker-build`   | `docker build -f apps/api/Dockerfile .` (API image compile path)                                   |
| `api-tests`          | API Jest unit tests                                                                                |
| `api-contract-check` | `openapi.json` + `packages/api-sdk/src/types.ts` freshness                                                      |
| `migration-safety`   | Migration filename validation + promotion docs                                                     |
| `mobile-validate`    | Mobile app lint + typecheck + unit tests (Vitest)                                                  |
| `ci-scripts-tests`   | `node --test` unit tests for the deploy-gate/CI scripts under `scripts/ci/`                        |
| `secret-scan`        | gitleaks over the PR/push commit range (ADR-13 push-protection replacement)                        |
| `clean-checkout-typecheck` | Bare `npm ci` + typecheck + lint with no prebuilt packages (guards `turbo.json` `^build`)    |
| `dependency-audit`   | npm audit gate: high/critical advisories not allowlisted in `scripts/npm-audit-allowlist.json` fail (ROLLOUT†) |
| `chapter-directory-seed` | `supabase/seed/chapter_directory.csv`: canonical `#RRGGBB` colors, real archetypes, no duplicate natural keys (ROLLOUT†) |
| `web-tests`          | `apps/web` unit tests plus the shared packages only this suite covers — `packages/hooks`, `packages/ui`, `packages/chat-core` (ROLLOUT†) |
| `changes`            | Computes the path filter that decides whether `web-tests` runs. Required only because `web-tests` needs it — a required check with a non-required parent can be skipped *and* still count as passing (ROLLOUT†) |
| `docs-spec-sync`     | Docs/spec sync **and** structure on PRs (`scripts/check-docs-impact.mjs` + `scripts/check-docs-structure.mjs`; no docs app build). A change with genuinely no docs impact can be waived with the `no-doc-change-needed` label |
| `doc-paths`          | Backticked repo-path citations in docs resolve to real files (`scripts/check-doc-paths.mjs`, whole-tree) — **reports only, not yet required** (ROLLOUT‡) |
| `branch-policy`      | `production`-targeting PRs must come from `main` (required on `production` only)                   |

† `dependency-audit` becomes a *required* check via the standard rollout step: after the job first runs green on the target branch, an admin re-runs `npm run configure:branch-protection` (see [`docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md)). Until then the job runs and reports on every PR but is not yet merge-blocking.

‡ `doc-paths` is deliberately **not** required yet. It scans the whole tree rather than the PR diff (a citation breaks when the file it names moves — a change on the other side of the reference), so as a required check it could block a PR over a citation in a doc that PR never touched. Promote it the same way as `dependency-audit`: uncomment `"doc-paths"` in `DOCS_CHECKS` and re-run `npm run configure:branch-protection`. See [`docs/internal/ci-cd/DOCS_CI.md`](docs/internal/ci-cd/DOCS_CI.md).

### Vercel deployment policy

Vercel is configured to auto-deploy only on `main` and `production` via `git.deploymentEnabled` in each app's `vercel.json`. The catch-all disable rule uses `"**": false` so feature branch names containing `/` are matched correctly and skipped.

### AI review coverage

- Code review is a **local pre-push gate**, not CI: `.claude/hooks/pre-push-review-gate.sh` blocks
  `git push` for a branch HEAD until that HEAD has been reviewed (review sub-agents inherit the
  session model, Opus). Agents run **`/diff-review`**, which writes the marker the gate looks for;
  the richer bundled **`/code-review`** is also available, but is model-invocable only when the
  turn's prompt carries `/code-review` whitespace-delimited on both sides — backticks or trailing
  punctuation defeat it (never in a sub-agent, never under `/next`)
  — and it does not write the marker, so after using it record the evidence by hand rather than
  reaching for `FRAPP_SKIP_REVIEW_GATE=1`, which is for emergencies and leaves a reviewed push
  indistinguishable from an unreviewed one. The CI Claude review and the
  `claude-review-gate` required check were removed (2026-06-04, ADR-14 amendment). See
  [`docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`](docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md).

### PR review requirement policy

- `main`: a human approving review is **not required**; review is the local pre-push gate
  (`/diff-review` for agents, `/code-review` for humans).
- `main`: conversation resolution is **not required**.
- `production`: **1 approving review required** and conversation resolution remains enabled (promotion/control gate).

---

## PR Workflow

For infrastructure-heavy work (CI/CD, branch protection, release automation), follow `docs/internal/quality/PR_REVIEW_PROCESS.md` and split into small, single-concern PRs.

### 1. Create a feature branch

```bash
git checkout main
git pull origin main
git checkout -b feature/123-my-feature
```

### 2. Make changes and commit

Use conventional commit messages:

```text
type(scope): description
```

| Type       | Use for                              |
| ---------- | ------------------------------------ |
| `feat`     | New feature                          |
| `fix`      | Bug fix                              |
| `docs`     | Documentation changes                |
| `style`    | Formatting, missing semicolons, etc. |
| `refactor` | Code refactoring                     |
| `test`     | Adding tests                         |
| `chore`    | Maintenance tasks                    |

### 3. Open a PR targeting `main`

- Run the local gate first: `npm run ci:local-gate`
  - This runs docs/spec sync (`scripts/check-docs-impact.mjs`), the gitleaks scan, then the CI parity checks (lint, type-check, API tests, contract freshness, migration safety, npm audit). There is no docs build or docs lint step.
  - The docs/spec check runs **first** and a failure aborts the rest, so a pure-code change with no docs impact would never reach lint or the tests. Waive it the same way CI does: `PR_LABELS_JSON='["no-doc-change-needed"]' npm run ci:local-gate` — see [`docs/internal/ci-cd/DOCS_CI.md`](docs/internal/ci-cd/DOCS_CI.md).
- If the docs/spec check needs a different base branch, use: `npm run ci:local-gate -- --base-ref origin/production`
- Fill out the PR template completely.
- Check the "Docs / Spec impact" section — if you changed product code, update `docs/` (e.g. `docs/guides/`) and/or `spec/`. Where to put what: [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md).
- CI checks will run automatically.
- Code review runs **locally before you push** (the pre-push review-gate hook requires a
  `/diff-review` pass — or `/code-review` plus `FRAPP_SKIP_REVIEW_GATE=1`), not on the PR — see [`docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`](docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md).

### 4. Address feedback

- Fix any CI failures.
- Address Claude review findings as needed and push follow-up commits for re-review.
- All required checks must pass before merging.

### 5. Merge via squash merge

---

## API Contract Changes

When you change an API endpoint:

1. Make your source code changes in `apps/api/src/`.
2. Regenerate the OpenAPI spec: `npm run openapi:export -w apps/api`
3. Regenerate the SDK types: `npm run generate -w packages/api-sdk`
4. Commit the regenerated artifacts (`openapi.json` and, if it changed, `types.ts`) alongside your source.

CI (`api-contract-check`) regenerates both artifacts and fails if the committed
copies are stale relative to the API source. A change that touches API source
but doesn't alter the contract (e.g. adding a request-scoped param decorator)
passes as long as the committed artifacts already match a fresh regeneration —
note that not every contract change affects `types.ts` (security schemes and
descriptions live only in `openapi.json`).

---

## Database Migrations

When you change the database schema:

1. Create a migration: `npx supabase migration new my_change_name`
2. Write the SQL in the generated file under `supabase/migrations/`.
3. Apply locally: `npx supabase db push --local`
4. Test locally.
5. Update `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md` with the rollback strategy.
6. Commit the migration file and docs update together.

CI validates migration filenames and requires promotion docs to be updated. Migrations are applied automatically in the deploy pipeline.

---

## Secrets & Environment Variables

- **Never** commit secrets (`.env*`, credentials, private keys).
- **Never** log secrets.
- **Never** use placeholder secrets in CI/CD workflows.
- All secrets are managed in Infisical and synced to providers (Vercel, Render, EAS, GitHub Actions).
- See **[`docs/internal/environment/ENV_REFERENCE.md`](docs/internal/environment/ENV_REFERENCE.md)** for the complete list of every variable, per app, per environment.
- See **[`docs/internal/environment/SECRETS_MANAGEMENT.md`](docs/internal/environment/SECRETS_MANAGEMENT.md)** for the Infisical setup guide and rotation policy.

---

## Version Tagging

Versions are automatically created when the `main` → `production` promotion PR merges:

- **Default:** Patch bump when the promotion PR has no release label (`v1.0.0` → `v1.0.1`)
- **Minor:** Add label `release:minor` to the `main` → `production` promotion PR (`v1.0.0` → `v1.1.0`)
- **Major:** Add label `release:major` to the `main` → `production` promotion PR (`v1.0.0` → `v2.0.0`)

The version tag and GitHub Release are created automatically by the release workflow.

---

## Code Quality

- **TypeScript strict mode** across all apps and packages.
- **ESLint** with shared config (`@repo/eslint-config`).
- **Prettier** for formatting.
- **No magic numbers** — use named constants.
- **Single responsibility** — keep functions small and focused.
- **DRY** — extract repeated code into shared packages.
- **Self-documenting code** — comments explain _why_, not _what_.

See `spec/architecture/README.md` Section 11 for the full quality standards.
