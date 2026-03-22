# Deployment

This page is the public-facing deployment overview for Frapp.

For the full operator runbook (DNS, provider setup, and detailed checklists), use the repository file [`docs/DEPLOYMENT.md`](../DEPLOYMENT.md).

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
- **Last verified: 2026-03-22** — Preview deployments for the web and landing apps are produced when changes are **merged** into `main` (not from direct pushes; protected branches require PR merge).
- **Last verified: 2026-03-22** — Automatic production deployments on Vercel run from **`main`** and **`production`** only; feature/PR branches are not auto-deployed to production hosting.
- **Last verified: 2026-03-22** — API deployment (Render) is still being finalized; confirm hooks and health checks in `docs/DEPLOYMENT.md` before relying on automation.
- **Last verified: 2026-03-22** — Mobile App Store / Play Store deployment is still being finalized (EAS); treat store releases as manual until the release runbook is complete.

## Deployment sources of truth

- Environment and CI/CD spec: `spec/environments.md`
- Full deployment runbook: `docs/DEPLOYMENT.md`

## Safe documentation rule

Deployment documentation should always separate:

1. **Current live state** (what is actually deployed now)
2. **Target state** (what is planned but not yet live)

This avoids drift and prevents false assumptions during releases.
