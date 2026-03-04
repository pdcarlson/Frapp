# Deployment Status Tracker

Last updated: 2026-03-04

## Environment branch model

- `preview` → staging / pre-production
- `main` → production

## Surface rollout status

| Surface | Staging (`preview`) | Production (`main`) | Notes |
| ------- | ------------------- | ------------------- | ----- |
| Landing (Vercel) | ✅ | ✅ | Branch-filtered staging domain configured |
| Web dashboard (Vercel) | ✅ | ✅ | Branch-filtered staging domain configured |
| Docs (Vercel) | ✅ | ✅ | Public docs live |
| API (Render) | 🚧 | 🚧 | Deployment configuration in progress |
| Mobile (EAS/App Stores) | 🚧 | 🚧 | Build and store pipeline not finalized |

## API deployment pending checklist

- [ ] Confirm Render staging service and env vars
- [ ] Confirm Render production service and env vars
- [ ] Validate DNS records for `api-staging.frapp.live` and `api.frapp.live`
- [ ] Run smoke checks after first deploy (`/health`, key auth-protected endpoint)
- [ ] Wire deploy hook secrets for both environments

## Mobile deployment pending checklist

- [ ] Finalize `app.json` owner/project values
- [ ] Configure EAS project secrets per environment
- [ ] Validate preview build profile end-to-end
- [ ] Define production release checklist for App Store + Play Store
