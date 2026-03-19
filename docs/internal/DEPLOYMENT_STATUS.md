# Deployment Status Tracker

Last updated: 2026-03-04

## Environment branch model

- `main` → staging / pre-production
- `production` → production

## Surface rollout status

| Surface | Staging (`main`) | Production (`production`) | Notes |
| ------- | ------------------- | ------------------- | ----- |
| Landing (Vercel) | ✅ | ✅ | Branch-filtered staging domain configured |
| Web dashboard (Vercel) | ✅ | ✅ | Branch-filtered staging domain configured |
| Docs (Vercel) | ✅ | ✅ | Public docs live |
| API (Render) | 🚧 | 🚧 | Deployment configuration in progress |
| Mobile (EAS/App Stores) | 🚧 | 🚧 | Build and store pipeline not finalized |

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
