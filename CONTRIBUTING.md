# Contributing to Frapp

How we work on Frapp: branches, commits, pull requests, and the checks a change passes before it
merges. Setting up a machine to run the stack is a separate walkthrough:
[`docs/guides/getting-started.md`](docs/guides/getting-started.md). How `spec/` relates to code:
[`AGENTS.md` § Spec vs code](AGENTS.md#spec-vs-code).

---

## Branch Model

Frapp has **one long-lived branch**: `main`. There is no `develop` branch, and since
#1340 there is no `production` branch either.

```text
feature/xyz ──PR──▶ main (staging) ──manual dispatch──▶ production
```

| Branch      | Purpose                    | Deployment                                                     |
| ----------- | -------------------------- | -------------------------------------------------------------- |
| `main`      | Integration + staging      | Every merge deploys to **Render staging**. The **Vercel half ended 2026-09-02** — `frapp-landing` unlinked from Git 2026-09-01, `frapp-web` 2026-09-02, so no merge deploys web or landing and both hosts serve frozen builds (ADR-21 in [`spec/architecture/adr/adr-21.md`](spec/architecture/adr/adr-21.md)) |
| `feature/*` | Short-lived feature work   | No automatic Vercel deploys; merged into `main`                 |
| `hotfix/*`  | Emergency production fixes | Branch from `main`, PR to `main`, then deploy that commit       |

### Rules

- **Never commit directly** to `main`. All changes go through PRs.
- **Feature branches** are created from `main` and target `main` via PR.
- **`main` is the only legal PR base** (enforced by `pr-base-guard.yml`). Never target another
  feature branch: `pull_request.branches` is only `[main]`, so a stacked PR skips CI, and a
  squash-merge can show MERGED while `origin/main` never receives the work. Re-land by
  cherry-picking onto `origin/main`. Playbook:
  [`pr-babysitting.md`](docs/ci-cd/pr-babysitting.md#ci-branch-filters-never-target-a-feature-branch)
  (incidents #1120, #1123–#1125).
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

Version tags are no longer produced by a merge. `deploy-production.yml` tags the commit
it deployed, after Render and Vercel report healthy — see [Version Tagging](#version-tagging).

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

### Vercel deployment policy

**Not live since 2026-09-02 — no push deploys either Vercel app.** Both projects are unlinked from Git (`frapp-landing` 2026-09-01, `frapp-web` 2026-09-02), so `git.deploymentEnabled` governs nothing today and staging web and landing serve frozen builds. **ADR-21** in [`spec/architecture/adr/adr-21.md`](spec/architecture/adr/adr-21.md) is the canonical record; the CI-driven replacement is built ([#1578](https://github.com/pdcarlson/Frapp/issues/1578)). The rest of this section describes the settings as they remain committed.

Vercel *was* configured to auto-deploy only on `main` via `git.deploymentEnabled` in each app's `vercel.json`. The catch-all disable rule uses `"**": false` so feature branch names containing `/` are matched correctly and skipped. **Keep both `git.deploymentEnabled` and the `ignoreCommand: "exit 1"` pin — do not delete them as dead config:** they are the versioned form of settings that revert to unversioned dashboard state if Git is ever re-linked. Production deployments are not branch-driven at all: `deploy-production.yml` creates them through the Vercel API with `target: production` for a named commit.

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

Name the branch after the change: `feature/events-rbac`, `feature/backwork-redaction-ui`.

### 2. Make changes and commit

When the change alters intended behavior, update `spec/` first, then the code; see
[Spec-first development](#spec-first-development).

Use conventional commit messages, with a short scope when it helps:

```text
type(scope): description
```

For example `feat(api): add service hours endpoints`, `refactor: switch api auth to supabase`, or
`docs(guides): add docker guide`. The types:

- `feat` — new user-visible feature
- `fix` — bug fix
- `refactor` — code change that doesn't alter behavior
- `docs` — documentation only
- `test` — adding or changing tests
- `ci` — workflows, CI scripts, and gates
- `style` — formatting only, no behavior change
- `chore` — tooling, config, or misc maintenance

### 3. Open a PR targeting `main`

- Run the local gate first: `npm run ci:local-gate`
  - This runs the gitleaks scan, then the CI parity checks (lint, type-check, API tests, contract freshness, migration safety, npm audit). It previews what CI will run and nothing more — never add a local-only check to it.
- If a check needs a different base branch, use: `npm run ci:local-gate -- --base-ref <ref>`
- Fill out the PR template completely. In the description:
  - Link the spec sections you implemented.
  - Describe the change in terms of **behavior** and **domains** ("Backwork upload metadata", not
    "added 3 columns").
  - List test coverage: unit tests, E2E, and any manual scenarios you ran.
  - Call out follow-up work and tech debt explicitly.
- Check the "Docs / Spec impact" section; whether your change owes a doc edit, and which doc, is under [Documentation](#documentation).
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

## Spec-first development

`spec/` owns intended behavior, so a change that alters it starts there:

1. Update the spec: [`spec/product/`](spec/product/README.md) for the product view,
   [`spec/behavior/`](spec/behavior/README.md) for feature behavior and edge cases,
   [`spec/architecture/README.md`](spec/architecture/README.md) for the system and data model.
2. Then implement it in `apps/api` (API) or `apps/web` / `apps/mobile` (UI).

When the implementation and the spec diverge,
[`AGENTS.md` § Spec vs code](AGENTS.md#spec-vs-code) says what to do.

---

## Linting, types, and tests

Before pushing:

```bash
npm run lint        # read-only, every workspace
npm run lint:api    # optional API-only lint run (read-only; fix with `npm run lint:api:fix`)
npm run check-types
npm run test -w apps/api
```

`npm run ci:local-gate` runs these and the rest of CI's parity checks in one go
([PR Workflow step 3](#3-open-a-pr-targeting-main)).

### They work from a clean checkout

`npm install && npm run check-types` is enough, with no manual package build first. The shared
packages under `packages/` publish their types as `dist/index.d.ts`, and `dist/` is gitignored, so
a consumer that resolves the `types` condition (`apps/api`, via `NodeNext`) cannot see them until
those packages are built. Root `turbo.json` handles that by making `check-types` and `lint` depend
on `^build`:

```jsonc
"lint":        { "dependsOn": ["^build"] },
"check-types": { "dependsOn": ["^build"] }
```

Depending on `^check-types` / `^lint` instead is the trap: turbo then orders the tasks correctly but
never produces the `dist/` outputs they read, so a fresh clone fails with `TS2307: Cannot find module
'@repo/validation'` (and friends) until you manually run `npx turbo run build --filter='./packages/*'`.
The apps that resolve with `moduleResolution: "Bundler"` mask it (`apps/web` and `apps/landing` through
`@repo/typescript-config/nextjs.json`, `apps/mobile` through `expo/tsconfig.base`): TypeScript tries
`types` first and, while that `dist/` file is missing, falls back to the `import` condition, which maps
to source (once `dist/` exists it reads `dist/*.d.ts`). So the breakage shows up only where NodeNext
resolution meets a dist-backed import: `apps/api`, and the CommonJS packages on
`@repo/typescript-config/base.json` that import one (`packages/chapter-theme`). `packages/hooks` resolves
with `Bundler` like the apps, because it too is consumed as source and has no build. The CI job
`clean-checkout-typecheck` guards this: it installs and runs both checks with nothing prebuilt, so a
regression here fails there while every other job (all of which prebuild the packages) stays green.

This applies to the **root** scripts, which go through turbo. A single-workspace invocation such as
`npm run check-types -w apps/api` bypasses turbo and runs `tsc` directly, so on a cold clone it still
fails until the packages exist. Run the root script once (or `npx turbo run build --filter='./packages/*'`)
before reaching for the `-w` form.

Type-checking runs TypeScript 7's native `tsc`. The package named `typescript` is the TypeScript
6 compiler API (`npm:@typescript/typescript6`), which Nest, `typescript-eslint`, and `ts-jest`
still import. Do not replace that alias with `typescript@7`; see
[`docs/ci-cd/agent-infra.md`](docs/ci-cd/agent-infra.md) § TypeScript 7.

### Lint never writes

`npm run lint` is **read-only** in every workspace: it reports violations and never edits your
files, so it is safe in CI and in read-only audits. To apply ESLint's auto-fixes in `apps/api`, run
the explicit fix script instead:

```bash
npm run lint:api:fix        # or: npm run lint:fix -w apps/api
```

`apps/api` is the only workspace with a fix script; everywhere else, resolve the reported
violations by hand (or with your editor's ESLint integration).

Keep `--fix` out of any `lint` script. Under `apps/api`'s config `prettier/prettier` is an
**error**, and every Prettier violation is auto-fixable, so a `lint` script carrying `--fix`
repairs the error, exits `0`, and the failure never reaches CI (the repaired file is discarded
with the runner).

Shared React lint (`@repo/eslint-config/next-js` and `react-internal`) takes an **allowlist**
from `eslint-plugin-react-hooks` v7 `recommended` (core Rules of Hooks plus every
compiler rule in that preset). New compiler rules that appear in a later plugin
bump stay `"off"` until a dedicated cleanup; see
[`docs/ci-cd/agent-infra.md`](docs/ci-cd/agent-infra.md) § eslint-plugin-react-hooks 7.

### What CI adds

CI runs the same lint and type-check, plus `npm run build` and the API unit **and E2E** tests (the
`api-tests` job runs both; the E2E suite boots the app with a mocked Supabase client, so no live
services). The full roster is under [Required Status Checks](#required-status-checks).

---

## Documentation

Whether a change owes a doc edit: [`AGENTS.md` § Documentation discipline](AGENTS.md#documentation-discipline).
Which doc owns which fact: [`DOCUMENTATION_CONVENTIONS.md` § Where things go](docs/internal/DOCUMENTATION_CONVENTIONS.md#where-things-go).
No check requires you to touch a doc, and nothing checks that a claim is true; what the doc CI
does check: [`docs-ci.md` § What runs](docs/ci-cd/docs-ci.md#what-runs).

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

The **Deploy production** workflow creates the tag and GitHub Release, as its last step,
after Render and Vercel have both reported healthy. So `vX.Y.Z` names a commit that is
actually serving traffic — it used to name one that had merged and was expected to ship.

The bump is read from the `release:*` labels on **every PR merged since the last `v*`
tag**, taking the highest:

- **Default:** patch, when no PR in range carries a label (`v0.6.0` → `v0.6.1`)
- **Minor:** any PR in range labelled `release:minor` (`v0.6.0` → `v0.7.0`)
- **Major:** any PR in range labelled `release:major`. While the latest tag's major is 0 it
  mints a minor instead (`v0.6.0` → `v0.7.0`): releases are pre-1.0 until v1 GA, and
  leaving 0.x takes the dispatch's `bump=major`, though whether the `v1.0.0` it mints can
  have a GitHub Release is open ([#3015](https://github.com/pdcarlson/Frapp/issues/3015);
  [spec § Release labels](spec/environments/README.md#release-labels-for-version-tags)).
  From 1.x on it mints the next major.

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
