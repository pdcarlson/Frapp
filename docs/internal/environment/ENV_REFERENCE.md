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
| `local` | Running the app on your machine against local Docker Supabase | `npm run dev:stack` (API + web + landing); per-app: see [`LOCAL_DEV.md`](./LOCAL_DEV.md) |
| `staging` | Deployed to staging infra when code merges to `main` branch | Vercel Preview, Render staging, Supabase staging project |
| `production` | Deployed to production infra when code merges to `production` branch | Vercel Production, Render production, Supabase production project |

> **Infisical API note:** the Production environment is named “Production” in the UI, but its API/runtime slug is currently `prod`. GitHub Actions and provider automation should use the real slug returned by the Infisical API.

**Local uses local Supabase (Docker) but real staging Stripe/Sentry keys.** This lets you test billing flows, webhook handling, and error tracking during local development without pushing to main. Supabase stays local because the database schema and seed data are managed by your local Docker instance.

---

## Canonical Variables — The Complete Grid

These are the real values you enter into Infisical. **Every cell tells you exactly what to type.**

### Core App Secrets

| Variable | `local` | `staging` | `production` |
|---|---|---|---|
| `SUPABASE_URL` | `http://127.0.0.1:54321` | `https://YOUR_STAGING_REF.supabase.co` ← copy from Supabase staging dashboard → Settings → API → Project URL | `https://YOUR_PROD_REF.supabase.co` ← copy from Supabase production dashboard → Settings → API → Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Output of `npx supabase status -o env` for your local stack (`SUPABASE_SERVICE_ROLE_KEY`) | Copy from Supabase staging dashboard → Settings → API → `service_role` key (⚠️ secret!) | Copy from Supabase production dashboard → Settings → API → `service_role` key (⚠️ secret!) |
| `SUPABASE_ANON_KEY` | Output of `npx supabase status -o env` for your local stack (`SUPABASE_ANON_KEY`) | Copy from Supabase staging dashboard → Settings → API → `anon` `public` key | Copy from Supabase production dashboard → Settings → API → `anon` `public` key |
| `STRIPE_SECRET_KEY` | **Same as staging** — use your real Stripe test-mode key (`sk_test_...`) so you can test billing flows locally. Copy from Stripe dashboard → Developers → API keys → Secret key (test mode). | ← same `sk_test_...` key as local | Copy from Stripe dashboard → Developers → API keys → Secret key (live mode: `sk_live_...`) |
| `STRIPE_WEBHOOK_SECRET` | **Same as staging** — use your real Stripe webhook signing secret. For local testing, run `stripe listen --forward-to localhost:3001/v1/billing/webhook` and use the `whsec_...` it prints. | Copy from Stripe dashboard → Developers → Webhooks → staging endpoint → Signing secret | Copy from Stripe dashboard → Developers → Webhooks → production endpoint → Signing secret |
| `STRIPE_PRICE_ID` | **Same as staging** — use the same test-mode Price ID. Copy from Stripe dashboard → Products → your product → Pricing → Price ID (`price_...`). | ← same `price_...` as local | Copy from Stripe dashboard → Products → your product → Pricing → Price ID (production `price_...`) |
| `API_URL` | `http://localhost:3001/v1` | `https://api-staging.frapp.live/v1` | `https://api.frapp.live/v1` |
| `APP_URL` | `http://localhost:3000` | `https://app.staging.frapp.live` | `https://app.frapp.live` |

### API-Only Settings

| Variable | `local` | `staging` | `production` |
|---|---|---|---|
| `PORT` | `3001` | `3001` | `3001` |
| `NODE_ENV` | `development` | `production` | `production` |
| `SENTRY_DSN` | **Same as staging** — use the same DSN so errors during local development show up in Sentry. Copy from Sentry → Settings → Client Keys → DSN. | ← same DSN as local | Copy from Sentry → Settings → Client Keys → DSN (use a separate production project if you want isolation) |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | `0.1` | `0.1` |
| `SUPABASE_JWT_SECRET` | The `JWT secret` field from `npx supabase status -o env` for your local stack | Copy from Supabase staging dashboard → Settings → API → JWT Settings → `JWT Secret` (⚠️ secret!) | Copy from Supabase production dashboard → Settings → API → JWT Settings → `JWT Secret` (⚠️ secret!) |

> `SUPABASE_JWT_SECRET` is **optional**. It lets the API verify access-token signatures locally so the rate limiter can key buckets per authenticated user (see `spec/architecture/README.md`, Security). When it is absent the limiter safely falls back to per-IP keying — set it in every environment to enable per-user limiting.

### Analytics (Pseudonymous — API-only)

Product analytics is pseudonymous by construction: the API keys every event by `hmac_sha256(salt, user_id)` and the raw user id never reaches the provider (`spec/behavior/data-retention.md` #analytics-events-pseudonymous). **The salt is API-only on purpose** — it must never be exposed to a client bundle (no `NEXT_PUBLIC_`/`EXPO_PUBLIC_` reference), or the dataset could be rainbow-tabled back to user ids. Clients fetch their pseudonymous id from `GET /v1/analytics/identity` and post events through `POST /v1/analytics/events`; the API does the keying.

| Variable | `local` | `staging` | `production` |
|---|---|---|---|
| `ANALYTICS_HMAC_SALT` | _(optional locally)_ a random 32+ char hex string — generate with `openssl rand -hex 32`. When empty, server analytics is disabled. | A **distinct** random per-environment salt (`openssl rand -hex 32`). Held only here, never in the analytics provider. | A **distinct** random per-environment salt (`openssl rand -hex 32`). Held only here, never in the analytics provider. |
| `POSTHOG_API_KEY` | _(leave empty → no-op provider, events logged at debug only)_ | PostHog project API key (`phc_...`) for the staging project | PostHog project API key (`phc_...`) for the production project |
| `POSTHOG_HOST` | _(leave empty → defaults to `https://us.i.posthog.com`)_ | Override only for EU/self-host | Override only for EU/self-host |

> All three are **optional**. With no `POSTHOG_API_KEY` the API uses a no-op provider (debug logging), and with no `ANALYTICS_HMAC_SALT` server analytics is disabled entirely — so local dev, tests, and CI run without any analytics secret.

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
| `SUPABASE_JWT_SECRET` | `custom-throttler.guard.ts` (per-user rate-limit keying; falls back to per-IP when unset) | ❌ |
| `ANALYTICS_HMAC_SALT` | `analytics.service.ts` (per-env salt for pseudonymous keying; analytics disabled when unset) | ❌ |
| `POSTHOG_API_KEY` | `analytics.module.ts` (selects PostHog vs no-op provider) | ❌ |
| `POSTHOG_HOST` | `analytics.module.ts` (provider host override; default PostHog US) | ❌ |

### apps/web (Next.js — Vercel)

Reads the `NEXT_PUBLIC_*` references:

| Variable | Source file | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/client.ts`, `server.ts` | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase/client.ts`, `server.ts` | ✅ |
| `NEXT_PUBLIC_API_URL` | `lib/providers/frapp-client-provider.tsx` | ✅ |
| `NEXT_PUBLIC_LANDING_URL` | `components/onboarding/chapter-wizard.tsx` | ❌ — optional; base URL of the marketing site for the legal links (Terms/Privacy/FERPA) in chapter onboarding. Defaults to `https://frapp.live` when unset. |
| `SUPABASE_AUTH_BYPASS` | `proxy.ts` | ❌ — CI-only flag (`"true"` skips auth redirects so Playwright visual tests can render protected pages; ignored when `NODE_ENV` is `production`) |

### apps/landing (Next.js — Vercel)

| Variable | Source file | Required |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `app/page.tsx` | ✅ |

### apps/mobile (Expo — EAS)

Reads the `EXPO_PUBLIC_*` references:

| Variable | Source | Required |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `lib/supabase.ts` — Supabase client init | ✅ |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase.ts` — Supabase client init | ✅ |
| `EXPO_PUBLIC_API_URL` | API client init + `eas.json` | ✅ |

Both Supabase values are read at module scope and are **optional at boot**: when
either is missing `getSupabaseClient()` returns `null` instead of throwing, so
`npm run check-types` / `npm run test` and a bare `expo start` still work. Sign-in
is unavailable in that state and the sign-in screen says so.

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
| 7 | per-env | GitHub environment-scoped secrets (transitional) | `RENDER_DEPLOY_HOOK_URL`, `API_HEALTHCHECK_URL`, `SUPABASE_*` |

**6 of 10 free-tier integrations used** (web + landing Vercel syncs; no separate docs Vercel project in active use) — as of **2026-03-22**; re-check in **Infisical → Integrations** (or your Infisical billing/plan view) before treating the count as current.

---

## GitHub Secrets

**Permanent (Infisical bootstrap):**

| Secret | Where to get it |
|---|---|
| `INFISICAL_MACHINE_IDENTITY_ID` | Infisical → Organization Settings → Machine Identities → Client ID |
| `INFISICAL_CLIENT_SECRET` | Infisical → Machine Identity → Universal Auth → Client Secret |
| `INFISICAL_PROJECT_ID` | Infisical → Project Settings → Project ID |

**Current deploy workflow state:**

`deploy-api.yml` now injects deploy-time secrets directly from Infisical using `Infisical/secrets-action`. That means GitHub **environment-scoped** copies of:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `RENDER_DEPLOY_HOOK_URL`
- `API_HEALTHCHECK_URL`

are **no longer required** for the workflow to run, as long as the three bootstrap repository secrets above remain valid and the referenced Infisical project/environment slugs exist.

---

## Local Development

**Primary method (recommended — no `.env.local` files):**

```bash
# One-time: Infisical CLI (also available via repo devDependency / npx)
npx infisical login

# Default — API + web + landing from repo root:
npm run dev:stack
```

Mobile and per-app `dev:*` commands: [`LOCAL_DEV.md`](./LOCAL_DEV.md).

**Fallback (if you don't want to use Infisical CLI):**

Create `.env.local` files in each app directory with the values from the `local` column above. These files are gitignored.

### Production builds (`npm run build`) and `NODE_ENV`

The two Next apps build through [`scripts/next-build.mjs`](../../../scripts/next-build.mjs), which pins
`NODE_ENV=production` for the build. **Do not change `build` back to a bare `next build`.**

`next build` does *not* force a production `NODE_ENV` — `next/dist/bin/next` only warns, then does
`process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv`, so an ambient `NODE_ENV=development`
survives. Next selects its server runtime purely off that value
(`next/dist/server/route-modules/app-page/module.compiled.js`), loading the React **dev** runtime to
prerender chunks Turbopack compiled against the React **prod** runtime. Two React copies means the
prod copy's dispatcher is `null`, so the first hook in Next's own `OuterLayoutRouter` throws:

```
TypeError: Cannot read properties of null (reading 'useContext')
```

Every prerendered route dies; the route named in the error is just whichever build worker reached it
first, so the failure looks route-specific when it is not. The cloud sandbox exports
`NODE_ENV=development`, which is what surfaced this (FRA-305). `next build --debug-prerender` is
unaffected — Next sets `NODE_ENV=development` itself, after the wrapper hands off.

`apps/web` additionally needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` **at build
time** — several dashboard routes construct a Supabase client while prerendering. Without them the
build fails on `/chat` with `Your project's URL and API key are required to create a Supabase client!`.
Vercel supplies these; locally, run the build under `npx infisical run` or export them from your local
stack values.

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
