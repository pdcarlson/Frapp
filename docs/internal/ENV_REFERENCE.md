# Environment Variable Reference

> **This is the single source of truth for every environment variable in the Frapp project.**
>
> All values are managed in [Infisical](https://infisical.com). Canonical values are stored once per environment. Framework-specific names (e.g., `NEXT_PUBLIC_*`) are Infisical **secret references** that resolve to the canonical value — change it in one place, it updates everywhere.

---

## How It Works

```text
┌──────────────────────────────────────────────────────────────────┐
│                     INFISICAL                                     │
│                                                                   │
│  Canonical values (stored once, value changes per environment):   │
│    SUPABASE_URL = https://staging.supabase.co                     │
│    SUPABASE_ANON_KEY = eyJ...                                     │
│    API_URL = https://api-staging.frapp.live/v1                    │
│                                                                   │
│  References (resolve to canonical, same in all environments):     │
│    NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}                     │
│    NEXT_PUBLIC_SUPABASE_ANON_KEY = ${SUPABASE_ANON_KEY}           │
│    NEXT_PUBLIC_API_URL = ${API_URL}                               │
│    EXPO_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}                     │
│    ...                                                            │
│                                                                   │
│  Syncs push resolved values to:                                   │
│    → Vercel (frapp-web, frapp-landing)                            │
│    → Render (frapp-api-staging, frapp-api-prod)                   │
│    → GitHub Actions (via OIDC or environment-scoped secrets)      │
└──────────────────────────────────────────────────────────────────┘
```

**Change `SUPABASE_URL` once → every reference (`NEXT_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`) updates automatically.**

---

## Canonical Variables

These are the real values. Stored once per Infisical environment. No duplicates, no suffixes.

| Variable | local | staging | production | Used by |
|---|---|---|---|---|
| `SUPABASE_URL` | `http://127.0.0.1:54321` | `https://<stg-ref>.supabase.co` | `https://<prd-ref>.supabase.co` | API, Web*, Mobile* |
| `SUPABASE_SERVICE_ROLE_KEY` | from `npx supabase status` | Supabase dashboard | Supabase dashboard | API only |
| `SUPABASE_ANON_KEY` | from `npx supabase status` | Supabase dashboard | Supabase dashboard | API, Web*, Mobile* |
| `STRIPE_SECRET_KEY` | `sk_test_...` (or placeholder) | `sk_test_...` | `sk_live_...` | API only |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (or placeholder) | `whsec_...` | `whsec_...` | API only |
| `STRIPE_PRICE_ID` | `price_...` (or placeholder) | `price_...` | `price_...` | API only |
| `API_URL` | `http://localhost:3001/v1` | `https://api-staging.frapp.live/v1` | `https://api.frapp.live/v1` | Web*, Mobile* |
| `APP_URL` | `http://localhost:3000` | `https://app.staging.frapp.live` | `https://app.frapp.live` | Landing* |
| `PORT` | `3001` | `3001` | `3001` | API only |
| `NODE_ENV` | `development` | `production` | `production` | API only |
| `SENTRY_DSN` | _(empty)_ | from Sentry | from Sentry | API only |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | `0.1` | `0.1` | API only |
| `RENDER_DEPLOY_HOOK_URL` | _(n/a)_ | staging hook URL | production hook URL | GitHub Actions |
| `API_HEALTHCHECK_URL` | _(n/a)_ | `https://api-staging.frapp.live/health` | `https://api.frapp.live/health` | GitHub Actions |
| `SUPABASE_PROJECT_REF` | _(n/a)_ | staging project ref | production project ref | GitHub Actions |
| `SUPABASE_ACCESS_TOKEN` | _(n/a)_ | (same token) | (same token) | GitHub Actions |

\* Web and Mobile consume these via references (see below), not the canonical name directly.

---

## References (Framework-Specific Names)

These are Infisical **secret references** — they resolve to a canonical value. Defined identically in all three environments. When the canonical value changes, all references update automatically.

| Reference | Resolves to | Consumed by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `${SUPABASE_URL}` | apps/web |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `${SUPABASE_ANON_KEY}` | apps/web |
| `NEXT_PUBLIC_API_URL` | `${API_URL}` | apps/web |
| `NEXT_PUBLIC_APP_URL` | `${APP_URL}` | apps/landing |
| `EXPO_PUBLIC_SUPABASE_URL` | `${SUPABASE_URL}` | apps/mobile |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `${SUPABASE_ANON_KEY}` | apps/mobile |
| `EXPO_PUBLIC_API_URL` | `${API_URL}` | apps/mobile |

**Total: 16 canonical + 7 references = 23 entries. Zero value duplication.**

---

## What Each App Reads

### apps/api (NestJS — Render)

| Variable | Source (code) | Required |
|---|---|---|
| `SUPABASE_URL` | `supabase.provider.ts` via ConfigService | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | `supabase.provider.ts` via ConfigService | ✅ |
| `SUPABASE_ANON_KEY` | `env.validation.ts` | ✅ |
| `STRIPE_SECRET_KEY` | `stripe.service.ts` via ConfigService | ✅ |
| `STRIPE_WEBHOOK_SECRET` | `stripe.service.ts` via ConfigService | ✅ |
| `STRIPE_PRICE_ID` | `stripe.service.ts` via ConfigService | ✅ |
| `PORT` | `main.ts` (default: `3001`) | ❌ |
| `NODE_ENV` | `main.ts` (default: `development`) | ❌ |
| `SENTRY_DSN` | `main.ts` (optional) | ❌ |
| `SENTRY_TRACES_SAMPLE_RATE` | `main.ts` (default: `0.1`) | ❌ |

### apps/web (Next.js — Vercel)

| Variable | Source (code) | Required |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/client.ts`, `server.ts` | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `lib/supabase/client.ts`, `server.ts` | ✅ |
| `NEXT_PUBLIC_API_URL` | `lib/providers/frapp-client-provider.tsx` | ✅ |

### apps/landing (Next.js — Vercel)

| Variable | Source (code) | Required |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `app/page.tsx` | ✅ |

### apps/docs (Next.js — Vercel)

**No environment variables.**

### apps/mobile (Expo — EAS)

| Variable | Source (code) | Required |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase client init (future) | ✅ |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase client init (future) | ✅ |
| `EXPO_PUBLIC_API_URL` | API client init + `eas.json` profiles | ✅ |

---

## Where Everything Lives

### Infisical → Provider Syncs

| # | Source (Infisical) | Destination | What gets synced |
|---|---|---|---|
| 1 | staging env | Vercel → frapp-web (Preview scope) | `NEXT_PUBLIC_*` vars |
| 2 | staging env | Vercel → frapp-landing (Preview scope) | `NEXT_PUBLIC_APP_URL` |
| 3 | staging env | Render → frapp-api-staging | `SUPABASE_*`, `STRIPE_*`, `SENTRY_*`, `PORT`, `NODE_ENV` |
| 4 | production env | Vercel → frapp-web (Production scope) | `NEXT_PUBLIC_*` vars |
| 5 | production env | Vercel → frapp-landing (Production scope) | `NEXT_PUBLIC_APP_URL` |
| 6 | production env | Render → frapp-api-prod | `SUPABASE_*`, `STRIPE_*`, `SENTRY_*`, `PORT`, `NODE_ENV` |
| 7 | per-env | GitHub Actions (OIDC) | `RENDER_DEPLOY_HOOK_URL`, `API_HEALTHCHECK_URL`, `SUPABASE_*` |

**7 of 10 free-tier integrations used.**

### GitHub Secrets (bootstrap only)

| Secret | Purpose |
|---|---|
| `INFISICAL_MACHINE_IDENTITY_ID` | Connect GitHub Actions → Infisical |
| `INFISICAL_PROJECT_ID` | Infisical project identifier |

**2 secrets total.** Everything else comes from Infisical via environment-scoped injection.

### GitHub Environments

The deploy workflow uses GitHub's `environment:` feature. Secrets like `RENDER_DEPLOY_HOOK_URL` are injected from the correct Infisical environment based on which job runs (staging vs production). **No `_STAGING` / `_PRODUCTION` suffixes needed.**

### EAS (Mobile Builds)

| Variable | How it gets there |
|---|---|
| `EXPO_PUBLIC_API_URL` | Hardcoded per profile in `eas.json` |
| `EXPO_PUBLIC_SUPABASE_URL` | `eas secret:create` (or future Infisical sync) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `eas secret:create` (or future Infisical sync) |

---

## Local Development

**Primary method (no `.env.local` files needed):**

```bash
# One-time setup
npx infisical login

# Run any app with secrets injected from Infisical's local environment
npm run dev:api      # → infisical run --env=local -- npm run start:dev -w apps/api
npm run dev:web      # → infisical run --env=local -- npm run dev -w apps/web
npm run dev:landing  # → infisical run --env=local -- npm run dev -w apps/landing
npm run dev:mobile   # → infisical run --env=local -- npm run start -w apps/mobile
```

**Fallback (if Infisical CLI not available):**

Create `.env.local` files manually using values from `npx supabase status -o env`. See each app section above for the exact variables needed.

---

## Adding a New Environment Variable

1. **Add to code** — reference via `process.env.YOUR_VAR` or `ConfigService`.
2. **Add canonical value to Infisical** — set in all three environments (local, staging, production).
3. **If it needs a framework prefix** — add an Infisical reference (e.g., `NEXT_PUBLIC_YOUR_VAR = ${YOUR_VAR}`).
4. **Update this document** — add rows to the relevant tables.
5. **Verify syncs** — ensure the variable reaches the correct provider.

## Removing an Environment Variable

1. **Remove from code** — delete all references.
2. **Remove from Infisical** — delete from all environments (canonical + any references).
3. **Update this document** — remove the rows.
