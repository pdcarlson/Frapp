# Environments & CI/CD Specification: Frapp

---

## 1. Environment Matrix

|              | Local                             | Staging                                 | Production                            |
| ------------ | --------------------------------- | --------------------------------------- | ------------------------------------- |
| **Landing**  | localhost:3002                    | Vercel preview / staging.frapp.live     | frapp.live                            |
| **Web App**  | localhost:3000                    | Vercel preview / app.staging.frapp.live | app.frapp.live                        |
| **API**      | localhost:3001                    | Render (`main` branch service)          | Render (deployed by commit id)        |
| **Mobile**   | Expo Go (local network)           | EAS internal distribution               | App Store / Google Play               |
| **Database** | Supabase local (`supabase start`) | Supabase staging project                | Supabase production project           |
| **Auth**     | Supabase Auth (local)             | Supabase Auth (staging project)         | Supabase Auth (production project)    |
| **Storage**  | Supabase Storage (local)          | Supabase Storage (staging project)      | Supabase Storage (production project) |
| **Stripe**   | Test mode (`sk_test_`)            | Test mode (`sk_test_`)                  | Live mode (`sk_live_`)                |
| **Push**     | Expo Go (dev)                     | EAS internal builds                     | Production builds                     |

Each Supabase project (local, staging, production) is fully isolated: separate database, auth users, storage buckets, and API keys. Both Vercel projects are unlinked from Git (ADR-21), so the staging Landing and Web App hosts are deployed by CI rather than by a push — see §6 **Web and Landing (Vercel)**.

### Branch-to-environment mapping

| Branch      | Purpose                              | Deployment behavior                                    |
| ----------- | ------------------------------------ | ------------------------------------------------------ |
| `main`      | Pre-production / staging integration | Green CI on `main` triggers the Render staging deploy and the Vercel staging deploys (`deploy-vercel-staging.yml`, #1578). Push-triggered Vercel Previews were retired with the Git unlink (ADR-21) — see §6 |
| `feature/*` | Short-lived feature work             | No automatic Vercel deployments; merged into `main`    |

Production is **not** mapped to a branch. It is deployed by running the **Deploy
production** workflow against a named commit, which must already be an ancestor of `main`
with green CI. The `production` branch that used to occupy this table was retired in
#1340.

---

## 2. Local Development

### Prerequisites

- Node.js at or above the root `package.json` `engines.node`, which is the one statement of the floor. `.nvmrc`, CI's `node-version:` and `apps/api/Dockerfile` pin only the major, so whichever release of it they land on (an older install under `nvm use`, the runner's cached toolchain, a cached image layer) can sit below the floor. Check `node -v` against `engines.node`.
- npm v10+
- Docker available to your shell (Docker Desktop with **WSL integration** on Windows/WSL, or Docker Engine on Linux)
- Supabase CLI (`npx supabase`)
- Expo Go app on iOS/Android device

### Setup

**One-shot bootstrap (recommended on WSL/Ubuntu):** from the repo root, with Docker already running:

```bash
bash scripts/local-dev-setup.sh
# Skip typecheck / migration-safety for a faster loop:
# bash scripts/local-dev-setup.sh --quick
# Stuck or exited Supabase containers (this repo only; keeps volumes):
# bash scripts/local-dev-setup.sh --reset-supabase
# Wipe local Supabase data volumes (destructive; confirm in terminal):
# bash scripts/local-dev-setup.sh --reset-supabase-data
```

The script runs `npm install`, `npx supabase start`, `npx supabase db push --local`, the local Postgres default-ACL repair (fatal if it fails; `FRAPP_SKIP_ACL_REPAIR=1` overrides), optional validation, then prints **`npm run dev:stack`** (and pointers to [`docs/internal/environment/LOCAL_DEV.md`](../../docs/internal/environment/LOCAL_DEV.md)). It does **not** start `dockerd` (the Claude Code cloud sandbox does — see [`CLOUD_SANDBOX.md`](../../docs/internal/environment/CLOUD_SANDBOX.md)). It does **not** stop unrelated Docker containers—only this project’s Supabase CLI stack. If `supabase start` fails in an interactive shell, it may prompt once to run `supabase stop` and retry (volumes preserved).

**Manual sequence** (equivalent):

```bash
# 1. Install dependencies
npm install

# 2. Start Supabase local (Postgres, Auth, Storage, Realtime)
npx supabase start

# 3. Apply database migrations (--local targets the local Supabase instance)
npx supabase db push --local

# 4. Repair the local Postgres default ACLs. The pinned supabase/postgres image ships
#    schema `public` without DML grants for anon/authenticated/service_role, so skipping
#    this leaves every API query failing with `42501 permission denied for table ...`.
#    Not needed if you ran scripts/local-dev-setup.sh above — it does this for you.
. scripts/lib/local-postgres-acl.sh && frapp_repair_local_acls "$PWD" npx supabase

# 5. Start apps — default (with Infisical — see docs/internal/environment/LOCAL_DEV.md):
npm run dev:stack
# Per-app, no Infisical, Turbo caveats: docs/internal/environment/LOCAL_DEV.md
```

### Environment Variables

If you are not using Infisical CLI injection, create a `.env.local` file for each app. Local Supabase keys come from `npx supabase status -o env`.

See **[`docs/internal/environment/ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md)** for the complete list of every variable, per app, per environment.

**Alternative (Infisical CLI):** Skip `.env.local` files entirely by injecting from Infisical:

```bash
npx infisical run --env=dev -- npm run start:dev -w apps/api
```

### Accessing Services

Ports and URLs for web, API, Swagger, landing and Supabase Studio: [`docs/internal/environment/LOCAL_DEV.md`](../../docs/internal/environment/LOCAL_DEV.md) § Ports and URLs.

### Running Mobile

```bash
cd apps/mobile
npm start
```

Scan the QR code with Expo Go. Phone and PC must be on the same network.

### Updating the API Contract

After changing an API endpoint, regenerate and commit both contract artifacts. Commands, the committed artifacts, and the CI freshness check: [`../architecture/README.md`](../architecture/README.md) § 10 API Contract Strategy.

---

## 3. Staging

- **Purpose:** QA, stakeholder demos, mobile TestFlight/internal builds.
- **Git branch:** `main` — pushes trigger staging/pre-production deployments.
- **Supabase:** Dedicated staging project (separate from production). Create via Supabase dashboard or CLI.
- **Web / Landing:** Vercel Preview deployments with staging domains (`app.staging.frapp.live`, `staging.frapp.live`). Both projects are unlinked from Git (ADR-21), so no push produces a preview; `deploy-vercel-staging.yml` builds and uploads them after CI succeeds on `main`, then aliases both hostnames (#1578) — see §6 **Web and Landing (Vercel)**.
- **API:** Render staging service (`frapp-api-staging`), auto-deploys from `main`, pointing at Supabase staging.
- **Mobile:** EAS internal distribution builds (`eas build --profile preview`).
- **Stripe:** Test mode keys (`sk_test_`).
- **Data:** May contain seed data. Never production user data.

---

## 4. Production

- **Git branch:** none. Production is deployed from a **named commit on `main`** by
  `.github/workflows/deploy-production.yml` (`workflow_dispatch`, typed confirmation,
  and the `production` environment's Required reviewers).
- **Supabase:** Dedicated production project. Fully isolated users, database, storage.
- **Web App:** `app.frapp.live` (Vercel, production deployment created by the workflow, which
  builds the named commit on the runner with `vercel build --prod` and uploads it with
  `vercel deploy --prebuilt --prod`). The guardrail preflight stopped blocking the dispatch with
  #1579, and #1578 replaced the `gitSource` call the retired integration used to serve. See §6
  **Web and Landing (Vercel)**.
- **Landing:** `frapp.live` (Vercel, same).
- **API:** Render production service (`frapp-api-prod`), deployed by commit id through
  the Render API, pointing at Supabase production + Stripe live keys. Render-side
  auto-deploy must stay **off** — `scripts/ci/production-guardrails.mjs` asserts it.
- **Mobile:** App Store and Google Play via EAS Submit.
- **Stripe:** Live mode (`sk_live_`). Requires business verification (KYC) before launch.
- **Monitoring:** Error tracking (Sentry or equivalent), structured logging, uptime checks.

> **Full setup walkthrough:** See [`docs/internal/ops/deployment/`](../../docs/internal/ops/deployment/) for step-by-step instructions covering Vercel, Render, Supabase, EAS, DNS, and environment variables.

---

## 5. Continuous Integration (CI)

CI runs as domain-specific parallel jobs on every PR to `main`. Each job is an independent required status check — failures are visible per domain, not hidden behind a single monolith gate.

### CI Job Matrix

The roster is not restated here. Every check name, what it validates, and whether it blocks a merge
or only reports are in
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md)
**§ Required Status Checks** — the single hand-kept copy of the `CI_CHECKS` / `DOCS_CHECKS` /
`DRIFT_CHECKS` arrays in
[`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs). **Nothing asserts
that copy.** `npm run check:doc-tables` used to compare the two; it was deleted along with the other
docs gates, so the roster now stays true only because whoever edits the arrays remembers to edit the
runbook in the same change. Where they disagree, `required-checks.mjs` is the source and the runbook
is the stale one. What follows is the CI *model* those checks implement.

`web-tests` and `web-responsive-floor` are **path-gated and still required**, which is only a contradiction if you assume a skip blocks. It does not: GitHub reports a job skipped by a *job-level* conditional as *Success*, and `success` / `skipped` / `neutral` all satisfy a required check. `changes` is required for a different and less obvious reason — a required check whose `needs:` parent fails is skipped and *may not block merging*, so a non-required parent would leave both satisfiable without ever running. See the ADR-15 amendment in [`../architecture/adr/adr-15.md`](../architecture/adr/adr-15.md) and the comments in [`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs).

The runbook's roster states the *intended* set — every entry in it is a line in `CI_CHECKS` /
`DOCS_CHECKS` / `DRIFT_CHECKS` in [`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs),
with no exceptions in that direction — `buildProtectionPayload` appends nothing to the roster, it PUTs the arrays as
they stand. (`branch-policy` was the exception this paragraph used to name. It was deleted with the
`production` branch in #1340.)
Live branch protection is whatever an admin last applied and can lag the script, so no doc claims
per-check whether a gate is live today; read live state per
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).

`pglite-migrations` is also path-gated, and required since #2538. `duplicate-detection` is advisory, for the reason in [`QUALITY_GATES.md` § The gates, and why each has the posture it does](../../docs/internal/ci-cd/QUALITY_GATES.md#the-gates-and-why-each-has-the-posture-it-does).

There was a second advisory job, `web-visual-regression`, and it has been **deleted**. It compared each dashboard route against a committed PNG; its exemption was specifically about pixels, since baselines pinned to CI's Chromium build drift with it. The 375px floor gate used to live in the same job and inherited that exemption by directory despite storing no baseline and comparing no pixels — #1152 split it into the required `web-responsive-floor` above, and the snapshot job was later removed along with its spec, its baselines and the `test:visual` script.

### Environment identity

Each environment's Supabase project ref is recorded in
[`.github/environments.json`](../../.github/environments.json), read through
`scripts/ci/lib/environments.mjs`. Refs are **not secrets** — they are already published in
[`DB_ROLLBACK_PLAYBOOK.md`](../../docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md) and
[`CLOUD_SANDBOX.md`](../../docs/internal/environment/CLOUD_SANDBOX.md), and one grants nothing without
`SUPABASE_ACCESS_TOKEN`. Committing them is what makes an assertion possible: `scripts/run-migration.mjs`
compares the ref Infisical injected against the one this file records for `--env`, and **fails closed on a
mismatch before any `link` or `push`**. Before that existed, `--env` was validated, printed, and then
dropped — `--env staging` and `--env production` were the same program, so a mis-scoped Infisical folder
would have applied migrations to production while every log line said staging.

Two consequences worth holding together:

- **Rotating a project touches every file that names its ref**, not only `.github/environments.json` — see
  [`DB_ROLLBACK_PLAYBOOK.md` § Backup reality](../../docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md#backup-reality).
  Missing the file blocks every production migration and fails `migration-order` on every
  migration-bearing PR.
- **`check-migration-drift.yml` deliberately still reads its refs from Infisical.** Pointing it at the
  committed file too would make the pair agree by construction, and the fence would assert nothing.

### Additional checks outside `ci.yml`

The docs workflows (`docs.yml`, `links.yml`) and what each of their jobs checks:
[`DOCS_CI.md` § What runs](../../docs/internal/ci-cd/DOCS_CI.md#what-runs). The migration checks —
which workflow runs them, which are required, what each validates, and why `migration-drift` was
demoted out of `DRIFT_CHECKS` — are in
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md` § Required Status Checks](../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md#required-status-checks).

Four docs gates used to run here — `docs-structure`, `doc-paths`, `doc-refs` and `doc-tables` — and
all four are **deleted**, with their scripts, their allowlists and their `check:doc-*` npm scripts.
`doc-paths` was the only one ever promoted to required, which is why `DOCS_CHECKS` is now an empty
array; the comment on that array in
[`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs) records the trade,
and what replaced them is the standard in
[`DOCUMENTATION_CONVENTIONS.md`](../../docs/internal/DOCUMENTATION_CONVENTIONS.md) plus the docs
angle in `.claude/skills/diff-review/angles.md`. No gate reads the docs corpus for documentation
defects now. `link-check` still resolves its links and anchors, and `env-slugs` still walks every
`.md` under `docs/` and `spec/` for `--env=` slugs — neither says whether a claim is true.

**Code review is a repository-managed Git pre-push gate, not a CI check.** Frapp's gate is **`/diff-review`**. The root `prepare` script (and, in a Claude Code cloud session, the SessionStart hook) installs [`.githooks/pre-push`](../../.githooks/pre-push) through `core.hooksPath`, so local Codex, cloud agents, and humans share one mechanism. Every non-deletion ref update that publishes unreviewed work requires evidence for its exact pushed commit at `.cache/diff-review/<PUSHED_COMMIT_SHA>`; retrying cannot satisfy it. Git guarantees that the hook's nonzero exit aborts the push when installed, but `--no-verify`, a changed hooks path, or skipped installation bypass it, so it is not an unconditional server-side gate. Details live in the [review runbook](../../docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md).

- Merge-time review requirements on `main` (approving reviews, conversation resolution), and why no branch is stricter: [`CONTRIBUTING.md` § PR review requirement policy](../../CONTRIBUTING.md#pr-review-requirement-policy).
- Full runbook: [`AI_CODE_REVIEW_RUNBOOK.md`](../../docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md).

### Key Design Decisions

- **The frontend build gate is production-shaped, not preview-shaped.** `web-production-build` builds `apps/web` and `apps/landing` under `npm ci --omit=dev`, matching Vercel's production install, because nothing in CI ran `next build` before #1374 and that gap took production down twice (#1331, #1372). Staging frontends are still verified through Vercel preview deployments off `main`; production deployments are created by `deploy-production.yml`. The build-shape difference between the two is a recorded trade-off — ADR-20 decision 3. **The staging half of that has not run since the unlink** (landing 2026-09-01, web 2026-09-02): with both Vercel projects unlinked from Git (ADR-21) no push produces a preview, so no Vercel build of either frontend happens on merge any more — see §6 **Web and Landing (Vercel)**.
- **No placeholder secrets.** CI never sets `NEXT_PUBLIC_SUPABASE_URL` or similar to dummy values. All env-dependent builds happen in the provider (Vercel/Render).
- **The API contract check regenerates; it is not a git-diff heuristic.** `npm run check:api-contract` (`scripts/check-api-contract-drift.mjs`) builds the shared packages, rebuilds `apps/api/openapi.json` and `packages/api-sdk/src/types.ts`, and fails on any difference from the committed copies — the git-diff heuristic it replaced false-positived on contract-neutral controller edits. The Swagger export does bootstrap NestJS, but only to build the document, so placeholder credentials suffice and no Supabase/Stripe secrets are needed in CI. Details: [`../architecture/README.md`](../architecture/README.md) § 10 API Contract Strategy.
- **Mobile CI is lint, typecheck and unit tests** (`mobile-validate` in `ci.yml`: `npm run lint`, `check-types`, `test` for `apps/mobile`) — no native build. EAS builds are expensive and slow; they run on-demand, not per-PR.

If any required check fails, the PR cannot be merged. Branch protection rules enforce this for all users, including admins.

---

## 6. Continuous Deployment (CD)

> **Current state (2026-09-04) — Vercel deploys run from CI.** Both Vercel projects were
> deliberately unlinked from Git (landing 2026-09-01, web 2026-09-02), so no push produces a
> deployment and nothing about this section depends on the Git integration any more. The three
> repairs that took: **#1579** (2026-09-02) inverted the production-guardrails Vercel assertion to
> require the *absence* of a Git link and removed `verify-deployments.yml`'s two Vercel verify jobs;
> **#1578** (2026-09-04) built the replacement deploys — `vercel build` on the runner, then
> `vercel deploy --prebuilt`, for both staging and production. Render **staging** (the
> `deploy-api.yml` push path) and EAS were unaffected throughout. **ADR-21** in
> [`../architecture/adr/adr-21.md`](../architecture/adr/adr-21.md) is the canonical record of the unlink,
> the freeze points and the repairs.

Staging deploy steps are gated by CI: after CI succeeds on `main`, `deploy-api.yml` runs database migrations and triggers the Render staging deploy, and `deploy-vercel-staging.yml` builds and uploads web and landing. Nothing about production is push-triggered — `deploy-production.yml` creates the Render deploy and both Vercel production deployments itself, for a commit a human named.

### Deploy Pipeline (on merge)

```text
staging:     merge to main → CI passes → DB migration (dry-run then apply) → API deploy (Render)
             → in parallel, deploy-vercel-staging.yml: vercel build + deploy --prebuilt
               (web then landing), then alias the staging hostnames
production:  dispatch a SHA → validate (ancestor of main + CI green) → provider preflight
             → migration replay → apply → Render deploy by commit → vercel build --prod
             + deploy --prebuilt --prod → tag
```

Production deployments run only when a human dispatches **Deploy production** with a
commit SHA, types the confirmation phrase, and approves the `production` environment.
That environment approval is now the **single** human gate — it replaced the promotion
PR's required review, and it fires at the moment of deploy rather than before anyone
knew whether the migration applied. Evidence that the environment gate really does pause
jobs is in `docs/internal/ci-cd/AGENT_INFRA.md` § GitHub environments and bootstrap
secrets.

### Web and Landing (Vercel)

> **Current state (2026-09-04) — both projects are unlinked from Git** (Vercel reports
> `link: null` for both) and **all deploys come from CI**. **ADR-21** in
> [`../architecture/adr/adr-21.md`](../architecture/adr/adr-21.md) is the canonical record of the unlink,
> the per-project freeze points and the repairs; **#1579** (2026-09-02) fixed the guardrails half
> and **#1578** (2026-09-04) built the deploys described below.

- **Staging:** `deploy-vercel-staging.yml` runs after CI succeeds on `main` (a `workflow_run`
  trigger, like `deploy-api.yml` — a push trigger would deploy before CI finished). It runs
  `vercel pull --environment=preview`, `vercel build`, then `vercel deploy --prebuilt` for web
  and then landing, and finally points `app.staging.frapp.live` and `staging.frapp.live` at the
  new deployments. Nothing is push-triggered on Vercel any more.
- **Production** deployments are **created by the workflow**, not by a push: a fresh build of
  the named commit with `vercel build --prod`, so it compiles against Production
  environment variables. Promoting a staging build instead would ship a bundle with the
  staging API URL and staging Supabase keys inlined at build time.
- Every deployment CI creates is stamped `--meta githubCommitSha=<sha>`. A `--prebuilt`
  upload carries no git metadata of its own, and the named-commit guarantee (ADR-19), the
  staging-alias lookup and the observer's per-branch supersession test all read it back.
- Web and landing build **sequentially** in one job: `vercel build` writes `.vercel/output`
  into the working tree, so two concurrent builds in one checkout would overwrite each other.
- Feature/PR branches do not deploy on Vercel.
- **`git.deploymentEnabled` and `ignoreCommand: "exit 1"` in both `vercel.json` files are now
  inert** — they govern the Git integration's build pipeline, and there is no integration.
  They are **kept deliberately** (ADR-21: *do not delete either key*): they are the versioned
  form of settings that are otherwise dashboard-only, so re-linking Git must not find them
  missing. `ignoreCommand` originally replaced `npx turbo-ignore <app>`, which skipped a
  production release by diffing it against the `main` preview of the same commit
  (run 33275321347); that reasoning governs again the moment the integration is restored.
- Vercel detects the monorepo structure from each project's Root Directory, which
  `vercel pull` fetches into `.vercel/` before the build.

### API (Render)

- API deploys are gated behind CI success using `workflow_run` triggers.
- Production: a human dispatches **Deploy production** with a commit SHA → the workflow calls the Render API with that `commitId` (no deploy hook, and no push involved).
- Push to `main` (after CI) → GitHub Actions triggers Render staging deploy hook.
- Render builds the Docker image from `apps/api/Dockerfile` and performs zero-downtime swap.
- Database migrations run automatically before deploy (see Section 8).
- See `render.yaml` for the infrastructure-as-code definition.

### Mobile (EAS)

- **Production build:** `eas build --platform all --profile production`.
- **Preview build (staging):** `eas build --platform all --profile preview`.
- **OTA updates: the client is installed, and nothing publishes to it yet** (#2526, ADR-24 decision 8). Every build carries `expo-updates` with `runtimeVersion: { policy: "appVersion" }`, a `channel` named after its build profile (`apps/mobile/eas.json`), and `checkAutomatically: "ON_LOAD"` with no wait, so with nothing published an app runs the bundle it was built with. An update published for runtime `0.9.0` reaches every build of `0.9.0`, so every build whose native code changes needs a new `expo.version` (see **Native changes** below). Two builds of one version with different native code would both take an update built against the newer one, and the older would crash on a missing module; if that has already happened, raise `MOBILE_MIN_VERSION_*` past the older build before publishing. The `fingerprint` policy was considered and rejected (2026-09-24): it hashes the resolved config, which carries per-build values (`extra.gitSha` from `EAS_BUILD_GIT_COMMIT_HASH`, and the contents of `google-services.json` on Android), so an update published anywhere but the build worker would silently never match a shipped binary. A `fingerprint.config.js` could drop both (`SourceSkips.ExpoConfigExtraSection` for `extra`, an `ignorePaths` entry for the Android file), but that is a hand-kept list of every config input that varies by environment: miss one later and the match breaks, with nothing to show it until an update fails to reach a binary that can't be changed. A version bump is a rule a pipeline can check (#2511). There is no `eas update` pipeline and no `EXPO_TOKEN` in CI. Don't run `eas update` by hand before one exists: it ignores `eas.json`'s build `env`, so the published bundle would fall back to `http://localhost:3001` and tag Sentry `development` (#2504 digest 06, which lists the other traps). It also evaluates `apps/mobile/app.config.js` with no `EAS_BUILD_PROFILE`, so every fence there that keys on a profile (production URLs and keys, the Android google-services check, the client-key allowlist, Ask) is skipped and only the secret-key check runs. The pipeline (#2511) has to set a profile, and then supply what those fences expect: a `production` profile counts as Android unless `EAS_BUILD_PLATFORM` is `ios`, so an Android or platform-less run also needs the google-services file, or config evaluation stops.
- **Minimum version:** every native build sends `X-Client-Version` and asks `GET /v1/client-policy` at launch and on return to the foreground; a build below the API's `MOBILE_MIN_VERSION_*` sees a blocking update screen. That, not OTA, is how an old binary is retired. Setting a minimum: [`ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md) § API-Only Settings; behaviour: [`spec/ui/mobile/patterns.md`](../ui/mobile/patterns.md) § Minimum version.
- **Native changes:** bump `expo.version` in `apps/mobile/app.json` first (the OTA runtime is keyed to it), then a full build + App Store / Google Play submission via `eas submit`.

### Deploy Ordering

**Default:** Vercel (frontends) and Render (API) deployments run in parallel after merge — as two workflows both gated on CI success (`deploy-vercel-staging.yml` and `deploy-api.yml`) since #1578 restored the Vercel half; see §6 **Web and Landing (Vercel)**. Database migrations always run before the API deploy (enforced by the deploy workflow's job dependency chain).

**Exception — breaking API changes:** When compatibility is not maintained, split the change into PRs and ship them in this order:

1. Merge/deploy the backward-compatible API PR first.
2. Verify the API health check passes.
3. Merge frontend follow-up PRs only after API verification.

Because a merge to `main` deploys the frontends once CI passes, hold frontend merges until the API is confirmed healthy. No Vercel deploy is push-*triggered* since the ADR-21 unlink, but #1578 restored the automatic path through `deploy-vercel-staging.yml`, so this ordering rule governs again: the gap between merge and deployed frontend is now CI plus a build, not indefinite. Breaking changes must be documented in the PR description and flagged for manual coordination. Use backward-compatible migration patterns wherever possible to avoid this scenario.

### Release labels for version tags

Version bumps are derived from the `release:*` labels on **every PR merged since the last
`v*` tag**, taking the highest. The label belongs on each ordinary PR — there is no
promotion PR to carry it any more.

- No release label on any PR in range → patch bump
- Any `release:minor` in range → minor bump
- Any `release:major` in range → major bump

The **Deploy production** dispatch also accepts an explicit `bump` input that overrides
the scan. The tag is created *after* Render and Vercel report healthy, so a `v*` tag
names a commit that is live.

---

## 7. Secret Management

Secrets are centrally managed in **Infisical** (free tier) with automatic syncs to deployment providers. This provides a single source of truth for all environment variables across all environments.

### Infisical Setup

| Property         | Value                                                  |
| ---------------- | ------------------------------------------------------ |
| **Project**      | Frapp                                                  |
| **Environments** | Named by slug, not display name — [`ENV_REFERENCE.md` § Infisical Environments](../../docs/internal/environment/ENV_REFERENCE.md#infisical-environments) |
| **Syncs**        | Not restated here — the live inventory, and why GitHub Actions is not a sync, is [`SECRETS_MANAGEMENT.md` § 5](../../docs/internal/environment/SECRETS_MANAGEMENT.md#5-configure-secret-syncs) |

### How It Works

Canonical values (e.g., `SUPABASE_URL`) are stored **once** per Infisical environment. Framework-specific names (e.g., `NEXT_PUBLIC_SUPABASE_URL`) are **secret references** that resolve to the canonical value automatically. No duplication.

See **[`docs/internal/environment/ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md)** for the complete variable list and **[`docs/internal/environment/SECRETS_MANAGEMENT.md`](../../docs/internal/environment/SECRETS_MANAGEMENT.md)** for the setup guide.

### Bootstrap Secrets (GitHub only)

Two GitHub secrets bootstrap the Infisical connection:

| Secret                          | Purpose                                           |
| ------------------------------- | ------------------------------------------------- |
| `INFISICAL_MACHINE_IDENTITY_ID` | Universal-auth machine identity for Infisical      |
| `INFISICAL_CLIENT_SECRET`       | Client Secret for Infisical machine identity auth |

Other GitHub secrets (the provider API keys, the release PAT, the base-sync App pair) sit beside
them. Every GitHub secret belongs to an **environment** restricted to `main`, never to repository scope. A
repository secret is readable from any branch, because a branch's own workflow definitions run on
its pushes and pull requests (#2518). Nothing a pull request triggers reads a secret. Roster,
environments and current state:
`docs/internal/ci-cd/AGENT_INFRA.md` § GitHub environments and bootstrap secrets.

### Local Development

**Primary method (no `.env.local` files):**

```bash
npx infisical login       # One-time setup
npm run dev:stack         # Default: API + web + landing (repo root)
```

Per-app Infisical commands, mobile, and no-Infisical fallback: **[`docs/internal/environment/LOCAL_DEV.md`](../../docs/internal/environment/LOCAL_DEV.md)**.

### Rules

- **Never** commit secrets. **Never** log secrets. Rotate keys immediately if exposed.
- **No placeholder secrets in CI.** CI does not build apps that require runtime secrets.
- **No environment suffixes**: one name per secret, its value differing per Infisical environment ([`SECRETS_MANAGEMENT.md` § Key Design Principles](../../docs/internal/environment/SECRETS_MANAGEMENT.md#key-design-principles)).

---

## 8. Database Migrations

### Local Development

Creating and applying a migration locally: [`CONTRIBUTING.md` § Database Migrations](../../CONTRIBUTING.md#database-migrations). Rebuilding the local database from scratch, and what that drops: [`docs/guides/database.md` § 2. Schema location](../../docs/guides/database.md#2-schema-location).

### Remote (Staging / Production)

Two workflows exist for pushing migrations to remote projects:

- **One-shot (CI/CD):** `npx supabase db push --project-ref <REF>` — no persistent link needed.
- **Interactive (developer):** `npx supabase link --project-ref <REF>` followed by `npx supabase db push` — link persists in `.supabase/`.

### Automated Migrations (CI/CD)

Migrations run automatically as part of the deploy pipeline, after CI passes and before app deployments:

1. **Pre-flight validation** (CI): `check:migration-safety` validates filenames and promotion docs; `scripts/ci/check-migration-order.mjs` validates ordering.
2. **Dry run** (CD): `supabase db push --dry-run` shows what will change before applying.
3. **Apply** (CD): `supabase db push` applies pending migrations.
4. **Failure handling**: If migration fails, the pipeline stops — no app deploy happens.
5. **Production gate**: ONE gate, deliberately. The `production` environment's Required
   reviewers pause `deploy-production.yml` before it applies anything. There used to be
   two — the `main` → `production` promotion PR's required review, and then this approval
   after merge on a click nobody was paged for. The promotion PR went with the branch
   (#1340); the environment approval stayed, because it is the one that happens while a
   human is actually looking at the run. Evidence that it pauses jobs (it held a
   one-migration apply for 29m52s) is in `docs/internal/ci-cd/AGENT_INFRA.md` § GitHub
   environments and bootstrap secrets.
6. **Production rehearsal**: before applying, `deploy-production.yml` runs
   `scripts/ci/check-migration-replay.mjs` against production's live applied state —
   rebuilding it on a disposable stack and running the pending tail through the same CLI
   path. A rehearsal that finds nothing pending verified nothing, and the run's summary
   says which it was.

### Safety Rules

- Migration files live in `supabase/migrations/`.
- Migrations are version-controlled and applied in order.
- Filenames must match pattern: `YYYYMMDDHHMMSS_snake_case_name.sql`.
- Breaking schema changes require a migration plan (backward-compatible where possible; coordinate with API deploys).
- Every migration should have a documented rollback strategy in `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`.
- See `docs/internal/ops/deployment/` for the full migration deployment workflow.

## Claude Code web

Frapp's cloud agent environment is **Claude Code web** (ADR-16 amendment 10). Public contract: Setup script `scripts/cloud-sandbox-setup.sh` plus SessionStart, which launches the bringup in `scripts/cloud-sandbox-up.sh`. Full configuration and failure troubleshooting: [`docs/internal/environment/CLOUD_SANDBOX.md`](../../docs/internal/environment/CLOUD_SANDBOX.md). Agent instructions: [`AGENTS.md`](../../AGENTS.md).

## Scheduled backlog agents

**Claude Code Routines** are the scheduled path. Canonical prompts, cron, and enable notes: [`docs/internal/ci-cd/ROUTINES.md`](../../docs/internal/ci-cd/ROUTINES.md). Do not restate liveness here. Linear stays retired (ADR-16 amendment 5).
