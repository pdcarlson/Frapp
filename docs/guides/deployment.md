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
- **Last verified: 2026-09-02** (Vercel API: `link: null` on both projects) — the owner
  **disconnected both Vercel projects from Git**: `frapp-landing` on 2026-09-01 and `frapp-web`
  about six and a half hours later on 2026-09-02. Nothing deploys staging web or landing on merge
  any more (both hosts are frozen at their last Git build). The daily production-guardrails run was
  red for the same reason — its Production Branch assertion read a `link` that is now `null` — and
  because that same script is the preflight inside `deploy-production.yml`, that **blocked
  production deploys** until **#1579** inverted the assertion on 2026-09-02 to require the absence
  of a Git link instead.
  Unchanged as policy: since #1340 production is only ever deployed from a **named commit** by
  `deploy-production.yml` through the Vercel API with `target: production`, so nothing
  auto-promotes — though that workflow's Vercel step passes a `gitSource` the integration used to
  supply and is therefore **presumed broken** (not observed failing). **ADR-21** in
  [`spec/architecture/README.md`](../../spec/architecture/README.md) is the canonical record of the
  unlink — the per-project dates, the freeze points and every live breakage. The repairs are
  tracked in **#1579** (the guardrail and `verify-deployments.yml`'s Vercel jobs; the fix
  **inverts** the assertion so a *present* Git link is the violation, rather than deleting it) and
  **#1578** (CI-driven `vercel build` + `vercel deploy --prebuilt --prod`, CI/CD stage 7 under the
  #1381 epic — designed, not built). The `git` block and the `ignoreCommand: "exit 1"` pin in each
  app's `vercel.json` govern nothing while the projects stay unlinked, but **must not be deleted**
  — they are the versioned form of settings that are otherwise dashboard-only.
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
