# Frapp Deployment Guide

This guide walks through the complete deployment setup: Vercel for frontends, Render for the API, Supabase Cloud for the database, and EAS for mobile. It covers both **staging** and **production** environments.

This folder is the canonical operator runbook for those providers and the CI/CD gate that ships them. **Routers link; leaves assert.** Cite a leaf and a heading anchor, never `§N`.

## Current rollout status

- ✅ Landing and web are configured in Vercel with Preview and Production environments.
  **Both Vercel projects are disconnected from Git** by deliberate owner decision —
  `frapp-landing` on 2026-09-01 and `frapp-web` about six and a half hours later on 2026-09-02
  (ADR-21) — so no push deploys either one. Both are deployed **from CI** instead, by
  `deploy-vercel-staging.yml` (after green CI on `main`) and `deploy-production.yml` (on a
  dispatched SHA), since #1578. See [§ 4 Vercel Setup](vercel.md).
- ✅ CI pipeline uses domain-specific parallel jobs with required status checks.
- ✅ Branch protection enforced on `main`, the only long-lived branch (#1340).
- ✅ Staging API deployment is automated: after green CI on `main`,
  `.github/workflows/deploy-api.yml` applies staging migrations, then deploys **that commit**
  to `frapp-api-staging` through the Render API and waits until `/health/ready` reports it
  ([#2505](https://github.com/pdcarlson/Frapp/issues/2505)). [Deploy verification](ci-cd.md#deploy-verification) has the details.
- ⚠️ Render-side auto-deploy **must be off** on staging too (`staging-conformance.yml` asserts
  it): it builds every push before CI and before the migration, and its deploy can cancel the one
  `deploy-api.yml` creates. It was still **on** when read on 2026-09-25; turning it off is owner
  step [#2679](https://github.com/pdcarlson/Frapp/issues/2679).
- ✅ Production API deployment does **not** use auto-deploy either. `deploy-production.yml` calls
  the Render API with an explicit `commitId`, so what ships is the commit a human named.
  This requires `frapp-api-prod` to have auto-deploy **off** and to track `main`;
  `scripts/ci/production-guardrails.mjs` asserts both, on a schedule and again as a
  preflight before every deploy. Both dashboard settings have been in place since the
  #1340 cutover and the scheduled guardrail has been green since #1579 inverted its Vercel
  half (2026-09-02); the earlier note here that it "fails by design" described the window
  before those settings were changed and was stale by 2026-09-06.
- ✅ Infisical is the central secrets store; deploy workflows inject secrets from it, and provider
  syncs are inventoried in [`SECRETS_MANAGEMENT.md`](../../environment/SECRETS_MANAGEMENT.md).
- ✅ Staging database migrations apply automatically on every green `main` run (`migrate-staging`
  in `deploy-api.yml`, since #1265). Production migrations run inside `deploy-production.yml`,
  after a replay against production's live applied state —
  [`DB_PROMOTION_RUNBOOK.md`](../DB_PROMOTION_RUNBOOK.md) has the current production state.
- 🚧 Mobile store distribution is planned; local and EAS workflows are documented.

Treat this guide as the target-state runbook plus current operational notes.
For live rollout tracking, see **GitHub Issues** — work status is not a doc
([`DOCUMENTATION_CONVENTIONS.md`](../../DOCUMENTATION_CONVENTIONS.md#where-a-fact-lives) § Where a fact lives,
[`GITHUB_PM.md`](../../ci-cd/GITHUB_PM.md)).

---

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐
│   Landing   │     │     Web     │
│  (Vercel)   │     │  (Vercel)   │
│ frapp.live  │     │app.frapp.live│
└──────┬──────┘     └──────┬──────┘
       │                   │
       │                   ▼
       │            ┌─────────────┐
       │            │     API     │
       │            │  (Render)   │
       │            │api.frapp.live│
       │            └──────┬──────┘
       │                   │
       │                   ▼
       │            ┌─────────────┐     ┌─────────────┐
       │            │  Supabase   │     │   Stripe    │
       │            │   Cloud     │     │             │
       │            └─────────────┘     └─────────────┘
       │
       ▼
┌─────────────┐
│   Mobile    │
│   (EAS)     │
│ App Stores  │
└─────────────┘
```

---

| Leaf | What it asserts |
| --- | --- |
| [Prerequisites](prerequisites.md) | Accounts and the `frapp.live` domain. |
| [Git branching model](branching.md) | One long-lived branch; production is a named commit. |
| [Supabase Cloud](supabase.md) | Hosted projects, migrations, keys, and Auth settings. |
| [Vercel](vercel.md) | Web and landing: CI-driven deploys, env scopes, DNS, `vercel.json` pins. |
| [Render (API)](render.md) | API services, health check, in-process workers and scheduled jobs. |
| [Mobile (EAS)](mobile.md) | EAS profiles, env vars, and store-bound configuration. |
| [Integrations](integrations.md) | Stripe (test/live) and the Discord archive-importer bot. |
| [Launch checklist](launch.md) | Staging/production checklist and hobby-tier cost notes. |
| [CI/CD pipeline](ci-cd.md) | How deployments are gated, required checks, deploy verification. |
| [Troubleshooting](troubleshooting.md) | Common deploy failures and where to look. |

Secrets are **not** restated here. Infisical is the store; the sync map and free-tier inventory live in [`SECRETS_MANAGEMENT.md`](../../environment/SECRETS_MANAGEMENT.md). The complete variable list is [`ENV_REFERENCE.md`](../../environment/ENV_REFERENCE.md). The retired `frapp-docs` project is recorded under [Vercel](vercel.md#retired-frapp-docs-and-docsfrapplive).

Promotion and rollback of schema are their own runbooks: [`DB_PROMOTION_RUNBOOK.md`](../DB_PROMOTION_RUNBOOK.md) and [`DB_ROLLBACK_PLAYBOOK.md`](../DB_ROLLBACK_PLAYBOOK.md).
