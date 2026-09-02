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

Every PR must pass these checks before merging. Branch protection enforces this for all users, including admins.

### CI Jobs (GitHub Actions)

| Check                | What it validates                                                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `packages-build`     | Shared packages compile                                                                            |
| `lint-and-typecheck` | ESLint + TypeScript across all workspaces, **`nest build` for `apps/api`** (matches Render compile), landing plus `@repo/validation`, `@repo/color`, `@repo/formatting`, `@repo/chapter-theme`, `@repo/theme`, and `@repo/api-sdk` unit tests |
| `api-docker-build`   | `docker build -f apps/api/Dockerfile .` (API image compile path)                                   |
| `api-tests`          | API Jest unit tests                                                                                |
| `api-contract-check` | `openapi.json` + `packages/api-sdk/src/types.ts` freshness                                                      |
| `migration-safety`   | Migration filename validation + promotion docs                                                     |
| `mobile-validate`    | Mobile app lint + typecheck + unit tests (Vitest)                                                  |
| `ci-scripts-tests`   | `node --test` unit tests for the deploy-gate/CI scripts under `scripts/ci/`                        |
| `secret-scan`        | gitleaks over the PR/push commit range (ADR-13 push-protection replacement)                        |
| `clean-checkout-typecheck` | Bare `npm ci` + typecheck + lint with no prebuilt packages (guards `turbo.json` `^build`)    |
| `dependency-audit`   | npm audit gate: high/critical advisories not allowlisted in `scripts/npm-audit-allowlist.json` fail |
| `chapter-directory-seed` | `supabase/seed/chapter_directory.csv`: canonical `#RRGGBB` colors, real archetypes, no duplicate natural keys |
| `web-tests`          | `apps/web` unit tests plus the shared packages only this suite covers — `packages/hooks`, `packages/chat-core`, `packages/chat-integrations` |
| `changes`            | Computes the path filter that decides whether `web-tests` and `web-responsive-floor` run. Required only because they need it — a required check with a non-required parent can be skipped *and* still count as passing |
| `web-responsive-floor` | Every dashboard route renders without horizontal scroll at 375px, the floor `spec/ui/web-dashboard/README.md` states as a MUST. Playwright, but no baseline and no pixel diff — which is why it could be required, unlike the `web-visual-regression` snapshot job it was split out of (advisory, and since deleted) |
| `dependency-cruiser` | Architectural boundaries: API layer direction, no package→app imports, no cross-app imports, no cycles. Existing violations are grandfathered in `.dependency-cruiser-known-violations.json` |
| `web-production-build` | Builds `apps/web` and `apps/landing` on a `npm ci --omit=dev` tree — the only job that runs the program `next build` type-checks in production. A green preview does not cover this: previews restore a build cache instead of installing cold |
| `duplicate-detection` | jscpd against a repo-wide duplication threshold — **advisory, not merge-blocking** (no clone-level baseline exists; see [`docs/internal/ci-cd/QUALITY_GATES.md`](docs/internal/ci-cd/QUALITY_GATES.md)) |
| `docs-spec-sync`     | Docs/spec sync on the PR diff (`scripts/check-docs-impact.mjs`; no docs app build). A change with genuinely no docs impact can be waived with the `no-doc-change-needed` label |
| `docs-structure`     | Every file under `docs/`/`spec/` sits in a declared home and matches the naming rule (`scripts/check-docs-structure.mjs` against `scripts/ci/lib/docs-structure.mjs`, whole-tree) — **advisory, not merge-blocking yet** (see ‡) |
| `doc-paths`          | Backticked repo-path citations in docs resolve to real files (`scripts/check-doc-paths.mjs`, whole-tree) |
| `doc-refs`           | Bare `docs/`/`spec/` references in files *outside* the docs corpus — source, workflows, migrations, shell — resolve to real files (`scripts/check-doc-refs.mjs`, whole-tree) — **advisory, not merge-blocking yet** (see ‡) |
| `migration-order`    | No migration this change **introduces** sorts before a version staging or production has already applied (`scripts/ci/check-migration-order.mjs`). The CLI refuses that outright rather than reordering — "Found local migration files to be inserted before the last migration on remote database" — which halted staging's deploy in #1373. Reads only head-minus-base, so a change touching no migrations makes zero network calls, and a PR that fixes an ordering problem turns its own check green |
| `migration-drift`    | Staging holds every migration on `main` (`scripts/ci/check-migration-drift-gate.mjs`) — **reports only, no longer required** (see †). Compares `origin/main`, not your PR head |
| `migration-replay`   | The migrations this PR adds actually **apply** to a database rebuilt at production's currently-applied state (`scripts/ci/check-migration-replay.mjs`). `pglite-migrations` applies the corpus from zero, which is a different question; this runs only the pending tail, through the same Supabase CLI path the real deploy uses. Read-only against production. Does real work only when the PR touches `supabase/migrations/**`, so it cannot block a PR over unrelated state |
| `doc-tables`         | Hand-copied required-check rosters and per-job suite lists match `CI_CHECKS` / `DOCS_CHECKS` and `ci.yml` (`scripts/check-doc-tables.mjs`, whole-tree) — **reports only, not yet required** (ROLLOUT‡) |

**Intended vs live.** Every check above is listed in `CI_CHECKS` / `DOCS_CHECKS` in [`scripts/ci/lib/required-checks.mjs`](scripts/ci/lib/required-checks.mjs) — the **intended** required set — except three: `duplicate-detection` (advisory), `doc-tables` (reports only, see ‡) and `migration-drift` (demoted, see †). (`branch-policy` used to be a third. It enforced that a PR into `production` came from `main`, and was deleted with the branch in #1340; the assertion it made now lives in `scripts/ci/validate-deploy-sha.mjs`, which refuses to deploy a commit that is not an ancestor of `main`.) Live branch protection is whatever an admin last applied by running `npm run configure:branch-protection`, and it can lag the script, so this table does not claim per-check whether a gate is live today. Read live state per [`docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md) rather than trusting a doc for it. New gates land report-only and are promoted by adding them to the array and re-running that command — the apply is the human half, with an admin PAT: the bare command is a live `PUT`, and an agent session runs `npm run configure:branch-protection:verify` (which writes nothing) and nothing else.

† `migration-drift` was required and was **demoted** to reporting-only. It asserts that *staging* holds every migration on *main* — a question about two things the PR in front of it neither contains nor can change — so as a required check it is not a gate but a repo-wide merge-freeze switch. #1373 used it as one: a single back-dated migration filename halted staging's apply and made every open PR in the repository unmergeable until a human intervened. Detection is not lost — the scheduled [`check-migration-drift.yml`](.github/workflows/check-migration-drift.yml) runs the same comparison daily across staging *and* production and files a P1 issue that closes itself on recovery, and the PR job keeps running and reporting. What replaced it as a gate is `migration-order`, which asks the same question scoped to what the change introduces, so a PR can actually answer it.

‡ `doc-tables`, `doc-refs` and `docs-structure` report first, like every gate here did. They and `doc-paths` all scan the whole tree rather than the PR diff — a citation breaks when the file it names moves, and a roster goes stale when a *workflow* changes, both on the other side of the reference — so as required checks they can block a PR over a file it never touched. `doc-paths` was added to `DOCS_CHECKS` on 2026-08-21 with that trade accepted — which is intent; it becomes live only when an admin re-runs `npm run configure:branch-protection`. That apply is the human half by policy, with an admin PAT — the bare command is a live `PUT`, and an agent session runs `npm run configure:branch-protection:verify`, which writes nothing. Promote `doc-tables`, `doc-refs` and `docs-structure` the same way once each has run green on `main`. See [`docs/internal/ci-cd/DOCS_CI.md`](docs/internal/ci-cd/DOCS_CI.md).

### Vercel deployment policy

**Not live since 2026-09-02 — no push deploys either Vercel app.** Both projects are unlinked from Git (`frapp-landing` 2026-09-01, `frapp-web` 2026-09-02), so `git.deploymentEnabled` governs nothing today and staging web and landing serve frozen builds. **ADR-21** in [`spec/architecture/README.md`](spec/architecture/README.md) is the canonical record; the CI-driven replacement is designed, not built ([#1578](https://github.com/pdcarlson/Frapp/issues/1578)). The rest of this section describes the settings as they remain committed.

Vercel *was* configured to auto-deploy only on `main` via `git.deploymentEnabled` in each app's `vercel.json`. The catch-all disable rule uses `"**": false` so feature branch names containing `/` are matched correctly and skipped. **Keep both `git.deploymentEnabled` and the `ignoreCommand: "exit 1"` pin — do not delete them as dead config:** they are the versioned form of settings that revert to unversioned dashboard state if Git is ever re-linked. Production deployments are not branch-driven at all: `deploy-production.yml` creates them through the Vercel API with `target: production` for a named commit.

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
  - This runs docs/spec sync (`scripts/check-docs-impact.mjs`), the gitleaks scan, then the CI parity checks (lint, type-check, API tests, contract freshness, migration safety, npm audit). There is no docs build or docs lint step.
  - The docs/spec check runs **first** and a failure aborts the rest, so a pure-code change with no docs impact would never reach lint or the tests. Waive it the same way CI does: `PR_LABELS_JSON='["no-doc-change-needed"]' npm run ci:local-gate` — see [`docs/internal/ci-cd/DOCS_CI.md`](docs/internal/ci-cd/DOCS_CI.md).
- If the docs/spec check needs a different base branch, use: `npm run ci:local-gate -- --base-ref <ref>`
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
