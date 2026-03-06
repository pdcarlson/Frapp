# Environment Variable Reference

> **This is the single source of truth for every environment variable in the Frapp project.**
>
> All values are managed in [Infisical](https://infisical.com). Canonical values are stored once per environment. Framework-specific names (e.g., `NEXT_PUBLIC_*`) are Infisical **secret references** that auto-resolve to the canonical value.

---

## How It Works

```text
Infisical stores each value ONCE per environment:
  SUPABASE_URL = https://xyz.supabase.co     (canonical)

Framework-specific names are REFERENCES that resolve automatically:
  NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}  (resolves to same value)
  EXPO_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}  (resolves to same value)

Change SUPABASE_URL → both references update instantly.
```

---

## Infisical Environments

| Environment | When it's used | Maps to |
|---|---|---|
| `local` | Running the app on your machine against local Docker Supabase | `npm run dev:api`, `npm run dev:web`, etc. |
| `staging` | Deployed to staging infra when code merges to `preview` branch | Vercel Preview, Render staging, Supabase staging project |
| `production` | Deployed to production infra when code merges to `main` branch | Vercel Production, Render production, Supabase production project |

You should **never** use staging/production values during normal local development. The `local` environment exists specifically so you develop against your local Docker Supabase, local API, etc.

---

## Canonical Variables — The Complete Grid

These are the real values you enter into Infisical. **Every cell tells you exactly what to type.**

### Core App Secrets

| Variable | `local` | `staging` | `production` |
|---|---|---|---|
| `SUPABASE_URL` | `http://127.0.0.1:54321` | `https://YOUR_STAGING_REF.supabase.co` ← copy from Supabase staging dashboard → Settings → API → Project URL | `https://YOUR_PROD_REF.supabase.co` ← copy from Supabase production dashboard → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU` ← this is the deterministic local key, same for everyone | Copy from Supabase staging dashboard → Settings → API → `service_role` key (⚠️ secret!) | Copy from Supabase production dashboard → Settings → API → `service_role` key (⚠️ secret!) |
| `SUPABASE_ANON_KEY` | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0` ← this is the deterministic local key, same for everyone | Copy from Supabase staging dashboard → Settings → API → `anon` `public` key | Copy from Supabase production dashboard → Settings → API → `anon` `public` key |
| `STRIPE_SECRET_KEY` | `sk_test_placeholder` ← literal string, billing flows won't work locally unless you use a real test key | Copy from Stripe dashboard → Developers → API keys → Secret key (test mode: `sk_test_...`) | Copy from Stripe dashboard → Developers → API keys → Secret key (live mode: `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_placeholder` ← literal string, webhooks won't work locally unless you use Stripe CLI | Copy from Stripe dashboard → Developers → Webhooks → your staging endpoint → Signing secret | Copy from Stripe dashboard → Developers → Webhooks → your production endpoint → Signing secret |
| `STRIPE_PRICE_ID` | `price_placeholder` ← literal string, subscription flows won't work locally unless you create a test price | Copy from Stripe dashboard → Products → your product → Pricing → Price ID (`price_...`) | Copy from Stripe dashboard → Products → your product → Pricing → Price ID (`price_...`) |
| `API_URL` | `http://localhost:3001/v1` | `https://api-staging.frapp.live/v1` | `https://api.frapp.live/v1` |
| `APP_URL` | `http://localhost:3000` | `https://app.staging.frapp.live` | `https://app.frapp.live` |

### API-Only Settings

| Variable | `local` | `staging` | `production` |
|---|---|---|---|
| `PORT` | `3001` | `3001` | `3001` |
| `NODE_ENV` | `development` | `production` | `production` |
| `SENTRY_DSN` | _(leave empty — no error tracking locally)_ | Copy from Sentry → Settings → Client Keys → DSN | Copy from Sentry → Settings → Client Keys → DSN |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | `0.1` | `0.1` |

### CD Secrets (Deploy Workflows Only)

These are only used by GitHub Actions. Leave them empty in the `local` environment — they're not needed for local development.

| Variable | `local` | `staging` | `production` |
|---|---|---|---|
| `RENDER_DEPLOY_HOOK_URL` | _(leave empty)_ | Copy from Render dashboard → frapp-api-staging → Settings → Deploy Hook → copy URL | Copy from Render dashboard → frapp-api-prod → Settings → Deploy Hook → copy URL |
| `API_HEALTHCHECK_URL` | _(leave empty)_ | `https://api-staging.frapp.live/health` | `https://api.frapp.live/health` |
| `SUPABASE_PROJECT_REF` | _(leave empty)_ | Copy from Supabase staging dashboard → Settings → General → Reference ID (looks like `abcdefghijklmnop`) | Copy from Supabase production dashboard → Settings → General → Reference ID |
| `SUPABASE_ACCESS_TOKEN` | _(leave empty)_ | Go to https://supabase.com/dashboard/account/tokens → Generate token → copy it. **Same token for both staging and production** — it's an account-level token. | _(same token as staging)_ |

---

## References — Framework-Specific Names

Add these in **all three environments** in Infisical. The value is always the same reference string — Infisical resolves it to the canonical value for that environment.

| Variable | Value to enter in Infisical | Which app reads it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `${SUPABASE_URL}` | apps/web |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `${SUPABASE_ANON_KEY}` | apps/web |
| `NEXT_PUBLIC_API_URL` | `${API_URL}` | apps/web |
| `NEXT_PUBLIC_APP_URL` | `${APP_URL}` | apps/landing |
| `EXPO_PUBLIC_SUPABASE_URL` | `${SUPABASE_URL}` | apps/mobile |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `${SUPABASE_ANON_KEY}` | apps/mobile |
| `EXPO_PUBLIC_API_URL` | `${API_URL}` | apps/mobile |

**You type the literal string `${SUPABASE_URL}` as the value.** Infisical recognizes this as a reference and resolves it at sync/inject time.

---

## What Each App Actually Reads

### apps/api (NestJS — Render)

Reads these directly (no prefix needed):

| Variable | Source file | Required |
|---|---|---|
| `SUPABASE_URL` | `supabase.provider.ts` | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase.provider.ts` | ✅ |
| `SUPABASE_ANON_KEY` | `env.validation.ts` | ✅ |
| `STRIPE_SECRET_KEY` | `stripe.service.ts` | ✅ |
| `STRIPE_WEBHOOK_SECRET` | `stripe.service.ts` | ✅ |
| `STRIPE_PRICE_ID` | `stripe.service.ts` | ✅ |
| `PORT` | `main.ts` (default: `3001`) | ❌ |
| `NODE_ENV` | `main.ts` (default: `development`) | ❌ |
| `SENTRY_DSN` | `main.ts` (optional) | ❌ |
| `SENTRY_TRACES_SAMPLE_RATE` | `main.ts` (default: `0.1`) | ❌ |

### apps/web (Next.js — Vercel)

Reads the `NEXT_PUBLIC_*` references:

| Variable | Source file | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/client.ts`, `server.ts` | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase/client.ts`, `server.ts` | ✅ |
| `NEXT_PUBLIC_API_URL` | `lib/providers/frapp-client-provider.tsx` | ✅ |

### apps/landing (Next.js — Vercel)

| Variable | Source file | Required |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `app/page.tsx` | ✅ |

### apps/docs (Next.js — Vercel)

**No environment variables. None. Zero.**

### apps/mobile (Expo — EAS)

Reads the `EXPO_PUBLIC_*` references:

| Variable | Source | Required |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase client init (future) | ✅ |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase client init (future) | ✅ |
| `EXPO_PUBLIC_API_URL` | API client init + `eas.json` | ✅ |

---

## Infisical → Provider Syncs

| # | Infisical env | Destination | What gets synced |
|---|---|---|---|
| 1 | staging | Vercel → frapp-web (Preview scope) | `NEXT_PUBLIC_*` vars |
| 2 | production | Vercel → frapp-web (Production scope) | `NEXT_PUBLIC_*` vars |
| 3 | staging | Vercel → frapp-landing (Preview scope) | `NEXT_PUBLIC_APP_URL` |
| 4 | production | Vercel → frapp-landing (Production scope) | `NEXT_PUBLIC_APP_URL` |
| 5 | staging | Render → frapp-api-staging | `SUPABASE_*`, `STRIPE_*`, `SENTRY_*`, `PORT`, `NODE_ENV` |
| 6 | production | Render → frapp-api-prod | `SUPABASE_*`, `STRIPE_*`, `SENTRY_*`, `PORT`, `NODE_ENV` |
| 7 | per-env | GitHub Actions (OIDC) | `RENDER_DEPLOY_HOOK_URL`, `API_HEALTHCHECK_URL`, `SUPABASE_*` |

**7 of 10 free-tier integrations used. frapp-docs has no env vars — no sync needed.**

---

## GitHub Secrets (Bootstrap Only)

| Secret | Where to get it |
|---|---|
| `INFISICAL_MACHINE_IDENTITY_ID` | Infisical → Settings → Machine Identities → Create → copy ID |
| `INFISICAL_PROJECT_ID` | Infisical → Project Settings → copy Project ID |

**That's it. 2 secrets. Everything else comes from Infisical.**

---

## Local Development

**Primary method (recommended — no `.env.local` files):**

```bash
# One-time: install Infisical CLI and login
npm install -g @infisical/cli
npx infisical login

# Then run any app:
npm run dev:api      # Injects local env vars → starts API on :3001
npm run dev:web      # Injects local env vars → starts web on :3000
npm run dev:landing  # Injects local env vars → starts landing on :3002
npm run dev:mobile   # Injects local env vars → starts Expo
```

**Fallback (if you don't want to use Infisical CLI):**

Create `.env.local` files in each app directory with the values from the `local` column above. These files are gitignored.

---

## Adding a New Variable

1. Add to code (`process.env.YOUR_VAR` or `ConfigService`).
2. Add canonical value to Infisical in all 3 environments.
3. If it needs a framework prefix → add an Infisical reference (`NEXT_PUBLIC_YOUR_VAR = ${YOUR_VAR}`).
4. Update this document.

## Removing a Variable

1. Remove from code.
2. Remove from Infisical (all environments, canonical + references).
3. Update this document.
