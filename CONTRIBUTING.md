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
| `main`      | Integration + staging      | Every merge whose CI passes deploys staging: migrations, the Render API, then web and landing on Vercel. The order: [`ci-cd.md` § How Deployments Are Gated](docs/ops/deployment/ci-cd.md#how-deployments-are-gated) |
| `feature/*` | Short-lived feature work   | Never deployed; merged into `main`                             |
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
[`docs/ops/deployment/`](docs/ops/deployment/).

---

## Merge Strategy

| Merge type     | Strategy         | Rationale                             |
| -------------- | ---------------- | ------------------------------------- |
| Feature → main | **Squash merge** | Clean history, one commit per feature |

Version tags are not produced by a merge: see [Version Tagging](#version-tagging).

---

## Required Status Checks

Every PR must pass the required status checks before merging. Branch protection enforces this for all users, including admins.

**The roster lives in one place and is not restated here.** Every check name, what it validates,
which jobs are advisory rather than merge-blocking, and why `migration-drift` was demoted are in
[`docs/ops/github-branch-protection-runbook.md`](docs/ops/github-branch-protection-runbook.md)
**§ Required Status Checks**. Its source of truth is the `CI_CHECKS` / `DOCS_CHECKS` /
`DRIFT_CHECKS` arrays in
[`scripts/ci/lib/required-checks.mjs`](scripts/ci/lib/required-checks.mjs), which are the arrays
`configure:branch-protection` actually applies. The runbook's tables are a reading copy of them for
the admin procedure, and no check asserts the two agree any more: **the arrays decide.** Where a
table disagrees with them, the table is stale — fix it there, and do not add a per-check note here.
Live branch protection is whatever an admin last applied and can lag the arrays, so **no doc claims
per-check whether a gate is live today** — read live state per the runbook. New gates land
report-only and are promoted by adding them to an array and re-running
`npm run configure:branch-protection`, which is a live `PUT` and a human step with an admin PAT: an
agent session runs `npm run configure:branch-protection:verify` (which writes nothing) and nothing
else.

### AI review coverage

- Code review is a **local Git pre-push gate**, not CI. The checked-in
  [`.githooks/pre-push`](.githooks/pre-push) is enabled by `npm install` / `npm ci` and applies to
  agents and humans alike. It requires `.cache/diff-review/<PUSHED_COMMIT_SHA>` for the commit each
  pushed ref points at, unless that commit adds nothing unreviewed (it is on `main`, or only cleanly
  merges `main` into reviewed work); `/diff-review` writes that evidence. Retrying never releases a denied push. Git's
  explicit `--no-verify` option and an uninstalled/changed hooks path remain bypasses, so this is not
  described as an unconditional server-side gate. Details:
  [`ai-code-review-runbook.md`](docs/ci-cd/ai-code-review-runbook.md).

### PR review requirement policy

- `main`: a human approving review is **not required**; review is the local pre-push gate,
  `/diff-review`, for agents and humans alike (`/code-review` can add coverage but doesn't pass it).
- `main`: conversation resolution is **not required**.
- There is no second branch with a stricter policy. The `production` branch carried
  **1 required approving review** as the promotion gate; that gate moved to the
  `production` GitHub **Environment**'s Required reviewers, which pauses the deploy
  itself. It fires at the moment of deploy, on a run that names the commit, rather than
  at a PR opened before anyone knew whether the migration would apply.

---

## PR Workflow

For infrastructure-heavy work (CI/CD, branch protection, release automation), split the change into small, single-concern PRs, so each has one failure domain, and say in each PR's description how to revert it. A PR that renames a required check follows [`github-branch-protection-runbook.md` § Updating Check Names](docs/ops/github-branch-protection-runbook.md#updating-check-names).

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

The canonical type list lives in [`docs/guides/contributing.md` § Commit messages](docs/guides/contributing.md#2-commit-messages). It is not restated here — this file and that one carried two
divergent lists until #1635.

### 3. Open a PR targeting `main`

- Run the local gate first: `npm run ci:local-gate`
  - This runs the gitleaks scan, then the CI parity checks (lint, type-check, API tests, contract freshness, migration safety, npm audit). It previews what CI will run and nothing more — never add a local-only check to it.
- If a check needs a different base branch, use: `npm run ci:local-gate -- --base-ref <ref>`
- Fill out the PR template completely.
- Check the "Docs / Spec impact" section. Whether your change owes a doc edit, and which doc: [`docs/internal/DOCUMENTATION_CONVENTIONS.md` § Where a fact lives](docs/internal/DOCUMENTATION_CONVENTIONS.md#where-a-fact-lives).
- CI checks will run automatically.
- Code review runs **locally before you push**, not on the PR: the pre-push review-gate hook requires a
  `/diff-review` pass, which writes the evidence marker itself. `git push --no-verify` is for
  emergencies only — never as the routine path after a review you did run, because it leaves that push
  indistinguishable from one that skipped review. Procedure:
  [`ai-code-review-runbook.md`](docs/ci-cd/ai-code-review-runbook.md) § How the gate enforces.

### 4. Address feedback

- Fix any CI failures.
- Address review comments and push follow-up commits. A push that adds commits of your own needs a
  `/diff-review` pass (usually a short inline round over just the new commits), or the pre-push hook
  refuses it.
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

The same job also fails a change that breaks the contract a shipped mobile build
was made from, such as removing a route it may call:
[`quality-gates.md` § Two comparisons, two postures](docs/ci-cd/quality-gates.md#two-comparisons-two-postures).

---

## Database Migrations

When you change the database schema:

1. Create a migration: `npm run supabase -- migration new my_change_name`
2. Write the SQL in the generated file under `supabase/migrations/`.
3. Apply locally: `npm run supabase -- db push --local`
4. Test locally.
5. Add its rollback recipe and its promotion-log entry, each in the entry shape its ledger states: [`db-rollback-playbook.md` § Every migration owes a recipe here](docs/ops/db-rollback-playbook.md#every-migration-owes-a-recipe-here) and [`promotion-log.md`](docs/ops/database/promotion-log.md).
6. Commit the migration file and both entries together.

CI validates migration filenames, and `check:migration-safety` fails a new migration missing either entry. Migrations are applied automatically in the deploy pipeline.

---

## Secrets & Environment Variables

- **Never** commit secrets (`.env*`, credentials, private keys).
- **Never** log secrets.
- **Never** use placeholder secrets in CI/CD workflows.
- All secrets are managed in Infisical. Which providers it syncs to, and how CI gets its secrets instead: [`SECRETS_MANAGEMENT.md` § 5](docs/internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs). Mobile `EXPO_PUBLIC_*` values are the exception: none lives in Infisical, and EAS is not synced, so a device build's values are set in the EAS dashboard or as a non-secret `eas.json` `build.<profile>.env` entry ([§ 4](docs/internal/environment/SECRETS_MANAGEMENT.md#4-add-references)).
- See **[`docs/internal/environment/ENV_REFERENCE.md`](docs/internal/environment/ENV_REFERENCE.md)** for the complete list of every variable, per app, per environment.
- See **[`docs/internal/environment/SECRETS_MANAGEMENT.md`](docs/internal/environment/SECRETS_MANAGEMENT.md)** for the Infisical setup guide and rotation policy.

---

## Version Tagging

Release labels, and how the **Deploy production** workflow turns them into a `vX.Y.Z` tag: [`spec/environments/README.md` § Release labels for version tags](spec/environments/README.md#release-labels-for-version-tags).

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
