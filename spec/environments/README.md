# Environments & CI/CD Specification: Frapp

---

## 1. Environment Matrix

|              | Local                             | Staging                                 | Production                            |
| ------------ | --------------------------------- | --------------------------------------- | ------------------------------------- |
| **Landing**  | localhost:3002                    | Vercel preview / staging.frapp.live     | frapp.live                            |
| **Web App**  | localhost:3000                    | Vercel preview / app.staging.frapp.live | app.frapp.live                        |
| **API**      | localhost:3001                    | Render (`main` branch service)          | Render (`production` branch service)  |
| **Mobile**   | Expo Go (local network)           | EAS internal distribution               | App Store / Google Play               |
| **Database** | Supabase local (`supabase start`) | Supabase staging project                | Supabase production project           |
| **Auth**     | Supabase Auth (local)             | Supabase Auth (staging project)         | Supabase Auth (production project)    |
| **Storage**  | Supabase Storage (local)          | Supabase Storage (staging project)      | Supabase Storage (production project) |
| **Stripe**   | Test mode (`sk_test_`)            | Test mode (`sk_test_`)                  | Live mode (`sk_live_`)                |
| **Push**     | Expo Go (dev)                     | EAS internal builds                     | Production builds                     |

Each Supabase project (local, staging, production) is fully isolated: separate database, auth users, storage buckets, and API keys.

### Branch-to-environment mapping

| Branch       | Purpose                              | Deployment behavior                                    |
| ------------ | ------------------------------------ | ------------------------------------------------------ |
| `main`       | Pre-production / staging integration | Triggers staging and Vercel Preview domain deployments |
| `production` | Production                           | Triggers production deployments                        |
| `feature/*`  | Short-lived feature work             | No automatic Vercel deployments; merged into `main`    |

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

The script runs `npm install`, `npx supabase start`, `npx supabase db push --local`, optional validation, then prints **`npm run dev:stack`** (and pointers to [`docs/internal/environment/LOCAL_DEV.md`](../../docs/internal/environment/LOCAL_DEV.md)). It does **not** start `dockerd` (the Claude Code cloud sandbox does — see below). It does **not** stop unrelated Docker containers—only this project’s Supabase CLI stack. If `supabase start` fails in an interactive shell, it may prompt once to run `supabase stop` and retry (volumes preserved).

**Manual sequence** (equivalent):

```bash
# 1. Install dependencies
npm install

# 2. Start Supabase local (Postgres, Auth, Storage, Realtime)
npx supabase start

# 3. Apply database migrations (--local targets the local Supabase instance)
npx supabase db push --local

# 4. Start apps — default (with Infisical — see docs/internal/LOCAL_DEV.md):
npm run dev:stack
# Per-app, no Infisical, Turbo caveats: docs/internal/LOCAL_DEV.md
```

### Environment Variables

If you are not using Infisical CLI injection, create a `.env.local` file for each app. Local Supabase keys come from `npx supabase status -o env`.

See **[`docs/internal/ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md)** for the complete list of every variable, per app, per environment.

**Alternative (Infisical CLI):** Skip `.env.local` files entirely by injecting from Infisical:

```bash
npx infisical run --env=local -- npm run start:dev -w apps/api
```

### Accessing Services

| Service          | URL                        |
| ---------------- | -------------------------- |
| Web App          | http://localhost:3000      |
| API              | http://localhost:3001      |
| API Swagger Docs | http://localhost:3001/docs |
| Landing          | http://localhost:3002      |
| Supabase Studio  | http://127.0.0.1:54323     |

### Running Mobile

```bash
cd apps/mobile
npm start
```

Scan the QR code with Expo Go. Phone and PC must be on the same network.

### Updating the API Contract

After changing an API endpoint:

```bash
npm run openapi:export -w apps/api
npm run generate -w packages/api-sdk
```

---

## 3. Staging

- **Purpose:** QA, stakeholder demos, mobile TestFlight/internal builds.
- **Git branch:** `main` — pushes trigger staging/pre-production deployments.
- **Supabase:** Dedicated staging project (separate from production). Create via Supabase dashboard or CLI.
- **Web / Landing:** Vercel Preview deployments with staging domains (`app.staging.frapp.live`, `staging.frapp.live`), filtered to the `main` branch.
- **API:** Render staging service (`frapp-api-staging`), auto-deploys from `main`, pointing at Supabase staging.
- **Mobile:** EAS internal distribution builds (`eas build --profile preview`).
- **Stripe:** Test mode keys (`sk_test_`).
- **Data:** May contain seed data. Never production user data.

---

## 4. Production

- **Git branch:** `production` — pushes trigger production deployments.
- **Supabase:** Dedicated production project. Fully isolated users, database, storage.
- **Web App:** `app.frapp.live` (Vercel, production deploy from `production`).
- **Landing:** `frapp.live` (Vercel, production deploy from `production`).
- **API:** Render production service (`frapp-api-prod`), auto-deploys from `production`, pointing at Supabase production + Stripe live keys.
- **Mobile:** App Store and Google Play via EAS Submit.
- **Stripe:** Live mode (`sk_live_`). Requires business verification (KYC) before launch.
- **Monitoring:** Error tracking (Sentry or equivalent), structured logging, uptime checks.

> **Full setup walkthrough:** See [`docs/internal/ops/DEPLOYMENT.md`](../../docs/internal/ops/DEPLOYMENT.md) for step-by-step instructions covering Vercel, Render, Supabase, EAS, DNS, and environment variables.

---

## 5. Continuous Integration (CI)

CI runs as domain-specific parallel jobs on every PR to `main` or `production`. Each job is an independent required status check — failures are visible per domain, not hidden behind a single monolith gate.

### CI Job Matrix

| Job                  | What it validates                                                                                    | Blocker?   |
| -------------------- | ---------------------------------------------------------------------------------------------------- | ---------- |
| `packages-build`     | Shared packages compile                                                                              | Yes        |
| `lint-and-typecheck` | ESLint + TypeScript across all workspaces; `npm run build -w apps/api` (`nest build`, Render parity); landing and `@repo/validation` unit tests | Yes        |
| `api-docker-build`   | `docker build -f apps/api/Dockerfile .` (API image compile path)                                     | Yes        |
| `api-tests`          | API Jest unit tests (377+ tests)                                                                     | Yes (hard) |
| `api-contract-check` | `openapi.json` and `api-sdk/types.ts` freshness                                                      | Yes        |
| `migration-safety`   | Migration filename validation + promotion docs                                                       | Yes        |
| `mobile-validate`    | Mobile app lint + typecheck + unit tests (Vitest)                                                    | Yes        |
| `ci-scripts-tests`   | CI scripts unit/integration tests                                                                    | Yes        |
| `branch-policy`      | PRs to `production` must come from `main`                                                            | Yes        |

### Additional Required Checks

These checks are also required for merge:

| Check            | Provider       | What it validates                               |
| ---------------- | -------------- | ----------------------------------------------- |
| `docs-spec-sync` | GitHub Actions | Docs/spec sync on PRs (`check-docs-impact.mjs`) |

**Code review is a local pre-push gate, not a CI check** (ADR-14 2026-06-04 amendment). The
`.claude/hooks/pre-push-review-gate.sh` hook blocks the first `git push` of each branch HEAD and requires
one review pass on the diff before the branch is pushed — **`/diff-review`**, which any agent can always
invoke, or the richer bundled `/code-review`, which is model-invocable only when the turn's prompt carries
`/code-review` whitespace-delimited on both sides (backticks and trailing punctuation defeat it) and
does not write the gate marker. Review sub-agents inherit the
session model (Opus). There is no `claude-review-gate` required check, no `claude-review.yml` workflow, and no
`CLAUDE_CODE_OAUTH_TOKEN` secret.

- On `main`, conversation resolution is not required, so unresolved review threads do not block merge.
- On `production`, the promotion PR also requires one approving review plus conversation resolution.
- Full runbook: [`AI_CODE_REVIEW_RUNBOOK.md`](../../docs/internal/ci-cd/AI_CODE_REVIEW_RUNBOOK.md).

### Key Design Decisions

- **No CI frontend build gate.** CI focuses on lint/type/tests/docs gates; Vercel handles frontend deployments on `main`/`production` only.
- **No placeholder secrets.** CI never sets `NEXT_PUBLIC_SUPABASE_URL` or similar to dummy values. All env-dependent builds happen in the provider (Vercel/Render).
- **API contract check uses git-diff.** The `openapi.json` is committed as a source-of-truth artifact. CI checks freshness via `git diff` — it does not bootstrap the NestJS application, avoiding the need for Supabase/Stripe credentials in CI.
- **Mobile CI is lint + typecheck only.** EAS builds are expensive and slow; they run on-demand, not per-PR.

If any required check fails, the PR cannot be merged. Branch protection rules enforce this for all users, including admins.

---

## 6. Continuous Deployment (CD)

GitHub Actions-managed deploy steps are gated by CI. After CI succeeds, the deploy workflow runs database migrations and triggers the Render API deploy. Vercel deployments are push-triggered only for `main` and `production`.

### Deploy Pipeline (on merge)

```text
CI passes → DB migration (dry-run then apply) → API deploy (Render)
Vercel preview/production deployments are push-triggered from `main`/`production` and can proceed in parallel
```

Production deployments run automatically after the `main` → `production` promotion PR merges and CI passes. There is no separate GitHub Actions environment-approval pause: required-reviewer environment protection rules are GitHub Enterprise-only on private repositories, so the control point for production is the promotion PR itself (branch protection: CI + an approving review + conversation resolution).

### Web and Landing (Vercel)

- Push to `production` triggers **production** Vercel deployments (custom domains).
- Push to `main` triggers **preview** Vercel deployments (staging domains).
- Feature/PR branches do not auto-deploy on Vercel.
- Each app uses `turbo-ignore` to skip rebuilds when its files haven't changed.
- Branch filtering is controlled with `git.deploymentEnabled` in each app's `vercel.json` (`main` and `production` enabled, all others disabled).
- Vercel detects the monorepo structure and builds the appropriate app via `vercel.json` build commands.

### API (Render)

- API deploys are gated behind CI success using `workflow_run` triggers.
- Push to `production` (after CI) → GitHub Actions triggers Render production deploy hook.
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

**Default:** Vercel (frontends) and Render (API) deployments run in parallel after merge. Database migrations always run before the API deploy (enforced by the deploy workflow's job dependency chain).

**Exception — breaking API changes:** Use the split-PR flow in `docs/internal/PR_REVIEW_PROCESS.md` when compatibility is not maintained:

1. Merge/deploy the backward-compatible API PR first.
2. Verify the API health check passes.
3. Merge frontend follow-up PRs only after API verification.

Because Vercel deploys are push-triggered, hold frontend merges until the API is confirmed healthy. Breaking changes must be documented in the PR description and flagged for manual coordination. Use backward-compatible migration patterns wherever possible to avoid this scenario.

### Release labels for version tags

Version bumps are derived from labels on the `main` → `production` promotion PR (the PR merged into `production`):

- No release label → patch bump
- `release:minor` → minor bump
- `release:major` → major bump

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

See **[`docs/internal/ENV_REFERENCE.md`](../../docs/internal/environment/ENV_REFERENCE.md)** for the complete variable list and **[`docs/internal/SECRETS_MANAGEMENT.md`](../../docs/internal/environment/SECRETS_MANAGEMENT.md)** for the setup guide.

### Bootstrap Secrets (GitHub only)

Three secrets live directly in GitHub — these bootstrap the Infisical connection:

| Secret                          | Purpose                                           |
| ------------------------------- | ------------------------------------------------- |
| `INFISICAL_MACHINE_IDENTITY_ID` | OIDC auth to Infisical                            |
| `INFISICAL_CLIENT_SECRET`       | Client Secret for Infisical machine identity auth |
| `INFISICAL_PROJECT_ID`          | Project identifier                                |

### Local Development

**Primary method (no `.env.local` files):**

```bash
npx infisical login       # One-time setup
npm run dev:stack         # Default: API + web + landing (repo root)
```

Per-app Infisical commands, mobile, and no-Infisical fallback: **[`docs/internal/LOCAL_DEV.md`](../../docs/internal/environment/LOCAL_DEV.md)**.

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

1. **Pre-flight validation** (CI): `check:migration-safety` validates filenames, ordering, and promotion docs.
2. **Dry run** (CD): `supabase db push --dry-run` shows what will change before applying.
3. **Apply** (CD): `supabase db push` applies pending migrations.
4. **Failure handling**: If migration fails, the pipeline stops — no app deploy happens.
5. **Production gate**: The gate is the `main` → `production` promotion PR (branch protection: CI + an approving review + conversation resolution). GitHub Actions environment-approval rules do **not** gate production on this repo — required-reviewer environment protection is GitHub Enterprise-only on private repos.

### Safety Rules

- Migration files live in `supabase/migrations/`.
- Migrations are version-controlled and applied in order.
- Filenames must match pattern: `YYYYMMDDHHMMSS_snake_case_name.sql`.
- Breaking schema changes require a migration plan (backward-compatible where possible; coordinate with API deploys).
- Every migration should have a documented rollback strategy in `docs/internal/DB_ROLLBACK_PLAYBOOK.md`.
- See `docs/internal/ops/DEPLOYMENT.md` for the full migration deployment workflow.

## Claude Code cloud sandbox (primary dev environment)

Frapp is primarily developed in Claude Code web sessions. Each runs in a fresh, ephemeral VM; a setup script pre-caches Docker images and the SessionStart hook brings up Docker + local Supabase + the API in the background, generating `apps/api/.env.local` so the API boots without Infisical. Full configuration (setup script, env vars, network policy) and failure troubleshooting are in [`docs/internal/environment/CLOUD_SANDBOX.md`](../../docs/internal/environment/CLOUD_SANDBOX.md).

## Claude Code Routines environment

The scheduled backlog agents run as **Claude Code Routines**: each firing starts a fresh Claude Code web session in the same environment as interactive cloud sessions (repo cloned from `main`, the SessionStart hook and injected MCP servers included), so no separate sandbox config exists. The routines are configured in the Claude Code UI (config-as-code isn't supported), so the canonical prompts and every setting are version-controlled in [`docs/internal/ci-cd/ROUTINES.md`](../../docs/internal/ci-cd/ROUTINES.md). There are **three** routines — two staggered daily, one weekly — all writing to **GitHub Issues** via the **GitHub MCP** the environment pre-approves (keyless; Linear was retired 2026-08-08, see ADR-16 amendment 5) — they never write to Linear and never edit product code (a docs-only self-maintenance PR is the single exception, per `ROUTINES.md`): the **Issue Curator** ([`.claude/skills/issue-curator/SKILL.md`](../../.claude/skills/issue-curator/SKILL.md)) maintains + files `suggestion` issues into the `triage` inbox, **Issue Triage** ([`.claude/skills/issue-triage/SKILL.md`](../../.claude/skills/issue-triage/SKILL.md)) prioritizes/buckets/promotes ~1h later, and the weekly **PR Follow-ups** harvester ([`.claude/skills/pr-followups/SKILL.md`](../../.claude/skills/pr-followups/SKILL.md)) sweeps human-action/deferred items from PR threads into the inbox.
