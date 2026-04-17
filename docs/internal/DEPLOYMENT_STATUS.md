# Deployment Status Tracker

Last updated: 2026-04-17 (Vercel staging alias follow-up on main pushes)

## Environment branch model

- `main` → staging / pre-production
- `production` → production

## Surface rollout status

| Surface                 | Staging (`main`) | Production (`production`) | Notes                                                                                                           |
| ----------------------- | ---------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Landing (Vercel)        | ✅               | ✅                        | Project exists; Vercel production branch is `production`, preview deploys target `main`                         |
| Web dashboard (Vercel)  | ✅               | ✅                        | Project exists; Vercel production branch is `production`, preview deploys target `main`                         |
| Docs (Vercel)           | —                | —                         | **Retired:** `apps/docs` removed from repo; pause/delete `frapp-docs` in Vercel (see `docs/DEPLOYMENT.md`)        |
| API (Render)            | ✅               | ⚠️                        | Staging is live on `main`; production still lacks Stripe runtime config for a successful deploy                 |
| Mobile (EAS/App Stores) | 🚧               | 🚧                        | Build and store pipeline not finalized                                                                          |

## Provider branch wiring audit (2026-04-16, verified after PR #208 merge)

| Provider | Resource                          | Expected      | Current          | Status                                                                                                      |
| -------- | --------------------------------- | ------------- | ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Render   | `frapp-api-staging`               | `main`        | `main`           | ✅ Latest deploy on merge SHA is `live`; `/health` returns `status: ok`, `database: connected`              |
| Render   | `frapp-api-prod`                  | `production`  | `production`     | ⚠️ Service config correct, but runtime is still blocked by missing Stripe vars                              |
| Vercel   | `frapp-web` production branch     | `production`  | `production`     | ✅                                                                                                          |
| Vercel   | `frapp-landing` production branch | `production`  | `production`     | ✅                                                                                                          |
| Supabase | `frapp-staging` project branches  | none required | 0 branch objects | ✅                                                                                                          |
| Supabase | `frapp-prod` project branches     | none required | 0 branch objects | ✅                                                                                                          |

### Current runtime blockers (verified 2026-04-16)

- Production Render is missing four Stripe runtime vars that exist in the documented env matrix:
  - `STRIPE_PRICE_ID`
  - `STRIPE_PUBLISHABLE_KEY`
  - `STRIPE_SECRET_KEY`
  - `STRIPE_WEBHOOK_SECRET`
  Until these land in Infisical (env `prod`), `https://api.frapp.live/health` will continue to return `502`.
- `https://app.staging.frapp.live` and `https://staging.frapp.live` return `401 Authentication Required`; this is intentional Vercel deployment protection and not a bug.

### Known CI drift (not a runtime blocker)

- `CI` workflow on `main` is currently red because `web-visual-regression` crashes at Playwright `webServer` startup — `apps/web/proxy.ts` calls `createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, …)` at module load and CI has no Supabase env vars. Render still deploys via its own GitHub auto-deploy integration, so user traffic is unaffected, but the `Deploy API` workflow's real steps are gated off until CI is green. Fix options tracked separately: lazy-initialize the Supabase client in `proxy.ts`, or inject dummy `NEXT_PUBLIC_SUPABASE_*` values in the `web-visual-regression` job.

### Render API audit (resolved via PR #208)

- Docker monorepo config on both services is now:
  - `rootDir: ""`
  - `dockerfilePath: "apps/api/Dockerfile"`
- Staging service is back on `main` (was temporarily pointed at `c/staging-application-foundation-2a54` while validating the feature branch).
- Supabase hostnames used by Render resolve from the audit environment:
  - staging `SUPABASE_URL` host: `hnoyzpidbmizhbqaiity.supabase.co`
  - production `SUPABASE_URL` host: `unttyvyfezddlyafcydh.supabase.co`
- `.github/workflows/deploy-api.yml` no longer uses the unsupported global `npm install -g supabase@2.77.0`; it uses `supabase/setup-cli@v2` with Infisical-injected secrets.

### Vercel truth

- `frapp-web` production branch is `production`.
- `frapp-landing` production branch is `production`.
- Latest `main` deployment for `frapp-web` is `READY` on merge SHA.
- Latest `main` deployment for `frapp-landing` was `READY` on merge SHA; earlier commits in the same PR landed as `CANCELED` via turbo-ignore — expected when no landing-app changes were present.
- `.github/workflows/verify-deployments.yml` now surfaces any post-push Render / Vercel failure as a GitHub check.
- **Staging DNS vs deployment URL (2026-04-17):** API checks showed `app.staging.frapp.live` correctly configured on the project with `gitBranch: main`, yet several consecutive `READY` `main` deployments had **no** alias to that hostname (only the default `*.vercel.app` URL). CI now runs `scripts/ci/ensure-vercel-staging-alias.mjs` on `main` pushes so `app.staging.frapp.live` / `staging.frapp.live` track the latest deployment for the pushed SHA after it reaches `READY`.

## API deployment pending checklist

- [x] Confirm Render staging service env matrix (Supabase + Stripe + Sentry)
- [x] Confirm Render production service env matrix (Supabase + Stripe + Sentry)
- [x] Validate DNS records for `api-staging.frapp.live` and `api.frapp.live`
- [x] Validate fail-fast startup checks (missing required env vars fail boot)
- [x] Run smoke checks after deploy (`/health`, key auth-protected endpoint)
- [ ] Verify staging Stripe webhook routing/secret (`/v1/webhooks/stripe`)
- [x] Wire deploy hook + healthcheck URL secrets for both environments
- [x] Replace unsupported global Supabase CLI install in deploy workflow
- [x] Correct Render Docker service config (`rootDir` + `dockerfilePath`)
- [x] Re-test Supabase hostnames after projects resumed; staging host resolves and connects again
- [x] Point Render staging back to `main` after feature-branch validation
- [ ] Add missing production Stripe runtime variables in Infisical / Render
- [ ] Resolve `web-visual-regression` CI failure so `Deploy API` workflow steps resume running

## Database promotion discipline checklist

- [ ] Promotion follows `DB_PROMOTION_RUNBOOK.md`
- [ ] Rollback plan documented in `DB_ROLLBACK_PLAYBOOK.md`
- [ ] Migration safety checks pass in CI/deploy workflows

## Mobile deployment pending checklist

- [ ] Finalize `app.json` owner/project values
- [ ] Configure EAS project secrets per environment
- [ ] Validate preview build profile end-to-end
- [ ] Define production release checklist for App Store + Play Store
