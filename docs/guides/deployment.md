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
- **Superseded 2026-09-02 — historical.** Until the Vercel Git integration was removed, preview/staging deployments for the web and landing apps were produced when changes were **merged** into `main` (not from direct pushes; protected branches require PR merge) — **last verified: 2026-08-27** (Vercel API: every `main` commit produced a deployment with no production target). No merge produces a Vercel deployment today; see the next bullet.
- **Last verified: 2026-09-02** (Vercel API: `link: null` on both projects) — the owner **disconnected both Vercel projects (`frapp-web`, `frapp-landing`) from Git**, recorded as **ADR-21** in `spec/architecture/README.md`. There is consequently **no Production Branch setting and no auto-deploy-from-push path at all**: the `git.deploymentEnabled` settings in each app's `vercel.json`, and the "Production Branch must not be `main`" assertion in `scripts/ci/production-guardrails.mjs`, are **moot rather than satisfied** — the fail-open risk that assertion existed for is structurally gone. It is also **currently failing**: it reads `project.link.productionBranch` and treats the absent value as a violation, which reds the daily guardrails run and, because the same script is the preflight inside `deploy-production.yml`, **blocks production deploys**. **Nothing deploys staging web or landing on merge any more** — those hosts are frozen at their last Git build, and `verify-deployments.yml`'s Vercel jobs and `scripts/ci/ensure-vercel-staging-alias.mjs` have failed on every push to `main` since 2026-09-01T20:46Z, because they look for a deployment the integration used to create. Unchanged as policy, and independent of the Git link: since #1340 production is only ever deployed from a **named commit** by `deploy-production.yml` through the Vercel API with `target: production`, so nothing auto-promotes. Its *implementation* is not independent — `deploy-vercel-production.mjs` passes `gitSource`, which needs the Git integration, so it is **presumed broken** (not observed failing), and in any case the guardrail preflight above blocks the workflow before it reaches that step. The replacement model, `vercel build` + `vercel deploy --prebuilt --prod` driven from GitHub Actions, is **designed and not built** — CI/CD stage 7 under #1381.
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
