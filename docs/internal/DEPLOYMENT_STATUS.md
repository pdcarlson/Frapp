# Deployment Status Tracker

Last updated: 2026-03-19

## Environment branch model

- `main` → staging / pre-production
- `production` → production

## Surface rollout status

| Surface                 | Staging (`main`) | Production (`production`) | Notes                                                                                                      |
| ----------------------- | ---------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Landing (Vercel)        | ⚠️               | ⚠️                        | Project exists; Vercel production branch is still `main` and must be switched to `production` in dashboard |
| Web dashboard (Vercel)  | ⚠️               | ⚠️                        | Project exists; Vercel production branch is still `main` and must be switched to `production` in dashboard |
| Docs (Vercel)           | —                | —                         | **Retired:** `apps/docs` removed from repo; pause/delete `frapp-docs` in Vercel (see `docs/DEPLOYMENT.md`)   |
| API (Render)            | ✅               | ✅                        | `frapp-api-staging -> main`, `frapp-api-prod -> production` verified via Render API                        |
| Mobile (EAS/App Stores) | 🚧               | 🚧                        | Build and store pipeline not finalized                                                                     |

## Provider branch wiring audit (2026-03-19)

| Provider | Resource                          | Expected      | Current          | Status                              |
| -------- | --------------------------------- | ------------- | ---------------- | ----------------------------------- |
| Render   | `frapp-api-staging`               | `main`        | `main`           | ✅                                  |
| Render   | `frapp-api-prod`                  | `production`  | `production`     | ✅ (corrected on 2026-03-19)        |
| Vercel   | `frapp-web` production branch     | `production`  | `main`           | ⚠️ manual dashboard update required |
| Vercel   | `frapp-landing` production branch | `production`  | `main`           | ⚠️ manual dashboard update required |
| Supabase | `frapp-staging` project branches  | none required | 0 branch objects | ✅                                  |
| Supabase | `frapp-prod` project branches     | none required | 0 branch objects | ✅                                  |

### Vercel caveat

The public Vercel REST API currently exposes `productionBranch` in project responses but does not expose a supported write field for changing it through `PATCH /v9|v10/projects/{idOrName}`.

For this repository, set the production branch manually in the Vercel dashboard for each project:

1. `frapp-web`
2. `frapp-landing`

Path: **Project → Settings → Git → Production Branch = `production`**

After changes, verify deployment routing:

- `target=production` uses branch `production`
- `target=preview` uses branch `main`

## API deployment pending checklist

- [ ] Confirm Render staging service env matrix (Supabase + Stripe + Sentry)
- [ ] Confirm Render production service env matrix (Supabase + Stripe + Sentry)
- [ ] Validate DNS records for `api-staging.frapp.live` and `api.frapp.live`
- [ ] Validate fail-fast startup checks (missing required env vars fail boot)
- [ ] Run smoke checks after deploy (`/health`, key auth-protected endpoint)
- [ ] Verify staging Stripe webhook routing/secret (`/v1/webhooks/stripe`)
- [ ] Wire deploy hook + healthcheck URL secrets for both environments

## Database promotion discipline checklist

- [ ] Promotion follows `DB_PROMOTION_RUNBOOK.md`
- [ ] Rollback plan documented in `DB_ROLLBACK_PLAYBOOK.md`
- [ ] Migration safety checks pass in CI/deploy workflows

## Mobile deployment pending checklist

- [ ] Finalize `app.json` owner/project values
- [ ] Configure EAS project secrets per environment
- [ ] Validate preview build profile end-to-end
- [ ] Define production release checklist for App Store + Play Store
