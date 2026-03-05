# Secrets Management with Infisical

## Overview

All secrets for the Frapp project are centrally managed in [Infisical](https://infisical.com) (free tier) with automatic syncs to deployment providers. This eliminates the need to manage secrets in multiple provider dashboards.

> **For the complete list of every environment variable, per app, per environment, see [`ENV_REFERENCE.md`](./ENV_REFERENCE.md).** This document covers the Infisical setup, syncs, and rotation policy.

## Architecture

```text
┌──────────────────────────────────┐
│        Infisical Cloud           │
│                                  │
│  Project: Frapp                  │
│  Environments:                   │
│    - local (development)         │
│    - staging (preview branch)    │
│    - production (main branch)    │
│                                  │
│  Syncs:                          │
│    → Vercel (frapp-web)          │
│    → Vercel (frapp-landing)      │
│    → Vercel (frapp-docs)         │
│    → Render (frapp-api-staging)  │
│    → Render (frapp-api-prod)     │
│    → GitHub Actions              │
└──────────────────────────────────┘
```

## Free Tier Limits

| Resource | Limit | Our Usage |
| --- | --- | --- |
| Identities | 5 | 1 (admin) |
| Projects | 3 | 1 (Frapp) |
| Environments | 3 | 3 (local, staging, production) |
| Integrations | 10 | ~6-8 |

## Initial Setup

### 1. Create Infisical Account

1. Go to https://app.infisical.com/signup
2. Create account with your GitHub email
3. Create a new project named "Frapp"

### 2. Create Environments

In the Infisical dashboard, create three environments:

| Environment | Slug | Description |
| --- | --- | --- |
| Local | `local` | Local development (reference only, `.env.local` used) |
| Staging | `staging` | Maps to `preview` branch |
| Production | `production` | Maps to `main` branch |

### 3. Import Existing Secrets

Import secrets from your current provider dashboards into the corresponding Infisical environments:

#### Staging Environment

From Vercel (frapp-web, Preview scope):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_API_URL`

From Vercel (frapp-landing, Preview scope):
- `NEXT_PUBLIC_APP_URL`

From Render (frapp-api-staging):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
- `STRIPE_SECRET_KEY` (sk_test_...)
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_PRICE_ID`

From GitHub Secrets:
- `RENDER_DEPLOY_HOOK_URL_STAGING`
- `API_STAGING_HEALTHCHECK_URL`

#### Production Environment

Same keys as staging, but with production values:
- Supabase production project credentials
- Stripe live mode keys (sk_live_...)
- Production Render deploy hook URL
- Production health check URL

### 4. Configure Secret Syncs

For each provider, create an Infisical secret sync:

#### Vercel Syncs

1. In Infisical → Integrations → Add Sync → Vercel
2. Authenticate with Vercel
3. Create syncs for each app:
   - `frapp-web` → Staging environment → Vercel Preview scope
   - `frapp-web` → Production environment → Vercel Production scope
   - `frapp-landing` → Staging environment → Vercel Preview scope
   - `frapp-landing` → Production environment → Vercel Production scope
   - `frapp-docs` → (no secrets needed, skip)

#### Render Syncs

1. In Infisical → Integrations → Add Sync → Render
2. Authenticate with Render
3. Create syncs:
   - `frapp-api-staging` → Staging environment
   - `frapp-api-prod` → Production environment

#### GitHub Actions

1. In Infisical → Integrations → Add → GitHub Actions
2. Configure OIDC-based authentication (recommended for public repos)
3. Or use Machine Identity with `INFISICAL_MACHINE_IDENTITY_ID` secret

### 5. Configure GitHub Actions

Add these secrets to the GitHub repository (Settings → Secrets):

| Secret | Value | Purpose |
| --- | --- | --- |
| `INFISICAL_MACHINE_IDENTITY_ID` | From Infisical Machine Identity setup | OIDC auth to Infisical |
| `INFISICAL_PROJECT_ID` | From Infisical project settings | Project identifier |

### 6. Update `.infisical.json`

Replace `REPLACE_WITH_INFISICAL_PROJECT_ID` in `.infisical.json` with the actual project ID from Infisical.

## Secret Rotation Policy

| Secret Type | Rotation Frequency | Procedure |
| --- | --- | --- |
| Supabase service role key | On suspected compromise | Regenerate in Supabase dashboard → update in Infisical |
| Stripe secret key | On suspected compromise | Regenerate in Stripe dashboard → update in Infisical |
| Stripe webhook secret | On webhook endpoint change | Regenerate in Stripe dashboard → update in Infisical |
| Render deploy hook URLs | On service recreation | Copy new URL from Render → update in Infisical |
| GitHub PAT | Every 90 days | Regenerate in GitHub Settings → update where used |

## Emergency Procedures

### Secret Exposed in Logs / Commit

1. **Immediately** rotate the exposed secret in the source provider (Supabase/Stripe/etc.)
2. Update the new value in Infisical
3. Wait for syncs to propagate (or trigger manual sync)
4. Verify all services are healthy
5. If committed to git: force-push to remove the commit (coordinate with team)

### Infisical Down

If Infisical is unavailable:
- Existing secrets in Vercel/Render/GitHub are unaffected (they're synced copies)
- New secrets must be added directly to providers temporarily
- When Infisical recovers, add the secrets there and verify sync

## Audit

Infisical provides an audit log of all secret access. Review periodically:
- Infisical dashboard → Audit Log
- Verify no unexpected access patterns
- Verify sync health for all integrations

## Local Development

For local development, continue using `.env.local` files:
- These are never committed (in `.gitignore`)
- Local Supabase keys come from `npx supabase status -o env`
- Stripe test keys can be placeholders unless testing billing

Optionally, use the Infisical CLI for local development:
```bash
npx infisical run --env=local -- npm run start:dev -w apps/api
```

This injects secrets from Infisical's `local` environment at runtime.
