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

| Check                | What it validates                                                                |
| -------------------- | -------------------------------------------------------------------------------- |
| `packages-build`     | Shared packages compile                                                          |
| `lint-and-typecheck` | ESLint + TypeScript across all workspaces                                        |
| `api-tests`          | API Jest unit tests                                                              |
| `api-contract-check` | `openapi.json` + `api-sdk/types.ts` freshness                                    |
| `migration-safety`   | Migration filename validation + promotion docs                                   |
| `mobile-validate`    | Mobile app lint + typecheck                                                      |
| `build-and-lint`     | Docs/spec sync on PRs (`scripts/check-docs-impact.mjs` only; no docs app build)  |
| `branch-policy`      | `production`-targeting PRs must come from `main` (required on `production` only) |

### Vercel deployment policy

Vercel is configured to auto-deploy only on `main` and `production` via `git.deploymentEnabled` in each app's `vercel.json`. The catch-all disable rule uses `"**": false` so feature branch names containing `/` are matched correctly and skipped.

### Review Blockers (not status checks)

| Check                                          | Provider                    |
| ---------------------------------------------- | --------------------------- |
| CodeRabbit review (`request_changes_workflow`) | CodeRabbit (AI code review) |

### PR review requirement policy

- `main`: approving review is **not required** (CodeRabbit feedback is advisory).
- `main`: conversation resolution is **not required** (you can choose whether to act on CodeRabbit comment threads).
- `production`: **1 approving review required** and conversation resolution remains enabled (promotion/control gate).

---

## PR Workflow

For infrastructure-heavy work (CI/CD, branch protection, release automation), follow `docs/internal/PR_REVIEW_PROCESS.md` and split into small, single-concern PRs.

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
  - This runs docs/spec sync (`scripts/check-docs-impact.mjs`), docs build/lint, and the CI parity checks.
- If the docs/spec check needs a different base branch, use: `npm run ci:local-gate -- --base-ref origin/production`
- Fill out the PR template completely.
- Check the "Docs / Spec impact" section — if you changed product code, update `docs/` (e.g. `docs/guides/`) and/or `spec/`. Where to put what: [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md).
- CI checks will run automatically.
- CodeRabbit will post an AI review.

### 4. Address feedback

- Fix any CI failures.
- Respond to CodeRabbit review comments (push new commits to dismiss stale reviews).
- All required checks must pass before merging.

### 5. Merge via squash merge

---

## API Contract Changes

When you change an API endpoint:

1. Make your source code changes in `apps/api/src/`.
2. Regenerate the OpenAPI spec: `npm run openapi:export -w apps/api`
3. Regenerate the SDK types: `npm run generate -w packages/api-sdk`
4. Commit all three together (source + `openapi.json` + `types.ts`).

CI will reject PRs that change API source without updating the contract artifacts.

---

## Database Migrations

When you change the database schema:

1. Create a migration: `npx supabase migration new my_change_name`
2. Write the SQL in the generated file under `supabase/migrations/`.
3. Apply locally: `npx supabase db push --local`
4. Test locally.
5. Update `docs/internal/DB_ROLLBACK_PLAYBOOK.md` with the rollback strategy.
6. Commit the migration file and docs update together.

CI validates migration filenames and requires promotion docs to be updated. Migrations are applied automatically in the deploy pipeline.

---

## Secrets & Environment Variables

- **Never** commit secrets (`.env*`, credentials, private keys).
- **Never** log secrets.
- **Never** use placeholder secrets in CI/CD workflows.
- All secrets are managed in Infisical and synced to providers (Vercel, Render, EAS, GitHub Actions).
- See **[`docs/internal/ENV_REFERENCE.md`](docs/internal/ENV_REFERENCE.md)** for the complete list of every variable, per app, per environment.
- See **[`docs/internal/SECRETS_MANAGEMENT.md`](docs/internal/SECRETS_MANAGEMENT.md)** for the Infisical setup guide and rotation policy.

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

See `spec/architecture.md` Section 11 for the full quality standards.
