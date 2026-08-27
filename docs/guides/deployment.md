# Deployment

This page is the public-facing deployment overview for Frapp.

For the full operator runbook (DNS, provider setup, and detailed checklists), use the repository file [`docs/internal/ops/DEPLOYMENT.md`](../internal/ops/DEPLOYMENT.md).

## Branch and environment model

Frapp uses two long-lived environment branches:

- `main` → pre-production/staging environments
- `production` → production environments

Feature branches (`feature/*`) merge into `main` first, then `main` is promoted into `production`.

> **Note:** `develop` is not part of the active workflow. `main` is the integration branch for staging.

## Current rollout state

> **Workflow:** Feature work branches from `main` → PR to `main` (branch protection blocks direct pushes to `main` / `production`). Verify live behavior against provider dashboards when in doubt.

- Vercel projects are active for:
  - landing (`frapp.live`)
  - web dashboard (`app.frapp.live`)
- **Last verified: 2026-08-27** (Vercel API: every `main` commit produced a deployment with no production target) — Preview/staging deployments for the web and landing apps are produced when changes are **merged** into `main` (not from direct pushes; protected branches require PR merge).
- **Last verified: 2026-08-27** (`git.deploymentEnabled` in each app's `vercel.json`: only `main` and `production` auto-deploy) — On Vercel, **automatic production deployments** for web and landing run from the **`production`** branch only. **Merges to `main`** produce **preview / staging** deployments (not production). Feature/PR branches are not promoted to production hosting automatically.
- **Last verified: 2026-08-27** (Render API: `frapp-api-staging` auto-deploys `main` and was live at the latest `main` commit; `frapp-api-prod` tracks `production`) — API deployment (Render) is **automated**: `.github/workflows/deploy-api.yml` gates staging deploys on green CI and applies staging migrations on every `main` run. Production deploys track the `production` branch; production **migrations** are gated separately — see `docs/internal/ops/DEPLOYMENT.md` and `docs/internal/ops/DB_PROMOTION_RUNBOOK.md` for current production state.
- **Last verified: 2026-03-22** (unverified since — no EAS access from agent sessions) — Mobile App Store / Play Store deployment is still being finalized (EAS); treat store releases as manual until the release runbook is complete.

## Deployment sources of truth

- Environment and CI/CD spec: `spec/environments/README.md`
- Full deployment runbook: `docs/internal/ops/DEPLOYMENT.md`

## Safe documentation rule

Deployment documentation should always separate:

1. **Current live state** (what is actually deployed now)
2. **Target state** (what is planned but not yet live)

This avoids drift and prevents false assumptions during releases.
