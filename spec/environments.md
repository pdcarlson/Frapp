# Environments & CI/CD Specification: Frapp

---

## 1. Environment Matrix

|              | Local                             | Staging                                  | Production                            |
| ------------ | --------------------------------- | ---------------------------------------- | ------------------------------------- |
| **Landing**  | localhost:3002                    | Vercel preview / staging.frapp.live      | frapp.live                            |
| **Web App**  | localhost:3000                    | Vercel preview / app.staging.frapp.live  | app.frapp.live                        |
| **API**      | localhost:3001                    | Render (`preview` branch service)         | Render (`main` branch service)         |
| **Docs**     | localhost:3005                    | Vercel preview / docs.staging.frapp.live | docs.frapp.live                       |
| **Mobile**   | Expo Go (local network)           | EAS internal distribution                | App Store / Google Play               |
| **Database** | Supabase local (`supabase start`) | Supabase staging project                 | Supabase production project           |
| **Auth**     | Supabase Auth (local)             | Supabase Auth (staging project)          | Supabase Auth (production project)    |
| **Storage**  | Supabase Storage (local)          | Supabase Storage (staging project)       | Supabase Storage (production project) |
| **Stripe**   | Test mode (`sk_test_`)            | Test mode (`sk_test_`)                   | Live mode (`sk_live_`)                |
| **Push**     | Expo Go (dev)                     | EAS internal builds                      | Production builds                     |

Each Supabase project (local, staging, production) is fully isolated: separate database, auth users, storage buckets, and API keys.

### Branch-to-environment mapping

| Branch | Purpose | Deployment behavior |
| ------ | ------- | ------------------- |
| `main` | Production | Triggers production deployments |
| `preview` | Pre-production / staging integration | Triggers staging and Vercel Preview domain deployments |
| `feature/*` | Short-lived feature work | PR preview deployments only; merged into `preview` |

---

## 2. Local Development

### Prerequisites

- Node.js v18+
- npm v10+
- Docker Desktop (for Supabase local)
- Supabase CLI (`npx supabase`)
- Expo Go app on iOS/Android device

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Start Supabase local (Postgres, Auth, Storage, Realtime)
npx supabase start

# 3. Apply database migrations (--local targets the local Supabase instance)
npx supabase db push --local

# 4. Start all apps
npm run dev
```

### Environment Variables

**Web App (`apps/web/.env.local`)**

```env
NEXT_PUBLIC_SUPABASE_URL=[REDACTED]
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from supabase start output>
NEXT_PUBLIC_API_URL=http://localhost:3001/v1
```

**Mobile App (`apps/mobile/.env.local`)**

```env
EXPO_PUBLIC_SUPABASE_URL=[REDACTED]
EXPO_PUBLIC_SUPABASE_ANON_KEY=<from supabase start output>
EXPO_PUBLIC_API_URL=http://localhost:3001/v1
```

**API (`apps/api/.env.local`)**

```env
SUPABASE_URL=[REDACTED]
SUPABASE_SERVICE_ROLE_KEY=<from supabase start output>

STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
```

**Landing (`apps/landing/.env.local`)**

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Accessing Services

| Service          | URL                        |
| ---------------- | -------------------------- |
| Web App          | http://localhost:3000      |
| API              | http://localhost:3001      |
| API Swagger Docs | http://localhost:3001/docs |
| Landing          | http://localhost:3002      |
| Docs             | http://localhost:3005      |
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
- **Git branch:** `preview` — pushes trigger staging/pre-production deployments.
- **Supabase:** Dedicated staging project (separate from production). Create via Supabase dashboard or CLI.
- **Web / Landing / Docs:** Vercel Preview deployments with staging domains (`app.staging.frapp.live`, `staging.frapp.live`, `docs.staging.frapp.live`), filtered to the `preview` branch.
- **API:** Render staging service (`frapp-api-staging`), auto-deploys from `preview`, pointing at Supabase staging.
- **Mobile:** EAS internal distribution builds (`eas build --profile preview`).
- **Stripe:** Test mode keys (`sk_test_`).
- **Data:** May contain seed data. Never production user data.

---

## 4. Production

- **Git branch:** `main` — pushes trigger production deployments.
- **Supabase:** Dedicated production project. Fully isolated users, database, storage.
- **Web App:** `app.frapp.live` (Vercel, production deploy from `main`).
- **Landing:** `frapp.live` (Vercel, production deploy from `main`).
- **Docs:** `docs.frapp.live` (Vercel, production deploy from `main`).
- **API:** Render production service (`frapp-api-prod`), auto-deploys from `main`, pointing at Supabase production + Stripe live keys.
- **Mobile:** App Store and Google Play via EAS Submit.
- **Stripe:** Live mode (`sk_live_`). Requires business verification (KYC) before launch.
- **Monitoring:** Error tracking (Sentry or equivalent), structured logging, uptime checks.

> **Full setup walkthrough:** See [`docs/DEPLOYMENT.md`](../docs/DEPLOYMENT.md) for step-by-step instructions covering Vercel, Render, Supabase, EAS, DNS, and environment variables.

---

## 5. Continuous Integration (CI)

CI runs as domain-specific parallel jobs on every PR to `preview` or `main`. Each job is an independent required status check — failures are visible per domain, not hidden behind a single monolith gate.

### CI Job Matrix

| Job | What it validates | Blocker? |
| --- | --- | --- |
| `packages-build` | Shared packages compile | Yes |
| `lint-and-typecheck` | ESLint + TypeScript across all workspaces | Yes |
| `api-tests` | API Jest unit tests (377+ tests) | Yes (hard) |
| `api-contract-check` | `openapi.json` and `api-sdk/types.ts` freshness | Yes |
| `migration-safety` | Migration filename validation + promotion docs | Yes |
| `docs-sync-check` | Code changes include docs/spec updates (PR only) | Yes |
| `mobile-validate` | Mobile app lint + typecheck | Yes |
| `branch-policy` | PRs to `main` must come from `preview` | Yes |

### External Required Checks

These are provided by third-party integrations and are also required for merge:

| Check | Provider | What it validates |
| --- | --- | --- |
| `Vercel – frapp-web` | Vercel | Next.js build succeeds (web dashboard) |
| `Vercel – frapp-landing` | Vercel | Next.js build succeeds (landing page) |
| `Vercel – frapp-docs` | Vercel | Next.js build succeeds (docs site) |
| `CodeRabbit` | CodeRabbit | AI code review (blocks via request-changes workflow) |

### Key Design Decisions

- **No CI build job.** Vercel performs its own builds with its own environment variables. Vercel's status checks serve as the build gate, eliminating the need for placeholder secrets in CI.
- **No placeholder secrets.** CI never sets `NEXT_PUBLIC_SUPABASE_URL` or similar to dummy values. All env-dependent builds happen in the provider (Vercel/Render).
- **API contract check uses git-diff.** The `openapi.json` is committed as a source-of-truth artifact. CI checks freshness via `git diff` — it does not bootstrap the NestJS application, avoiding the need for Supabase/Stripe credentials in CI.
- **Mobile CI is lint + typecheck only.** EAS builds are expensive and slow; they run on-demand, not per-PR.

If any required check fails, the PR cannot be merged. Branch protection rules enforce this for all users, including admins.

---

## 6. Continuous Deployment (CD)

Deployments are gated by CI. The deploy pipeline only triggers after the CI workflow completes successfully (via `workflow_run`). This ensures broken code never deploys.

### Deploy Pipeline (on merge)

```
CI passes → DB migration (dry-run then apply) → API deploy (Render) → Frontend deploy (Vercel, auto)
```

Production deployments additionally require manual approval before the migration step runs.

### Web, Landing, Docs (Vercel)

- Push to `main` triggers **production** Vercel deployments (custom domains).
- Push to `preview` triggers **preview** Vercel deployments (staging domains).
- PRs get ephemeral preview URLs automatically.
- Each app uses `turbo-ignore` to skip rebuilds when its files haven't changed.
- Vercel builds are also required status checks — if the Vercel build fails, the PR cannot merge.
- Vercel detects the monorepo structure and builds the appropriate app via `vercel.json` build commands.

### API (Render)

- API deploys are gated behind CI success using `workflow_run` triggers.
- Push to `main` (after CI) → GitHub Actions triggers Render production deploy hook.
- Push to `preview` (after CI) → GitHub Actions triggers Render staging deploy hook.
- Render builds the Docker image from `apps/api/Dockerfile` and performs zero-downtime swap.
- Database migrations run automatically before deploy (see Section 8).
- See `render.yaml` for the infrastructure-as-code definition.

### Mobile (EAS)

- **Production build:** `eas build --platform all --profile production`.
- **Preview build (staging):** `eas build --platform all --profile preview`.
- **OTA updates:** For JS-only changes, use `eas update` to push directly to users without App Store review.
- **Native changes:** Full build + App Store / Google Play submission via `eas submit`.

### Deploy Ordering

Vercel and Render deployments run in parallel after merge. For breaking API changes, use backward-compatible migration patterns: deploy the new API first (which handles both old and new schemas), then deploy frontends that use the new contract. Document breaking changes in the PR description and coordinate manually when needed.

---

## 7. Secret Management

Secrets are centrally managed in **Infisical** (free tier) with automatic syncs to deployment providers. This provides a single source of truth for all environment variables across all environments.

### Infisical Setup

| Property | Value |
| --- | --- |
| **Project** | Frapp |
| **Environments** | `local`, `staging`, `production` |
| **Syncs** | Vercel (×3 apps), Render (×2 services), GitHub Actions |

### Secret Ownership

| Secret | Environments | Synced To | Notes |
| --- | --- | --- | --- |
| `SUPABASE_URL` | staging, production | Render | API server-side |
| `SUPABASE_SERVICE_ROLE_KEY` | staging, production | Render | API server-side, NEVER client |
| `SUPABASE_ANON_KEY` | staging, production | Render | API server-side |
| `STRIPE_SECRET_KEY` | staging, production | Render | `sk_test_` / `sk_live_` |
| `STRIPE_WEBHOOK_SECRET` | staging, production | Render | `whsec_` |
| `STRIPE_PRICE_ID` | staging, production | Render | `price_` |
| `NEXT_PUBLIC_SUPABASE_URL` | staging, production | Vercel (web) | Client-safe |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging, production | Vercel (web) | Client-safe |
| `NEXT_PUBLIC_API_URL` | staging, production | Vercel (web) | Client-safe |
| `NEXT_PUBLIC_APP_URL` | staging, production | Vercel (landing) | Client-safe |
| `EXPO_PUBLIC_SUPABASE_URL` | staging, production | EAS | Mobile builds |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | staging, production | EAS | Mobile builds |
| `RENDER_DEPLOY_HOOK_URL` | production | GitHub Actions | Deploy trigger |
| `RENDER_DEPLOY_HOOK_URL_STAGING` | staging | GitHub Actions | Deploy trigger |
| `SUPABASE_ACCESS_TOKEN` | global | GitHub Actions | For automated migrations |
| `SUPABASE_PROJECT_REF_STAGING` | staging | GitHub Actions | Migration target |
| `SUPABASE_PROJECT_REF_PRODUCTION` | production | GitHub Actions | Migration target |

### Bootstrap Secrets (GitHub only)

Only two secrets remain in GitHub repository settings — these bootstrap the Infisical connection:

| Secret | Purpose |
| --- | --- |
| `INFISICAL_MACHINE_IDENTITY_ID` | OIDC auth to Infisical |
| `INFISICAL_PROJECT_ID` | Project identifier |

### Local Development

- `.env.local` files (never committed; in `.gitignore`).
- Local Supabase keys are deterministic JWTs from `npx supabase status -o env`.
- Stripe test-mode keys can be set to placeholders unless testing billing flows.

### Rules

- **Never** commit secrets. **Never** log secrets. Rotate keys immediately if exposed.
- **No placeholder secrets in CI.** CI does not build apps that require runtime secrets — Vercel and Render handle those builds with provider-native env vars synced from Infisical.
- See `docs/internal/SECRETS_MANAGEMENT.md` for the full setup guide and rotation policy.

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
5. **Production gate**: Production migrations require manual approval via GitHub Actions environment protection.

### Safety Rules

- Migration files live in `supabase/migrations/`.
- Migrations are version-controlled and applied in order.
- Filenames must match pattern: `YYYYMMDDHHMMSS_snake_case_name.sql`.
- Breaking schema changes require a migration plan (backward-compatible where possible; coordinate with API deploys).
- Every migration should have a documented rollback strategy in `docs/internal/DB_ROLLBACK_PLAYBOOK.md`.
- See `docs/DEPLOYMENT.md` for the full migration deployment workflow.
