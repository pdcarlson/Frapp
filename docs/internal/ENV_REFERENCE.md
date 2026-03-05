# Environment Variable Reference

> **This is the single source of truth for every environment variable in the Frapp project.**
> All staging and production values are managed in [Infisical](https://infisical.com) and synced automatically to providers. See `docs/internal/SECRETS_MANAGEMENT.md` for the Infisical setup guide.

---

## apps/api (NestJS — deployed on Render)

| Variable | Required | Source (code) | Local | Staging | Production |
|---|---|---|---|---|---|
| `SUPABASE_URL` | ✅ | `supabase.provider.ts` | `http://127.0.0.1:54321` | `https://<staging-ref>.supabase.co` | `https://<prod-ref>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | `supabase.provider.ts` | From `npx supabase status` | Supabase dashboard | Supabase dashboard |
| `SUPABASE_ANON_KEY` | ✅ | `env.validation.ts` | From `npx supabase status` | Supabase dashboard | Supabase dashboard |
| `STRIPE_SECRET_KEY` | ✅ | `stripe.service.ts` | `sk_test_...` | `sk_test_...` | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | ✅ | `stripe.service.ts` | `whsec_...` | `whsec_...` | `whsec_...` |
| `STRIPE_PRICE_ID` | ✅ | `stripe.service.ts` | `price_...` | `price_...` | `price_...` |
| `PORT` | ❌ | `main.ts` (default `3001`) | `3001` | `3001` | `3001` |
| `NODE_ENV` | ❌ | `main.ts` (default `development`) | `development` | `production` | `production` |
| `SENTRY_DSN` | ❌ | `main.ts` (optional) | _(empty)_ | Sentry dashboard | Sentry dashboard |
| `SENTRY_TRACES_SAMPLE_RATE` | ❌ | `main.ts` (default `0.1`) | `0.1` | `0.1` | `0.1` |

**Local file:** `apps/api/.env.local`
**Staging/Production:** Render env vars synced from Infisical

---

## apps/web (Next.js dashboard — deployed on Vercel)

| Variable | Required | Source (code) | Local | Staging | Production |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | `lib/supabase/client.ts`, `server.ts` | `http://127.0.0.1:54321` | `https://<staging-ref>.supabase.co` | `https://<prod-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | `lib/supabase/client.ts`, `server.ts` | From `npx supabase status` | Supabase dashboard | Supabase dashboard |
| `NEXT_PUBLIC_API_URL` | ✅ | `lib/providers/frapp-client-provider.tsx` | `http://localhost:3001/v1` | `https://api-staging.frapp.live/v1` | `https://api.frapp.live/v1` |

**Local file:** `apps/web/.env.local`
**Staging/Production:** Vercel env vars synced from Infisical (Preview / Production scopes)

---

## apps/landing (Next.js marketing site — deployed on Vercel)

| Variable | Required | Source (code) | Local | Staging | Production |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | ✅ | `app/page.tsx` | `http://localhost:3000` | `https://app.staging.frapp.live` | `https://app.frapp.live` |

**Local file:** `apps/landing/.env.local`
**Staging/Production:** Vercel env vars synced from Infisical (Preview / Production scopes)

---

## apps/docs (Next.js documentation — deployed on Vercel)

**No environment variables.** The docs app is pure static content. No Infisical sync needed.

---

## apps/mobile (Expo — builds on EAS)

| Variable | Required | Source (code) | Local | Staging | Production |
|---|---|---|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | ✅ | Supabase client init | `http://127.0.0.1:54321` | `https://<staging-ref>.supabase.co` | `https://<prod-ref>.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Supabase client init | From `npx supabase status` | Supabase dashboard | Supabase dashboard |
| `EXPO_PUBLIC_API_URL` | ✅ | API client init | `http://localhost:3001/v1` | `https://api-staging.frapp.live/v1` | `https://api.frapp.live/v1` |

**Local file:** `apps/mobile/.env.local`
**Staging/Production:** `EXPO_PUBLIC_API_URL` is hardcoded per profile in `eas.json`. `EXPO_PUBLIC_SUPABASE_*` vars are set via `eas secret:create`.

---

## GitHub Actions (CD workflows)

| Secret | Used by | Purpose |
|---|---|---|
| `RENDER_DEPLOY_HOOK_URL` | `deploy-api.yml` | Trigger production API deploy |
| `RENDER_DEPLOY_HOOK_URL_STAGING` | `deploy-api.yml` | Trigger staging API deploy |
| `API_PRODUCTION_HEALTHCHECK_URL` | `deploy-api.yml` | Post-deploy health check |
| `API_STAGING_HEALTHCHECK_URL` | `deploy-api.yml` | Post-deploy health check |
| `SUPABASE_ACCESS_TOKEN` | `deploy-api.yml` | Supabase CLI auth for migrations |
| `SUPABASE_PROJECT_REF_STAGING` | `deploy-api.yml` | Target staging DB for migrations |
| `SUPABASE_PROJECT_REF_PRODUCTION` | `deploy-api.yml` | Target production DB for migrations |
| `GITHUB_TOKEN` | `release.yml` | Auto-provided by GitHub, creates releases |

**Source:** These are injected from Infisical via OIDC in deploy workflows. Only `INFISICAL_MACHINE_IDENTITY_ID` and `INFISICAL_PROJECT_ID` are set directly as GitHub Secrets (bootstrap).

---

## Where Everything Lives — Summary

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    INFISICAL (source of truth)                       │
│                                                                     │
│  staging env: all staging values for every app + CD secrets         │
│  production env: all production values for every app + CD secrets   │
│                                                                     │
│  Syncs:                                                             │
│    → Vercel frapp-web (Preview scope)         staging env           │
│    → Vercel frapp-web (Production scope)      production env        │
│    → Vercel frapp-landing (Preview scope)     staging env           │
│    → Vercel frapp-landing (Production scope)  production env        │
│    → Render frapp-api-staging                 staging env           │
│    → Render frapp-api-prod                    production env        │
│    → GitHub Actions (OIDC)                    per-workflow env      │
│                                                                     │
│  Total syncs: 7 of 10 (free tier)                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    GITHUB SECRETS (bootstrap only)                   │
│                                                                     │
│  INFISICAL_MACHINE_IDENTITY_ID    (connects GH Actions → Infisical)│
│  INFISICAL_PROJECT_ID             (Infisical project identifier)    │
│  SUPABASE_ACCESS_TOKEN            (Supabase CLI for migrations)     │
│                                                                     │
│  Total: 3 secrets                                                   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    LOCAL DEVELOPMENT (.env.local)                    │
│                                                                     │
│  apps/api/.env.local       — Supabase + Stripe (from supabase      │
│  apps/web/.env.local         status or Infisical local env)         │
│  apps/landing/.env.local                                            │
│  apps/mobile/.env.local                                             │
│                                                                     │
│  Or: npx infisical run --env=local -- <command>                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    EAS (mobile builds)                               │
│                                                                     │
│  EXPO_PUBLIC_API_URL              hardcoded per profile in eas.json │
│  EXPO_PUBLIC_SUPABASE_URL         via eas secret:create             │
│  EXPO_PUBLIC_SUPABASE_ANON_KEY    via eas secret:create             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    DOCS (apps/docs)                                  │
│                                                                     │
│  NO environment variables. Zero. None.                              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Local Development Quick Start

Get your local env vars from Supabase:

```bash
npx supabase start
npx supabase status -o env
```

Then create `.env.local` files using the values above. See each app section for the exact variables needed.

**Alternative (Infisical CLI):**

```bash
npx infisical run --env=local -- npm run start:dev -w apps/api
npx infisical run --env=local -- npm run dev -w apps/web
```

This injects secrets at runtime without needing `.env.local` files.

---

## Adding a New Environment Variable

1. **Add to code** — reference it via `process.env.YOUR_VAR` or `ConfigService`.
2. **Add to Infisical** — set values in staging and production environments.
3. **Update this document** — add a row to the relevant app table above.
4. **Update syncs** (if needed) — ensure the var reaches the correct provider.
5. **For local dev** — add to your `.env.local` or Infisical's local environment.

---

## Removing an Environment Variable

1. **Remove from code** — delete all `process.env.YOUR_VAR` references.
2. **Remove from Infisical** — delete from all environments.
3. **Update this document** — remove the row.
4. **Clean up providers** — the next sync will remove it from Vercel/Render (if sync is configured with overwrite).
