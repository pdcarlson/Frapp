# Deployment Status Tracker

Last updated: 2026-04-16

## Environment branch model

- `main` → staging / pre-production
- `production` → production

## Surface rollout status

| Surface                 | Staging (`main`) | Production (`production`) | Notes                                                                                                      |
| ----------------------- | ---------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Landing (Vercel)        | ✅               | ✅                        | Project exists; Vercel production branch is `production`, preview deploys target `main`                    |
| Web dashboard (Vercel)  | ✅               | ✅                        | Project exists; Vercel production branch is `production`, preview deploys target `main`                    |
| Docs (Vercel)           | —                | —                         | **Retired:** `apps/docs` removed from repo; pause/delete `frapp-docs` in Vercel (see `docs/DEPLOYMENT.md`)   |
| API (Render)            | ⚠️               | ⚠️                        | Build settings corrected via Render API, but runtime remains degraded because current Supabase hostnames do not resolve and production is also missing Stripe runtime vars |
| Mobile (EAS/App Stores) | 🚧               | 🚧                        | Build and store pipeline not finalized                                                                     |

## Provider branch wiring audit (2026-04-16)

| Provider | Resource                          | Expected      | Current          | Status                              |
| -------- | --------------------------------- | ------------- | ---------------- | ----------------------------------- |
| Render   | `frapp-api-staging`               | `main`        | `c/staging-application-foundation-2a54` (temporary) | ⚠️ Staging deploy now reaches `live`, but `/health` is `degraded` because database connectivity is failing |
| Render   | `frapp-api-prod`                  | `production`  | `production`     | ⚠️ Production service config corrected, but runtime is still blocked by unresolved Supabase host / missing Stripe vars |
| Vercel   | `frapp-web` production branch     | `production`  | `production`     | ✅                                  |
| Vercel   | `frapp-landing` production branch | `production`  | `production`     | ✅                                  |
| Supabase | `frapp-staging` project branches  | none required | 0 branch objects | ✅                                  |
| Supabase | `frapp-prod` project branches     | none required | 0 branch objects | ✅                                  |

### Current runtime blockers (verified 2026-04-16)

- `Deploy API` fails on `main` because `.github/workflows/deploy-api.yml` used `npm install -g supabase@2.77.0`, which Supabase CLI no longer supports.
- A separate recent `Deploy API` failure was caused by a missing staging `RENDER_DEPLOY_HOOK_URL` GitHub environment secret.
- `https://api.frapp.live/health` currently returns `502` with Render routing header `x-render-routing: no-deploy`.
- `https://api-staging.frapp.live/health` currently times out.
- `https://app.staging.frapp.live` and `https://staging.frapp.live` return `401 Authentication Required`; this is intentional Vercel protection and not a bug.

### Render API audit (verified 2026-04-16)

- Both Render services were configured with an incorrect Docker monorepo setup:
  - `rootDir: apps/api`
  - `dockerfilePath: ./Dockerfile`
- Corrected provider-side configuration to:
  - `rootDir: ""`
  - `dockerfilePath: "apps/api/Dockerfile"`
- Staging service was temporarily pointed at `c/staging-application-foundation-2a54` and redeployed to validate the feature branch code path.
- That deploy reached `live`, but both:
  - `https://frapp-api-staging.onrender.com/health`
  - `https://api-staging.frapp.live/health`
  now return `{"status":"degraded","database":"error"}`.
- The current Render env values point at Supabase hosts that do **not** resolve via DNS from the audit environment:
  - staging `SUPABASE_URL` host: `hnoyzpidbmizhbqaiity.supabase.co`
  - production `SUPABASE_URL` host: `unttyvyfezddlyafcydh.supabase.co`
- Production Render is also missing four Stripe runtime vars that exist in the documented env matrix:
  - `STRIPE_PRICE_ID`
  - `STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`

### Vercel truth

- `frapp-web` production branch is already `production`.
- `frapp-landing` production branch is already `production`.
- Latest `main` preview deployment for `frapp-web` is `READY`.
- Latest `main` preview deployment for `frapp-landing` is intentionally `CANCELED` by the ignored-build step because no landing changes were detected.

## API deployment pending checklist

- [x] Confirm Render staging service env matrix (Supabase + Stripe + Sentry)
- [x] Confirm Render production service env matrix (Supabase + Stripe + Sentry)
- [ ] Validate DNS records for `api-staging.frapp.live` and `api.frapp.live`
- [x] Validate fail-fast startup checks (missing required env vars fail boot)
- [ ] Run smoke checks after deploy (`/health`, key auth-protected endpoint)
- [ ] Verify staging Stripe webhook routing/secret (`/v1/webhooks/stripe`)
- [x] Wire deploy hook + healthcheck URL secrets for both environments
- [x] Replace unsupported global Supabase CLI install in deploy workflow
- [x] Correct Render Docker service config (`rootDir` + `dockerfilePath`)
- [ ] Replace unresolved Supabase hostnames with live project URLs in Infisical / Render
- [ ] Add missing production Stripe runtime variables in Infisical / Render

## Database promotion discipline checklist

- [ ] Promotion follows `DB_PROMOTION_RUNBOOK.md`
- [ ] Rollback plan documented in `DB_ROLLBACK_PLAYBOOK.md`
- [ ] Migration safety checks pass in CI/deploy workflows

## Mobile deployment pending checklist

- [ ] Finalize `app.json` owner/project values
- [ ] Configure EAS project secrets per environment
- [ ] Validate preview build profile end-to-end
- [ ] Define production release checklist for App Store + Play Store
