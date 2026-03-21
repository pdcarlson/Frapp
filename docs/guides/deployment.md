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

- Vercel projects are active for:
  - landing (`frapp.live`)
  - web dashboard (`app.frapp.live`)
  - docs (`docs.frapp.live`)
- Preview deployments are triggered by pushes to `main`.
- Automatic Vercel deployments are limited to `main` and `production` (feature/PR branches are skipped).
- API deployment is still being finalized.
- Mobile App Store / Play Store deployment is still being finalized.

## Deployment sources of truth

- Environment and CI/CD spec: `spec/environments.md`
- Full deployment runbook: `docs/DEPLOYMENT.md`

## Safe documentation rule

Deployment documentation should always separate:

1. **Current live state** (what is actually deployed now)
2. **Target state** (what is planned but not yet live)

This avoids drift and prevents false assumptions during releases.
