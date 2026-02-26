# Environments & CI/CD Specification: Frapp

---

## 1. Environment Matrix

|              | Local                             | Staging                                  | Production                            |
| ------------ | --------------------------------- | ---------------------------------------- | ------------------------------------- |
| **Landing**  | localhost:3002                    | Vercel preview / staging.frapp.live      | frapp.live                            |
| **Web App**  | localhost:3000                    | Vercel preview / app.staging.frapp.live  | app.frapp.live                        |
| **API**      | localhost:3001                    | Render / Railway / AWS (staging)         | Render / Railway / AWS (production)   |
| **Docs**     | localhost:3005                    | Vercel preview / docs.staging.frapp.live | docs.frapp.live                       |
| **Mobile**   | Expo Go (local network)           | EAS internal distribution                | App Store / Google Play               |
| **Database** | Supabase local (`supabase start`) | Supabase staging project                 | Supabase production project           |
| **Auth**     | Supabase Auth (local)             | Supabase Auth (staging project)          | Supabase Auth (production project)    |
| **Storage**  | Supabase Storage (local)          | Supabase Storage (staging project)       | Supabase Storage (production project) |
| **Stripe**   | Test mode (`sk_test_`)            | Test mode (`sk_test_`)                   | Live mode (`sk_live_`)                |
| **Push**     | Expo Go (dev)                     | EAS internal builds                      | Production builds                     |

Each Supabase project (local, staging, production) is fully isolated: separate database, auth users, storage buckets, and API keys.

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

# 3. Apply database migrations
npx supabase db push

# 4. Start all apps
npm run dev
```

### Environment Variables

**Web App (`apps/web/.env.local`)**

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<from supabase start output>
NEXT_PUBLIC_API_URL=http://localhost:3001/v1
```

**Mobile App (`apps/mobile/.env.local`)**

```env
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<from supabase start output>
EXPO_PUBLIC_API_URL=http://localhost:3001/v1
```

**API (`apps/api/.env.local`)**

```env
SUPABASE_URL=http://127.0.0.1:54321
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
- **Supabase:** Dedicated staging project (separate from production). Create via Supabase dashboard or CLI.
- **Web / Landing / Docs:** Vercel preview deployments or dedicated staging subdomains.
- **API:** Deployed to a staging instance (Render, Railway, or AWS App Runner) pointing at the Supabase staging project.
- **Mobile:** EAS internal distribution builds (`eas build --profile staging`).
- **Stripe:** Test mode keys.
- **Data:** May contain seed data. Never production user data.

---

## 4. Production

- **Supabase:** Dedicated production project. Fully isolated users, database, storage.
- **Web App:** app.frapp.live (Vercel).
- **Landing:** frapp.live (Vercel).
- **Docs:** docs.frapp.live (Vercel).
- **API:** Production instance with environment variables pointing at Supabase production + Stripe live keys.
- **Mobile:** App Store and Google Play via EAS Submit.
- **Stripe:** Live mode. Requires business verification (KYC) before launch.
- **Monitoring:** Error tracking (Sentry or equivalent), structured logging, uptime checks.

---

## 5. Continuous Integration (CI)

On every PR to `develop` or `main`, a GitHub Actions workflow runs:

1. **Install:** `npm ci`
2. **Lint:** `turbo run lint`
3. **Type check:** `turbo run check-types`
4. **Test:** `turbo run test`
5. **Contract check:** Verify `openapi.json` is current and `@repo/api-sdk` compiles.

If any step fails, the PR cannot be merged.

---

## 6. Continuous Deployment (CD)

### Web, Landing, Docs (Vercel)

- Push to `main` triggers automatic Vercel deployments.
- Vercel detects the monorepo structure and builds the appropriate app.
- Custom domains configured per app.

### API

- Push to `main` triggers a GitHub Actions workflow:
  1. Build Docker image for `apps/api`.
  2. Run database migrations (`npx supabase db push` against the target Supabase project).
  3. Deploy container with zero-downtime swap.

### Mobile (EAS)

- **Production build:** `eas build --platform all --profile production`.
- **OTA updates:** For JS-only changes, use `eas update` to push directly to users without App Store review.
- **Native changes:** Full build + App Store / Google Play submission via `eas submit`.

---

## 7. Secret Management

- **Local:** `.env.local` files (never committed; in `.gitignore`).
- **CI/CD:** GitHub Actions secrets or Vercel environment variables.
- **Staging / Production:** Environment variables set in the hosting provider (Vercel, Render/Railway, EAS). Consider a secret manager (Infisical, Doppler) for centralized management as the team grows.

**Rule:** Never commit secrets. Never log secrets. Rotate keys immediately if exposed.

---

## 8. Database Migrations

- Managed via Supabase CLI: `npx supabase migration new <name>` to create, `npx supabase db push` to apply.
- Migration files live in `supabase/migrations/`.
- Migrations are version-controlled and applied in order.
- Breaking schema changes require a migration plan (backward-compatible where possible; coordinate with API deploys).
