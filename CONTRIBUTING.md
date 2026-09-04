# Contributing to Frapp

---

## Branch Model

Frapp has **one long-lived branch**: `main`. There is no `develop` branch, and since
#1340 there is no `production` branch either.

```text
feature/xyz ──PR──▶ main (staging) ──manual dispatch──▶ production
```

| Branch      | Purpose                    | Deployment                                                     |
| ----------- | -------------------------- | -------------------------------------------------------------- |
| `main`      | Integration + staging      | Every merge deploys to **Render staging**. The **Vercel half ended 2026-09-02** — `frapp-landing` unlinked from Git 2026-09-01, `frapp-web` 2026-09-02, so no merge deploys web or landing and both hosts serve frozen builds (ADR-21 in [`spec/architecture/README.md`](spec/architecture/README.md)) |
| `feature/*` | Short-lived feature work   | No automatic Vercel deploys; merged into `main`                 |
| `hotfix/*`  | Emergency production fixes | Branch from `main`, PR to `main`, then deploy that commit       |

### Rules

- **Never commit directly** to `main`. All changes go through PRs.
- **Feature branches** are created from `main` and target `main` via PR.
- **`main` is the only legal PR base** (enforced by `pr-base-guard.yml`).
- **Production is deployed by naming a commit**, not by merging a branch — run the
  **Deploy production** workflow with the SHA you want live. It refuses any commit that
  is not an ancestor of `main` or whose CI is not green, so merging to `main` is still
  the only way code becomes deployable.
- **Hotfixes** branch from `main`, merge to `main`, then deploy that commit.

### Why there is no promotion branch

Merging `main` → `production` never actually named a commit. Render's own setting was
auto-deploy on commit, so a push to `production` deployed *without waiting for CI* — the
workflow's green-CI gate governed only its own deploy hook, and what shipped was whatever
happened to be at a branch tip. The dispatch takes a SHA, so the deployed artifact is an
input rather than a race. See
[`docs/internal/ops/DEPLOYMENT.md`](docs/internal/ops/DEPLOYMENT.md).

---

## Merge Strategy

| Merge type     | Strategy         | Rationale                             |
| -------------- | ---------------- | ------------------------------------- |
| Feature → main | **Squash merge** | Clean history, one commit per feature |

Version tags are no longer produced by a merge. `deploy-production.yml` tags the commit
it deployed, after Render and Vercel report healthy — see [Version Tagging](#version-tagging).

---

## Required Status Checks

Every PR must pass the required status checks before merging. Branch protection enforces this for all users, including admins.

**The roster lives in one place and is not restated here.** Every check name, what it validates,
which jobs are advisory rather than merge-blocking, why `migration-drift` was demoted, and the
whole-tree rollout the docs gates go through are in
[`docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md)
**§ Required Status Checks**. Its source of truth is the `CI_CHECKS` / `DOCS_CHECKS` /
`DRIFT_CHECKS` arrays in
[`scripts/ci/lib/required-checks.mjs`](scripts/ci/lib/required-checks.mjs); the runbook's tables are
the only hand-kept copy left, asserted against those arrays by `npm run check:doc-tables`. Live
branch protection is whatever an admin last applied and can lag the arrays, so **no doc claims
per-check whether a gate is live today** — read live state per the runbook. New gates land
report-only and are promoted by adding them to an array and re-running
`npm run configure:branch-protection`, which is a live `PUT` and a human step with an admin PAT: an
agent session runs `npm run configure:branch-protection:verify` (which writes nothing) and nothing
else.

### Vercel deployment policy

**Not live since 2026-09-02 — no push deploys either Vercel app.** Both projects are unlinked from Git (`frapp-landing` 2026-09-01, `frapp-web` 2026-09-02), so `git.deploymentEnabled` governs nothing today and staging web and landing serve frozen builds. **ADR-21** in [`spec/architecture/README.md`](spec/architecture/README.md) is the canonical record; the CI-driven replacement is designed, not built ([#1578](https://github.com/pdcarlson/Frapp/issues/1578)). The rest of this section describes the settings as they remain committed.

Vercel *was* configured to auto-deploy only on `main` via `git.deploymentEnabled` in each app's `vercel.json`. The catch-all disable rule uses `"**": false` so feature branch names containing `/` are matched correctly and skipped. **Keep both `git.deploymentEnabled` and the `ignoreCommand: "exit 1"` pin — do not delete them as dead config:** they are the versioned form of settings that revert to unversioned dashboard state if Git is ever re-linked. Production deployments are not branch-driven at all: `deploy-production.yml` creates them through the Vercel API with `target: production` for a named commit.

### AI review coverage

- Code review is a **local pre-push gate**, not CI: `.claude/hooks/pre-push-review-gate.sh` blocks
  `git push` for a branch HEAD until that HEAD has been reviewed; agents run **`/diff-review`**,
  which writes the marker it looks for. The CI Claude review and the `claude-review-gate` required
  check were removed (2026-06-04, ADR-14 amendment). Which skill, when the bundled `/code-review`
  is reachable, how evidence is recorded, the bypass and the livelock release:
  [`docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md`](docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md) § What runs now.

### PR review requirement policy

- `main`: a human approving review is **not required**; review is the local pre-push gate
  (`/diff-review` for agents, `/code-review` for humans).
- `main`: conversation resolution is **not required**.
- There is no second branch with a stricter policy. The `production` branch carried
  **1 required approving review** as the promotion gate; that gate moved to the
  `production` GitHub **Environment**'s Required reviewers, which pauses the deploy
  itself. It fires at the moment of deploy, on a run that names the commit, rather than
  at a PR opened before anyone knew whether the migration would apply.

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
  - This runs the gitleaks scan and the docs-structure check, then the CI parity checks (lint, type-check, API tests, contract freshness, migration safety, npm audit). There is no docs build or docs lint step.
- If a check needs a different base branch, use: `npm run ci:local-gate -- --base-ref <ref>`
- Fill out the PR template completely.
- Check the "Docs / Spec impact" section — if you changed product code, update `docs/` (e.g. `docs/guides/`) and/or `spec/`. Where to put what: [`docs/internal/DOCUMENTATION_CONVENTIONS.md`](docs/internal/DOCUMENTATION_CONVENTIONS.md).
- CI checks will run automatically.
- Code review runs **locally before you push**, not on the PR: the pre-push review-gate hook requires a
  `/diff-review` pass, which writes the evidence marker itself. `FRAPP_SKIP_REVIEW_GATE=1` is for
  emergencies only — never as the routine path after a review you did run, because it leaves that push
  indistinguishable from one that skipped review. Procedure:
  [`AI_CODE_REVIEW_RUNBOOK.md`](docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md) § How the gate enforces.

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

The **Deploy production** workflow creates the tag and GitHub Release, as its last step,
after Render and Vercel have both reported healthy. So `vX.Y.Z` names a commit that is
actually serving traffic — it used to name one that had merged and was expected to ship.

The bump is read from the `release:*` labels on **every PR merged since the last `v*`
tag**, taking the highest:

- **Default:** patch, when no PR in range carries a label (`v1.0.0` → `v1.0.1`)
- **Minor:** any PR in range labelled `release:minor` (`v1.0.0` → `v1.1.0`)
- **Major:** any PR in range labelled `release:major` (`v1.0.0` → `v2.0.0`)

**Put the label on your own PR.** Before #1340 the label went on the single promotion PR,
which no longer exists. A `release:major` change whose PR carries no label ships as a
patch, silently.

The dispatch also takes an explicit `bump` input that overrides the label scan when you
need to force a version.

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
