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

On every PR to `preview` or `main`, a GitHub Actions workflow runs:

1. **Install:** `npm ci`
2. **Build shared packages:** `npx turbo run build --filter='./packages/*'`
3. **Type check:** `npm run check-types`
4. **Lint:** `npm run lint`
5. **Test:** `npm run test -w apps/api`
6. **Build:** `npm run build`

If any step fails, the PR cannot be merged.

---

## 6. Continuous Deployment (CD)

### Web, Landing, Docs (Vercel)

- Push to `main` triggers **production** Vercel deployments (custom domains).
- Push to `preview` triggers **preview** Vercel deployments (staging domains).
- PRs get ephemeral preview URLs automatically.
- Each app uses `turbo-ignore` to skip rebuilds when its files haven't changed.
- Vercel detects the monorepo structure and builds the appropriate app via `vercel.json` build commands.

### API (Render)

- Push to `main` triggers GitHub Actions → Render production deploy hook.
- Push to `preview` triggers GitHub Actions → Render staging deploy hook.
- Render builds the Docker image from `apps/api/Dockerfile` and performs zero-downtime swap.
- Database migrations are applied manually before deploy: `npx supabase db push --project-ref <REF>`.
- See `render.yaml` for the infrastructure-as-code definition.

### Mobile (EAS)

- **Production build:** `eas build --platform all --profile production`.
- **Preview build (staging):** `eas build --platform all --profile preview`.
- **OTA updates:** For JS-only changes, use `eas update` to push directly to users without App Store review.
- **Native changes:** Full build + App Store / Google Play submission via `eas submit`.

---

## 7. Secret Management

- **Local:** `.env.local` files (never committed; in `.gitignore`).
- **CI/CD:** GitHub Actions secrets or Vercel environment variables.
- **Staging / Production:** Environment variables set in the hosting provider (Vercel, Render, EAS). Consider a secret manager (Infisical, Doppler) for centralized management as the team grows.

**Rule:** Never commit secrets. Never log secrets. Rotate keys immediately if exposed.

---

## 8. Database Migrations

- Managed via Supabase CLI: `npx supabase migration new <name>` to create, `npx supabase db push --local` to apply locally (or omit `--local` after `supabase link` for remote projects).
- Two workflows exist for pushing migrations to remote projects. Use `npx supabase db push --project-ref <REF>` for one-shot or CI/CD scripts where no persistent link is desired. Use `npx supabase link --project-ref <REF>` followed by `npx supabase db push` when working repeatedly against the same remote project (the link persists in `.supabase/`). See `docs/DEPLOYMENT.md` for the link-then-push pattern and section 6 above for the `--project-ref` usage in Render deploys.
- Migration files live in `supabase/migrations/`.
- Migrations are version-controlled and applied in order.
- Breaking schema changes require a migration plan (backward-compatible where possible; coordinate with API deploys).
