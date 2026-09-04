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

Each Supabase project (local, staging, production) is fully isolated: separate database, auth users, storage buckets, and API keys. The staging Landing and Web App cells describe the intended model: as of 2026-09-02 both Vercel projects are unlinked from Git (ADR-21), so those two hosts are frozen at their last Git build — see §6 **Web and Landing (Vercel)**.

### Branch-to-environment mapping

| Branch      | Purpose                              | Deployment behavior                                    |
| ----------- | ------------------------------------ | ------------------------------------------------------ |
| `main`      | Pre-production / staging integration | Triggers staging and Vercel Preview domain deployments — Vercel Preview retired (ADR-21; landing 2026-09-01, web 2026-09-02), see §6 |
| `feature/*` | Short-lived feature work             | No automatic Vercel deployments; merged into `main`    |

Production is **not** mapped to a branch. It is deployed by running the **Deploy
production** workflow against a named commit, which must already be an ancestor of `main`
with green CI. The `production` branch that used to occupy this table was retired in
#1340.

---

## 2. Local Development

### Prerequisites

- Node.js v18+
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

The script runs `npm install`, `npx supabase start`, `npx supabase db push --local`, the local Postgres default-ACL repair (fatal if it fails; `FRAPP_SKIP_ACL_REPAIR=1` overrides), optional validation, then prints **`npm run dev:stack`** (and pointers to [`docs/internal/environment/LOCAL_DEV.md`](../../docs/internal/environment/LOCAL_DEV.md)). It does **not** start `dockerd` (the Claude Code cloud sandbox does — see below). It does **not** stop unrelated Docker containers—only this project’s Supabase CLI stack. If `supabase start` fails in an interactive shell, it may prompt once to run `supabase stop` and retry (volumes preserved).

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
- **Web / Landing:** Vercel Preview deployments with staging domains (`app.staging.frapp.live`, `staging.frapp.live`), filtered to the `main` branch. **Not running as of 2026-09-02:** both Vercel projects are unlinked from Git (ADR-21), so no push produces a preview and both staging hosts are frozen at their last Git build — see §6 **Web and Landing (Vercel)**.
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
- **Web App:** `app.frapp.live` (Vercel, production deployment created by the workflow
  through the API with `target: production`) — the guardrail preflight no longer blocks the
  dispatch (#1579, 2026-09-02), but the workflow's Vercel step still passes a `gitSource` that
  needs the retired integration, so the production Vercel deploy is expected to fail until #1578.
  See §6 **Web and Landing (Vercel)**, 2026-09-02.
- **Landing:** `frapp.live` (Vercel, same).
- **API:** Render production service (`frapp-api-prod`), deployed by commit id through
  the Render API, pointing at Supabase production + Stripe live keys. Render-side
  auto-deploy must stay **off** — `scripts/ci/production-guardrails.mjs` asserts it.
- **Mobile:** App Store and Google Play via EAS Submit.
- **Stripe:** Live mode (`sk_live_`). Requires business verification (KYC) before launch.
- **Monitoring:** Error tracking (Sentry or equivalent), structured logging, uptime checks.

> **Full setup walkthrough:** See [`docs/internal/ops/DEPLOYMENT.md`](../../docs/internal/ops/DEPLOYMENT.md) for step-by-step instructions covering Vercel, Render, Supabase, EAS, DNS, and environment variables.

---

## 5. Continuous Integration (CI)

CI runs as domain-specific parallel jobs on every PR to `main`. Each job is an independent required status check — failures are visible per domain, not hidden behind a single monolith gate.

### CI Job Matrix

The roster is not restated here. Every check name, what it validates, and whether it blocks a merge
or only reports are in
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md)
**§ Required Status Checks** — the single hand-kept copy of the `CI_CHECKS` / `DOCS_CHECKS` /
`DRIFT_CHECKS` arrays in
[`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs), and the one
`npm run check:doc-tables` asserts. What follows is the CI *model* those checks implement.

`web-tests` and `web-responsive-floor` are **path-gated and still required**, which is only a contradiction if you assume a skip blocks. It does not: GitHub reports a job skipped by a *job-level* conditional as *Success*, and `success` / `skipped` / `neutral` all satisfy a required check. `changes` is required for a different and less obvious reason — a required check whose `needs:` parent fails is skipped and *may not block merging*, so a non-required parent would leave both satisfiable without ever running. See the ADR-15 amendment in [`../architecture/README.md`](../architecture/README.md) and the comments in [`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs).

The runbook's roster states the *intended* set — every entry in it is a line in `CI_CHECKS` /
`DOCS_CHECKS` / `DRIFT_CHECKS` in [`scripts/ci/lib/required-checks.mjs`](../../scripts/ci/lib/required-checks.mjs),
with no exceptions — `buildProtectionPayload` appends nothing to the roster, it PUTs the arrays as
they stand. (`branch-policy` was the exception this paragraph used to name. It was deleted with the
`production` branch in #1340.)
Live branch protection is whatever an admin last applied and can lag the script, so no doc claims
per-check whether a gate is live today; read live state per
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md).

`pglite-migrations` is also path-gated but remains **advisory**. `duplicate-detection` is advisory for a different reason: jscpd has no clone-level baseline, so its only lever is a repo-wide percentage that cannot tell one bad copy-paste from ordinary drift. Postures and their rationale: [`docs/internal/ci-cd/QUALITY_GATES.md`](../../docs/internal/ci-cd/QUALITY_GATES.md).

There was a third advisory job, `web-visual-regression`, and it has been **deleted**. It compared each dashboard route against a committed PNG; its exemption was specifically about pixels, since baselines pinned to CI's Chromium build drift with it. The 375px floor gate used to live in the same job and inherited that exemption by directory despite storing no baseline and comparing no pixels — #1152 split it into the required `web-responsive-floor` above, and the snapshot job was later removed along with its spec, its baselines and the `test:visual` script.

### Environment identity

Each environment's Supabase project ref is recorded in
[`ci/environments.json`](../../ci/environments.json), read through
`scripts/ci/lib/environments.mjs`. Refs are **not secrets** — they are already published in
[`DB_ROLLBACK_PLAYBOOK.md`](../../docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md) and
[`CLOUD_SANDBOX.md`](../../docs/internal/environment/CLOUD_SANDBOX.md), and one grants nothing without
`SUPABASE_ACCESS_TOKEN`. Committing them is what makes an assertion possible: `scripts/run-migration.mjs`
compares the ref Infisical injected against the one this file records for `--env`, and **fails closed on a
mismatch before any `link` or `push`**. Before that existed, `--env` was validated, printed, and then
dropped — `--env staging` and `--env production` were the same program, so a mis-scoped Infisical folder
would have applied migrations to production while every log line said staging.

Two consequences worth holding together:

- **Rotating a project is a four-place change** — Infisical, `ci/environments.json`, and the two doc tables
  above. Missing the file blocks every production migration and fails `migration-order` on every
  migration-bearing PR. The playbook's ref table says so where the tables live.
- **`check-migration-drift.yml` deliberately still reads its refs from Infisical.** Pointing it at the
  committed file too would make the pair agree by construction, and the fence would assert nothing.

### Additional Docs Checks

`docs-structure`, `doc-paths`, `doc-refs` and `doc-tables` run in `.github/workflows/docs.yml`;
`migration-order`, `migration-drift` and `migration-replay` run in
`.github/workflows/migration-drift-gate.yml`. Which of them are required, what each validates, and
why `migration-drift` was demoted out of `DRIFT_CHECKS` are in
[`GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](../../docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md)
**§ Required Status Checks**; the report-only-then-promote rollout each docs gate goes through is in
[`DOCS_CI.md`](../../docs/internal/ci-cd/DOCS_CI.md).

**Code review is a local pre-push gate, not a CI check** (ADR-14 2026-06-04 amendment). The
`.claude/hooks/pre-push-review-gate.sh` hook gates `git push` on *evidence* that a review ran for the
current HEAD — evidence, not an attempt, so retrying a denied push does not satisfy it. A push that
publishes no objects (a dry run, or a `--delete` ref deletion) is exempt, having no diff to review.
Which review to run, how the evidence is recorded, and the livelock release are the runbook's to
state, not this roster's. Review sub-agents inherit the
session model (Opus). There is no `claude-review-gate` required check, no `claude-review.yml` workflow, and no
`CLAUDE_CODE_OAUTH_TOKEN` secret.

- On `main`, conversation resolution is not required, so unresolved review threads do not block merge.
- There is no second branch with a stricter policy. The human gate on what reaches users is the `production` **environment**'s Required reviewers, which pauses the deploy itself (#1340).
- Full runbook: [`AI_CODE_REVIEW_RUNBOOK.md`](../../docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md).

### Key Design Decisions

- **The frontend build gate is production-shaped, not preview-shaped.** `web-production-build` builds `apps/web` and `apps/landing` under `npm ci --omit=dev`, matching Vercel's production install, because nothing in CI ran `next build` before #1374 and that gap took production down twice (#1331, #1372). Staging frontends are still verified through Vercel preview deployments off `main`; production deployments are created by `deploy-production.yml`. The build-shape difference between the two is a recorded trade-off — ADR-20 decision 3. **The staging half of that has not run since the unlink** (landing 2026-09-01, web 2026-09-02): with both Vercel projects unlinked from Git (ADR-21) no push produces a preview, so no Vercel build of either frontend happens on merge any more — see §6 **Web and Landing (Vercel)**.
- **No placeholder secrets.** CI never sets `NEXT_PUBLIC_SUPABASE_URL` or similar to dummy values. All env-dependent builds happen in the provider (Vercel/Render).
- **The API contract check regenerates; it is not a git-diff heuristic.** `npm run check:api-contract` (`scripts/check-api-contract-drift.mjs`) builds the shared packages, rebuilds `apps/api/openapi.json` and `packages/api-sdk/src/types.ts`, and fails on any difference from the committed copies — the git-diff heuristic it replaced false-positived on contract-neutral controller edits. The Swagger export does bootstrap NestJS, but only to build the document, so placeholder credentials suffice and no Supabase/Stripe secrets are needed in CI. Details: [`../architecture/README.md`](../architecture/README.md) § 10 API Contract Strategy.
- **Mobile CI is lint + typecheck only.** EAS builds are expensive and slow; they run on-demand, not per-PR.

If any required check fails, the PR cannot be merged. Branch protection rules enforce this for all users, including admins.

---

## 6. Continuous Deployment (CD)

> **Current state (2026-09-02) — the Vercel half of this section is not running.** Both Vercel
> projects were deliberately unlinked from Git (landing 2026-09-01, web 2026-09-02), so no push
> deploys web or landing. The guardrails preflight inside `deploy-production.yml` briefly blocked
> production deploys of every service; **#1579 repaired that the same day** by inverting the Vercel
> assertion to require the *absence* of a Git link, and removed `verify-deployments.yml`'s two
> Vercel verify jobs, which had nothing left to verify. Render **staging** (the `deploy-api.yml`
> push path) and EAS were unaffected throughout. What follows stays written as intended. **ADR-21**
> in [`../architecture/README.md`](../architecture/README.md) is the canonical record of the unlink,
> the freeze points and the live breakages, with a 2026-09-02 amendment recording what #1579
> changed; the remaining repair work is **#1578** (CI-driven Vercel deploys).

Staging deploy steps are gated by CI: after CI succeeds on `main`, `deploy-api.yml` runs database migrations and triggers the Render staging deploy, and Vercel produces a Preview deployment from the same push. Nothing about production is push-triggered — `deploy-production.yml` creates the Render deploy and both Vercel production deployments itself, for a commit a human named.

### Deploy Pipeline (on merge)

```text
staging:     merge to main → CI passes → DB migration (dry-run then apply) → API deploy (Render)
             Vercel preview deployments are push-triggered from `main` and proceed in parallel
production:  dispatch a SHA → validate (ancestor of main + CI green) → provider preflight
             → migration replay → apply → Render deploy by commit → Vercel production
             build → tag
```

Production deployments run only when a human dispatches **Deploy production** with a
commit SHA, types the confirmation phrase, and approves the `production` environment.
That environment approval is now the **single** human gate — it replaced the promotion
PR's required review, and it fires at the moment of deploy rather than before anyone
knew whether the migration applied. Evidence that the environment gate really does pause
jobs is in `docs/internal/ci-cd/AGENT_INFRA.md` § GitHub environments and bootstrap
secrets.

### Web and Landing (Vercel)

> **Current state (2026-09-02) — both projects are unlinked from Git** (Vercel reports
> `link: null` for both), so nothing below that depends on the Git integration is running: no push
> produces a preview, and both staging hosts are frozen at their last Git build — landing `2bf143b`
> (2026-09-01T20:19Z) and web `0372c6d` (2026-09-02T02:41:42Z). The bullets below are kept as the
> intended model, and the `git.deploymentEnabled` and `ignoreCommand` keys stay in both
> `vercel.json` files: they are the versioned form of settings that are otherwise dashboard-only, so
> re-linking Git must not find them missing. **ADR-21** in
> [`../architecture/README.md`](../architecture/README.md) is the canonical record of the unlink,
> the per-project freeze points and the live breakages. **#1579** landed 2026-09-02 — the
> production-guardrails assertion now requires the *absence* of a Git link, and the two
> `verify-deployments.yml` Vercel verify jobs were removed. The remaining repair work is
> **#1578** (CI/CD stage 7 — `vercel build` plus `vercel deploy --prebuilt --prod` from Actions,
> designed but not built).

- Push to `main` triggers **preview** Vercel deployments (staging domains).
- Production deployments are **created by the workflow**, not by a push: a fresh build of
  the named commit with `target: production`, so it compiles against Production
  environment variables. Promoting a `main` preview instead would ship a bundle with the
  staging API URL and staging Supabase keys inlined at build time.
- Feature/PR branches do not auto-deploy on Vercel.
- Neither app skips builds. Both pin `ignoreCommand: "exit 1"` in `vercel.json` — an
  explicit *always build*, since Vercel reads exit 0 as "ignore this build" and exit 1 as
  "continue". This replaced `npx turbo-ignore <app>`, which skipped a production release
  by diffing it against the `main` preview of the same commit (run 33275321347). The key is
  set rather than removed: `ignoreCommand` overrides the project's dashboard Ignored Build
  Step, so deleting it would hand the decision back to unversioned dashboard state.
- Branch filtering is controlled with `git.deploymentEnabled` in each app's `vercel.json` (`main` enabled, all others disabled). Production deployments bypass branch triggers entirely: `deploy-production.yml` creates them through the Vercel API with `target: production`.
- Vercel detects the monorepo structure and builds the appropriate app via `vercel.json` build commands.

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
- **OTA updates:** For JS-only changes, use `eas update` to push directly to users without App Store review.
- **Native changes:** Full build + App Store / Google Play submission via `eas submit`.

### Deploy Ordering

**Default:** Vercel (frontends) and Render (API) deployments run in parallel after merge — the Vercel half of this default has not run since the unlink (ADR-21; landing 2026-09-01, web 2026-09-02); see §6 **Web and Landing (Vercel)**. Database migrations always run before the API deploy (enforced by the deploy workflow's job dependency chain).

**Exception — breaking API changes:** Use the split-PR flow in `docs/internal/quality/PR_REVIEW_PROCESS.md` when compatibility is not maintained:

1. Merge/deploy the backward-compatible API PR first.
2. Verify the API health check passes.
3. Merge frontend follow-up PRs only after API verification.

Because Vercel deploys are push-triggered, hold frontend merges until the API is confirmed healthy. **Since 2026-09-02 no Vercel deploy is push-triggered at all** — both projects are unlinked from Git (ADR-21), so a frontend merge currently reaches no deployed host and this ordering rule describes what must hold once CI/CD stage 7 (#1578) restores an automatic path, not anything running today. Breaking changes must be documented in the PR description and flagged for manual coordination. Use backward-compatible migration patterns wherever possible to avoid this scenario.

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
| **Environments** | `local`, `staging`, `production`                       |
| **Syncs**        | Vercel (×3 apps), Render (×2 services), GitHub Actions |

### How It Works

Canonical values (e.g., `SUPABASE_URL`) are stored **once** per Infisical environment. Framework-specific names (e.g., `NEXT_PUBLIC_SUPABASE_URL`) are **secret references** that resolve to the canonical value automatically. No duplication, no environment suffixes.

See **[`docs/internal/environment/ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md)** for the complete variable list and **[`docs/internal/environment/SECRETS_MANAGEMENT.md`](../../docs/internal/environment/SECRETS_MANAGEMENT.md)** for the setup guide.

### Bootstrap Secrets (GitHub only)

Three secrets live directly in GitHub — these bootstrap the Infisical connection:

| Secret                          | Purpose                                           |
| ------------------------------- | ------------------------------------------------- |
| `INFISICAL_MACHINE_IDENTITY_ID` | Universal-auth machine identity for Infisical      |
| `INFISICAL_CLIENT_SECRET`       | Client Secret for Infisical machine identity auth |
| `INFISICAL_PROJECT_ID`          | Project identifier                                |

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
- **No environment suffixes.** `RENDER_DEPLOY_HOOK_URL` has different values per Infisical environment — no `_STAGING` / `_PRODUCTION` suffixes.

---

## 8. Database Migrations

### Local Development

- Create: `npx supabase migration new <name>`
- Apply locally: `npx supabase db push --local`
- Reset local: `npx supabase db reset` (reapplies all migrations from scratch)

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
- See `docs/internal/ops/DEPLOYMENT.md` for the full migration deployment workflow.

## Claude Code cloud sandbox (primary dev environment)

Frapp is primarily developed in Claude Code web sessions. Each runs in a fresh, ephemeral VM; a setup script pre-caches Docker images and the SessionStart hook brings up Docker + local Supabase + the API in the background, generating `apps/api/.env.local` so the API boots without Infisical. Full configuration (setup script, env vars, network policy) and failure troubleshooting are in [`docs/internal/environment/CLOUD_SANDBOX.md`](../../docs/internal/environment/CLOUD_SANDBOX.md).

## Claude Code Routines environment

The scheduled backlog agents run as **Claude Code Routines**: each firing starts a fresh Claude Code web session in the same environment as interactive cloud sessions (repo cloned from `main`, the SessionStart hook and injected MCP servers included), so no separate sandbox config exists. The routines are configured in the Claude Code UI (config-as-code isn't supported), so the canonical prompts and every setting are version-controlled in [`docs/internal/ci-cd/ROUTINES.md`](../../docs/internal/ci-cd/ROUTINES.md). There are **five** routines — three daily, two weekly. Three write to **GitHub Issues** via the **GitHub MCP** the environment pre-approves (keyless; Linear was retired 2026-08-08, see ADR-16 amendment 5); the fourth writes docs; the fifth writes product code. None write to Linear, and only the fifth edits product code (per `ROUTINES.md`): the **Issue Curator** ([`.claude/skills/issue-curator/SKILL.md`](../../.claude/skills/issue-curator/SKILL.md)) maintains + files `suggestion` issues into the `triage` inbox, **Issue Triage** ([`.claude/skills/issue-triage/SKILL.md`](../../.claude/skills/issue-triage/SKILL.md)) prioritizes/buckets/promotes ~1h later, and the weekly **PR Follow-ups** harvester ([`.claude/skills/pr-followups/SKILL.md`](../../.claude/skills/pr-followups/SKILL.md)) sweeps human-action/deferred items from PR threads into the inbox. Weekly on Wednesday, **Docs Upkeep** ([`.claude/skills/docs-upkeep/SKILL.md`](../../.claude/skills/docs-upkeep/SKILL.md)) sweeps a rotating fifth of the docs corpus and fixes stale claims in a docs-only PR — the first routine that repairs rather than files (ADR-16 amendment 6). Daily at 06:00 ET, before the others, **Hygiene Scan** ([`.claude/skills/hygiene-scan/SKILL.md`](../../.claude/skills/hygiene-scan/SKILL.md)) grounds itself in the engineering standards and gates, reads a rotating fifth of the codebase whole, and fixes one verified hygiene theme in a product-code PR a human merges — the only routine allowed to edit product code (ADR-16 amendment 7).
