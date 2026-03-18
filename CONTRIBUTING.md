# Contributing to Frapp

---

## Branch Model

Frapp uses a **two-branch model** with `preview` (staging) and `main` (production). There is no `develop` branch.

```text
feature/xyz ──PR──▶ preview (staging) ──PR──▶ main (production)
```

| Branch | Purpose | Deployment |
| --- | --- | --- |
| `main` | Production-ready code | Triggers production deploys (Vercel, Render) |
| `preview` | Staging integration | Triggers staging deploys (Vercel preview, Render staging) |
| `feature/*` | Short-lived feature work | PR preview URLs only; merged into `preview` |
| `hotfix/*` | Emergency production fixes | Branch from `preview`, PR to `preview`, then fast-track promotion PR to `main` |

### Rules

- **Never commit directly** to `main` or `preview`. All changes go through PRs.
- **Feature branches** are created from `preview` and target `preview` via PR.
- **Production promotion** is done via PR from `preview` → `main`.
- **PRs to `main`** must come from `preview` (enforced by CI).
- **Hotfixes** branch from `preview`, merge to `preview`, then fast-track a promotion PR to `main`.

---

## Merge Strategy

| Merge type | Strategy | Rationale |
| --- | --- | --- |
| Feature → preview | **Squash merge** | Clean history, one commit per feature |
| preview → main | **Merge commit** | Preserves promotion audit trail, triggers version tag |

---

## Required Status Checks

Every PR must pass these checks before merging. Branch protection enforces this for all users, including admins.

### CI Jobs (GitHub Actions)

| Check | What it validates |
| --- | --- |
| `CI / packages-build` | Shared packages compile |
| `CI / lint-and-typecheck` | ESLint + TypeScript across all workspaces |
| `CI / api-tests` | API Jest unit tests |
| `CI / api-contract-check` | `openapi.json` + `api-sdk/types.ts` freshness |
| `CI / migration-safety` | Migration filename validation + promotion docs |
| `CI / mobile-validate` | Mobile app lint + typecheck |
| `Docs / build-and-lint` | Docs build + lint + docs/spec sync checks |
| `CI / branch-policy` | `main`-targeting PRs must come from `preview` (required on `main` only) |

### External Checks

| Check | Provider |
| --- | --- |
| `Vercel – frapp-web` | Vercel (Next.js build) |
| `Vercel – frapp-landing` | Vercel (Next.js build) |
| `Vercel – frapp-docs` | Vercel (Next.js build) |

### Review Blockers (not status checks)

| Check | Provider |
| --- | --- |
| CodeRabbit review (`request_changes_workflow`) | CodeRabbit (AI code review) |

---

## PR Workflow

For infrastructure-heavy work (CI/CD, branch protection, release automation), follow `docs/internal/PR_REVIEW_PROCESS.md` and split into small, single-concern PRs.

### 1. Create a feature branch

```bash
git checkout preview
git pull origin preview
git checkout -b feature/123-my-feature
```

### 2. Make changes and commit

Use conventional commit messages:

```text
type(scope): description
```

| Type | Use for |
| --- | --- |
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation changes |
| `style` | Formatting, missing semicolons, etc. |
| `refactor` | Code refactoring |
| `test` | Adding tests |
| `chore` | Maintenance tasks |

### 3. Open a PR targeting `preview`

- Run the local gate first: `npm run ci:local-gate`
  - This runs docs/spec sync (`scripts/check-docs-impact.mjs`), docs build/lint, and the CI parity checks.
- If the docs/spec check needs a different base branch, use: `npm run ci:local-gate -- --base-ref origin/main`
- Fill out the PR template completely.
- Check the "Docs / Spec impact" section — if you changed product code, update `apps/docs/` or `spec/`.
- CI and Vercel checks will run automatically.
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

Versions are automatically created when the `preview` → `main` promotion PR merges:

- **Default:** Patch bump when the promotion PR has no release label (`v1.0.0` → `v1.0.1`)
- **Minor:** Add label `release:minor` to the `preview` → `main` promotion PR (`v1.0.0` → `v1.1.0`)
- **Major:** Add label `release:major` to the `preview` → `main` promotion PR (`v1.0.0` → `v2.0.0`)

The version tag and GitHub Release are created automatically by the release workflow.

---

## Code Quality

- **TypeScript strict mode** across all apps and packages.
- **ESLint** with shared config (`@repo/eslint-config`).
- **Prettier** for formatting.
- **No magic numbers** — use named constants.
- **Single responsibility** — keep functions small and focused.
- **DRY** — extract repeated code into shared packages.
- **Self-documenting code** — comments explain *why*, not *what*.

See `spec/architecture.md` Section 11 for the full quality standards.
