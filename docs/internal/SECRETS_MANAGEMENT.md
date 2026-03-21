# Secrets Management with Infisical

## Overview

All secrets for the Frapp project are centrally managed in [Infisical](https://infisical.com) (free tier) with automatic syncs to deployment providers. This eliminates managing secrets across multiple dashboards.

> **For the complete variable list per app per environment, see [`ENV_REFERENCE.md`](./ENV_REFERENCE.md).**
> This document covers the Infisical setup, sync configuration, and operational procedures.

## Key Design Principles

1. **Canonical values stored once.** Each secret (e.g., `SUPABASE_URL`) is stored once per Infisical environment. The value changes per environment (local/staging/production), but the name stays the same.

2. **References eliminate duplication.** Framework-specific names (`NEXT_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`) are Infisical **secret references** that resolve to the canonical value. Change `SUPABASE_URL` → all references update.

3. **No environment suffixes.** There's no `RENDER_DEPLOY_HOOK_URL_STAGING` — just `RENDER_DEPLOY_HOOK_URL` with different values per environment. GitHub's `environment:` feature and Infisical's environment scoping handle the routing.

4. **No `.env.local` files (primary path).** Default local run is **`npm run dev:stack`** from the repo root (API + web + landing + docs; secrets from Infisical `local` via the CLI). Requires `npx infisical login` on the machine. Per-app `dev:*` and fallbacks: [`LOCAL_DEV.md`](./LOCAL_DEV.md).

## Architecture

```text
┌──────────────────────────────────────────────────────────────────┐
│                          INFISICAL                                │
│                                                                   │
│  Canonical values (stored once, value changes per environment):   │
│    SUPABASE_URL, SUPABASE_ANON_KEY, STRIPE_SECRET_KEY, ...       │
│                                                                   │
│  References (resolve to canonical):                               │
│    NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}                     │
│    EXPO_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}                     │
│    NEXT_PUBLIC_API_URL = ${API_URL}                               │
│    ...                                                            │
│                                                                   │
│  3 environments: local, staging, production                       │
│  7 syncs: Vercel ×4, Render ×2, GitHub Actions ×1                │
└──────────────────────────────────────────────────────────────────┘
```

## Free Tier Limits

| Resource     | Limit | Our Usage                      |
| ------------ | ----- | ------------------------------ |
| Identities   | 5     | 1 (admin)                      |
| Projects     | 3     | 1 (Frapp)                      |
| Environments | 3     | 3 (local, staging, production) |
| Integrations | 10    | 7                              |

## Initial Setup

### 1. Create Infisical Account

1. Go to https://app.infisical.com/signup
2. Create account with your GitHub email
3. Create a new project named "Frapp"

### 2. Create Environments

| Environment | Slug         | Maps to                               |
| ----------- | ------------ | ------------------------------------- |
| Local       | `local`      | Local development via `infisical run` |
| Staging     | `staging`    | `main` branch deploys                 |
| Production  | `production` | `production` branch deploys           |

### 3. Add Canonical Values

For each environment, add the canonical values from the table in [`ENV_REFERENCE.md`](./ENV_REFERENCE.md#canonical-variables). Start with staging:

| Variable                    | Staging value                                      |
| --------------------------- | -------------------------------------------------- |
| `SUPABASE_URL`              | `https://<staging-ref>.supabase.co`                |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase staging dashboard                    |
| `SUPABASE_ANON_KEY`         | From Supabase staging dashboard                    |
| `STRIPE_SECRET_KEY`         | `sk_test_...` from Stripe test mode                |
| `STRIPE_WEBHOOK_SECRET`     | `whsec_...` from Stripe                            |
| `STRIPE_PRICE_ID`           | `price_...` from Stripe                            |
| `API_URL`                   | `https://api-staging.frapp.live/v1`                |
| `APP_URL`                   | `https://app.staging.frapp.live`                   |
| `RENDER_DEPLOY_HOOK_URL`    | From Render staging service dashboard              |
| `API_HEALTHCHECK_URL`       | `https://api-staging.frapp.live/health`            |
| `SUPABASE_PROJECT_REF`      | Staging project reference ID                       |
| `SUPABASE_ACCESS_TOKEN`     | From https://supabase.com/dashboard/account/tokens |

Repeat for `production` with production values, and `local` with local values.

### 4. Add References

In **all three environments**, add these references (they're the same in every environment — the canonical value they resolve to changes per environment):

| Variable                        | Value (Infisical reference syntax) |
| ------------------------------- | ---------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `${SUPABASE_URL}`                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `${SUPABASE_ANON_KEY}`             |
| `NEXT_PUBLIC_API_URL`           | `${API_URL}`                       |
| `NEXT_PUBLIC_APP_URL`           | `${APP_URL}`                       |
| `EXPO_PUBLIC_SUPABASE_URL`      | `${SUPABASE_URL}`                  |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `${SUPABASE_ANON_KEY}`             |
| `EXPO_PUBLIC_API_URL`           | `${API_URL}`                       |

### 5. Configure Secret Syncs

#### Vercel Syncs (4 syncs)

1. Infisical → Integrations → Add Sync → Vercel
2. Authenticate with Vercel
3. Create syncs:

| #   | Infisical env | Vercel project | Vercel scope |
| --- | ------------- | -------------- | ------------ |
| 1   | staging       | frapp-web      | Preview      |
| 2   | production    | frapp-web      | Production   |
| 3   | staging       | frapp-landing  | Preview      |
| 4   | production    | frapp-landing  | Production   |

#### Render Syncs (2 syncs)

1. Infisical → Integrations → Add Sync → Render
2. Create syncs:

| #   | Infisical env | Render service    |
| --- | ------------- | ----------------- |
| 5   | staging       | frapp-api-staging |
| 6   | production    | frapp-api-prod    |

#### GitHub Actions (1 sync)

1. Infisical → Integrations → Add → GitHub Actions
2. Configure OIDC-based authentication
3. The deploy workflow uses GitHub's `environment:` feature to scope secrets per job

| #   | Infisical env        | GitHub environment            |
| --- | -------------------- | ----------------------------- |
| 7   | staging + production | Repository (via OIDC per job) |

### 6. Configure GitHub

Add these secrets to GitHub repository settings (Settings → Secrets → Actions):

**Infisical bootstrap (permanent):**

| Secret                          | Value                                           |
| ------------------------------- | ----------------------------------------------- |
| `INFISICAL_MACHINE_IDENTITY_ID` | From Infisical Machine Identity → Client ID     |
| `INFISICAL_CLIENT_SECRET`       | From Infisical Machine Identity → Client Secret |
| `INFISICAL_PROJECT_ID`          | From Infisical → Project Settings → Project ID  |

**Transitional (until Infisical GitHub Action injection is wired):**

The deploy workflow (`deploy-api.yml`) currently uses `${{ secrets.* }}` for these. They should be set as **GitHub environment-scoped secrets** (staging and production environments) or synced via the Infisical GitHub Actions integration:

| Secret                   | Staging value                           | Production value                |
| ------------------------ | --------------------------------------- | ------------------------------- |
| `SUPABASE_ACCESS_TOKEN`  | Account-level token (same for both)     | (same)                          |
| `SUPABASE_PROJECT_REF`   | Staging project ref                     | Production project ref          |
| `RENDER_DEPLOY_HOOK_URL` | Staging deploy hook URL                 | Production deploy hook URL      |
| `API_HEALTHCHECK_URL`    | `https://api-staging.frapp.live/health` | `https://api.frapp.live/health` |

Once the `@infisical/secrets-action` is integrated into the deploy workflow, these transitional secrets can be removed from GitHub and injected from Infisical at runtime.

### 7. Update `.infisical.json`

Replace `REPLACE_WITH_INFISICAL_PROJECT_ID` in `.infisical.json` with the actual project ID.

### 8. Test Local Development

```bash
npx infisical login
npm run dev:stack   # Default: API + web + landing + docs from repo root
```

Per-app commands and fallbacks: [`LOCAL_DEV.md`](./LOCAL_DEV.md).

## Secret Rotation Policy

| Secret Type               | Rotation Frequency      | Procedure                                                    |
| ------------------------- | ----------------------- | ------------------------------------------------------------ |
| Supabase service role key | On suspected compromise | Regenerate in Supabase → update canonical value in Infisical |
| Stripe secret key         | On suspected compromise | Regenerate in Stripe → update canonical value in Infisical   |
| Render deploy hook URLs   | On service recreation   | Copy from Render → update canonical value in Infisical       |
| Supabase access token     | Every 90 days           | Regenerate in Supabase account → update in Infisical         |

**All rotations happen in one place (Infisical).** Syncs propagate changes to all providers automatically.

## Emergency Procedures

### Secret Exposed

1. **Immediately** rotate the secret in the source provider (Supabase/Stripe/etc.)
2. Update the canonical value in Infisical (one place)
3. Syncs propagate automatically — verify all services are healthy
4. If committed to git: notify team, consider force-push to remove

### Infisical Down

- Existing secrets in Vercel/Render/GitHub are unaffected (synced copies persist)
- New changes must go directly to providers temporarily
- When Infisical recovers, reconcile and re-sync

## Audit

- Infisical dashboard → Audit Log for all secret access
- Verify sync health periodically for all 7 integrations
- Review no unexpected access patterns

## Provider API token sanity checks (operations)

When running infrastructure automation (agents/scripts), validate provider API credentials before making write calls:

- **Vercel token check**
  - `GET https://api.vercel.com/v2/user` should return an authenticated user.
- **Render token check**
  - `GET https://api.render.com/v1/services?limit=1` should return JSON data.
- **Supabase management token check**
  - `GET https://api.supabase.com/v1/projects` should return accessible projects.

Important:

- Keep provider API keys distinct (`VERCEL_API_KEY`, `RENDER_API_KEY`, `SUPABASE_API_KEY`, `INFISICAL_API_KEY`).
- Do not reuse one provider's token in another provider variable.
