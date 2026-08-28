# Deployment

This page is the public-facing deployment overview for Frapp.

For the full operator runbook (DNS, provider setup, and detailed checklists), use the repository file [`docs/internal/ops/DEPLOYMENT.md`](../internal/ops/DEPLOYMENT.md).

## Branch and environment model

Frapp has one long-lived branch:

- `main` → pre-production/staging environments

Feature branches (`feature/*`) merge into `main`. Production is deployed from a **named
commit on `main`** by the **Deploy production** workflow (`workflow_dispatch`, typed
confirmation, and an approval on the `production` GitHub Environment). It refuses any
commit that is not an ancestor of `main` with green CI.

> **Note:** neither `develop` nor `production` is part of the active workflow. `main` is
> the integration branch for staging; the `production` branch was retired in #1340.

## Current rollout state

> **Workflow:** Feature work branches from `main` → PR to `main` (branch protection blocks direct pushes to `main`). Verify live behavior against provider dashboards when in doubt.

- Vercel projects are active for:
  - landing (`frapp.live`)
  - web dashboard (`app.frapp.live`)
- **Last verified: 2026-08-27** (Vercel API: every `main` commit produced a deployment with no production target) — Preview/staging deployments for the web and landing apps are produced when changes are **merged** into `main` (not from direct pushes; protected branches require PR merge).
- **Last verified: 2026-08-27** (partially) — On Vercel, **merges to `main`** produce **preview / staging** deployments, never production. `git.deploymentEnabled` in each app's `vercel.json` proves feature/PR branches never auto-deploy, and the Vercel API shows every recent `main` deployment carrying no production target. Since #1340 production deployments are **created by `deploy-production.yml` through the API** with `target: production`, so nothing auto-promotes. The dashboard's Production Branch setting must therefore **not** be `main` — `scripts/ci/production-guardrails.mjs` asserts that, because the setting is dashboard-only and fails open.
- **Last verified: 2026-08-27** (Render API: `frapp-api-staging` auto-deploys `main` and was live at the latest `main` commit) — **staging** API deployment (Render) is **automated**. Note the verified caveat in `docs/internal/ops/DEPLOYMENT.md` § Current rollout status: Render-side auto-deploy currently triggers on **commit**, so a push to `main` deploys staging without waiting for CI; `.github/workflows/deploy-api.yml`'s green-CI gate governs its own deploy hook and the staging migrations it applies on every **green** `main` run. The **production** service is deployed by `commitId` through the Render API by `deploy-production.yml`, which requires its auto-deploy to be **off** — a dashboard-only setting asserted by `scripts/ci/production-guardrails.mjs`. Production **migrations** run inside that same workflow, after a replay against production's live applied state — see `docs/internal/ops/DB_PROMOTION_RUNBOOK.md`.
- **Last verified: 2026-03-22** (unverified since — no EAS access from agent sessions) — Mobile App Store / Play Store deployment is still being finalized (EAS); treat store releases as manual until the release runbook is complete.

## Deployment sources of truth

- Environment and CI/CD spec: `spec/environments/README.md`
- Full deployment runbook: `docs/internal/ops/DEPLOYMENT.md`

## Safe documentation rule

Deployment documentation should always separate:

1. **Current live state** (what is actually deployed now)
2. **Target state** (what is planned but not yet live)

This avoids drift and prevents false assumptions during releases.
