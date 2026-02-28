# Frapp Deployment Guide

This guide walks through the complete deployment setup: Vercel for frontends, Render for the API, Supabase Cloud for the database, and EAS for mobile. It covers both **staging** and **production** environments.

---

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Landing   │     │     Web     │     │    Docs     │
│  (Vercel)   │     │  (Vercel)   │     │  (Vercel)   │
│ frapp.live  │     │app.frapp.live│    │docs.frapp.live│
└──────┬──────┘     └──────┬──────┘     └─────────────┘
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

## 1. Prerequisites

Before you begin, you need accounts on:

| Service | URL | Free Tier? |
|---------|-----|------------|
| **Vercel** | https://vercel.com | Yes (Hobby) |
| **Render** | https://render.com | Yes (free web service) |
| **Supabase** | https://supabase.com | Yes (2 free projects) |
| **Stripe** | https://stripe.com | Yes (test mode) |
| **Expo (EAS)** | https://expo.dev | Yes (free builds) |

You also need the `frapp.live` domain registered and DNS managed (Squarespace Domains or Vercel).

---

## 2. Git Branching Model

Two long-lived branches map to environments:

| Branch | Environment | Vercel | Render | Supabase |
|--------|-------------|--------|--------|----------|
| `main` | **Production** | Production deploys → prod domains | `frapp-api-prod` | Production project |
| `preview` | **Staging** | Preview deploys → staging domains | `frapp-api-staging` | Staging project |
| `feature/*` | **Ephemeral** | Auto-generated preview URLs | — | — |

**How it flows:**

```
feature/xyz ──PR──▶ preview (staging) ──PR──▶ main (production)
```

1. Feature branches are created from `main`.
2. Feature PRs target `preview`. Merging triggers staging deployments.
3. Test on staging domains (e.g. `app.staging.frapp.live`).
4. When ready for production, PR from `preview` → `main`.
5. Merging to `main` triggers production deployments.

**Vercel environment mapping:**

| Vercel environment | Git trigger | Domain example |
|---|---|---|
| **Production** | Push to `main` | `docs.frapp.live` |
| **Preview** (pre-production) | Push to `preview` | `docs.staging.frapp.live` |
| **Preview** (ephemeral) | Any other branch / PR | `frapp-docs-abc123.vercel.app` |

The `preview` branch's staging domain is configured by assigning the domain to the Preview environment and filtering to the `preview` branch in Vercel's domain settings.

---

## 3. Supabase Cloud Setup

You need **two** Supabase projects: one for staging, one for production.

### Create Projects

1. Go to https://supabase.com/dashboard → **New Project**.
2. Create `frapp-staging` (region closest to you).
3. Create `frapp-production` (same region).

### Apply Migrations

```bash
# Link to staging project
npx supabase link --project-ref <STAGING_PROJECT_REF>
npx supabase db push

# Link to production project
npx supabase link --project-ref <PRODUCTION_PROJECT_REF>
npx supabase db push
```

### Collect Keys

From each project's dashboard → Settings → API, note:

| Key | Where it goes |
|-----|--------------|
| **Project URL** | `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` |
| **anon public key** | `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **service_role secret key** | `SUPABASE_SERVICE_ROLE_KEY` (API only, never expose to client) |

---

## 4. Vercel Setup

You import the **same GitHub repo three times** — once for each Next.js app. Each import becomes a separate Vercel project with its own domains and env vars.

### 4.1 Import the Repo (repeat for each app)

1. Go to https://vercel.com/new.
2. **Import** your `pdcarlson/Frapp` repo.
3. Configure:

| Setting | Web Dashboard | Landing | Docs |
|---------|--------------|---------|------|
| **Project Name** | `frapp-web` | `frapp-landing` | `frapp-docs` |
| **Framework** | Next.js (auto-detected) | Next.js | Next.js |
| **Root Directory** | `apps/web` | `apps/landing` | `apps/docs` |

**Build and Output Settings:** Leave all toggles OFF. Vercel auto-detects the correct commands for Turborepo monorepos:
- **Install:** `npm install --prefix=../..` (installs from monorepo root)
- **Build:** `turbo run build` (auto-scoped to the current workspace)
- **Output:** Next.js default (`.next`)

The `vercel.json` in each app adds `turbo-ignore` (skip rebuilds when files haven't changed) and security headers — no command overrides needed.

### 4.2 Environment Variables per Project

Vercel scopes env vars to **Production** and **Preview**. The `preview` branch triggers Preview deploys, which use Preview env vars. The `main` branch triggers Production deploys.

#### `frapp-web` (Web Dashboard)

| Variable | Production | Preview (Staging) |
|----------|-----------|-------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<PROD_REF>.supabase.co` | `https://<STAGING_REF>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<prod anon key>` | `<staging anon key>` |
| `NEXT_PUBLIC_API_URL` | `https://api.frapp.live/v1` | `https://api-staging.frapp.live/v1` |

#### `frapp-landing` (Marketing Site)

| Variable | Production | Preview (Staging) |
|----------|-----------|-------------------|
| `NEXT_PUBLIC_APP_URL` | `https://app.frapp.live` | `https://app.staging.frapp.live` |

#### `frapp-docs` (Documentation)

No environment variables needed (static content).

### 4.3 Domain Configuration

In each Vercel project → Settings → Domains:

#### Production Domains (connected to Production environment)

| Project | Domain |
|---------|--------|
| `frapp-web` | `app.frapp.live` |
| `frapp-landing` | `frapp.live` + `www.frapp.live` |
| `frapp-docs` | `docs.frapp.live` |

#### Staging Domains (connected to Preview environment, filtered to `preview` branch)

| Project | Domain | Environment | Branch filter |
|---------|--------|-------------|---------------|
| `frapp-web` | `app.staging.frapp.live` | Preview | `preview` |
| `frapp-landing` | `staging.frapp.live` | Preview | `preview` |
| `frapp-docs` | `docs.staging.frapp.live` | Preview | `preview` |

**To set this up:** In each project, go to Settings → Domains → Add the staging domain → Connect to environment: **Preview** → set the branch filter to `preview`.

### 4.4 DNS Records (Squarespace Domains)

In Squarespace Domains → `frapp.live` → DNS Settings → Custom Records:

```
# Production
frapp.live          A      76.76.21.21
www.frapp.live      CNAME  cname.vercel-dns.com
app.frapp.live      CNAME  cname.vercel-dns.com
docs.frapp.live     CNAME  cname.vercel-dns.com

# Staging
staging.frapp.live       CNAME  cname.vercel-dns.com
app.staging.frapp.live   CNAME  cname.vercel-dns.com
docs.staging.frapp.live  CNAME  cname.vercel-dns.com

# API (Render — fill in after creating Render services)
api.frapp.live           CNAME  <frapp-api-prod>.onrender.com
api-staging.frapp.live   CNAME  <frapp-api-staging>.onrender.com
```

### 4.5 Vercel Project Settings

For each project, verify:

- **Settings → Git → Production Branch**: `main`

---

## 5. Render Setup (API)

Create **two** Render Web Services: one for production, one for staging.

### 5.1 Create Services

1. Go to https://dashboard.render.com → **New** → **Web Service**.
2. Connect your GitHub repo.

| Setting | Production | Staging |
|---------|-----------|---------|
| **Name** | `frapp-api-prod` | `frapp-api-staging` |
| **Branch** | `main` | `preview` |
| **Root Directory** | (leave empty — Dockerfile uses repo root) | (same) |
| **Runtime** | Docker | Docker |
| **Dockerfile Path** | `apps/api/Dockerfile` | `apps/api/Dockerfile` |
| **Instance Type** | Starter ($7/mo) or Free | Free |

### 5.2 Environment Variables

| Variable | Production | Staging |
|----------|-----------|---------|
| `SUPABASE_URL` | `https://<PROD_REF>.supabase.co` | `https://<STAGING_REF>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `<prod service role key>` | `<staging service role key>` |
| `SUPABASE_ANON_KEY` | `<prod anon key>` | `<staging anon key>` |
| `STRIPE_SECRET_KEY` | `sk_live_...` | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` (prod) | `whsec_...` (test) |
| `STRIPE_PRICE_ID` | `price_...` (prod) | `price_...` (test) |
| `PORT` | `3001` | `3001` |
| `NODE_ENV` | `production` | `production` |

### 5.3 Custom Domains

- Production: `api.frapp.live` → point to `frapp-api-prod.onrender.com`
- Staging: `api-staging.frapp.live` → point to `frapp-api-staging.onrender.com`

### 5.4 Health Check

Render auto-detects the health check from the Dockerfile `HEALTHCHECK` directive. The API exposes `GET /health`.

### 5.5 Deploy Hooks (for GitHub Actions)

In each Render service → Settings → Deploy Hook → copy the URL. Store them as GitHub repo secrets:

- `RENDER_DEPLOY_HOOK_URL` → production hook
- `RENDER_DEPLOY_HOOK_URL_STAGING` → staging hook

---

## 6. Mobile (EAS) Setup

### 6.1 Initial Setup

```bash
cd apps/mobile

# Login to Expo
npx eas login

# Initialize EAS project (creates project on expo.dev)
npx eas init

# Update app.json with the project ID from eas init output
# Replace YOUR_EAS_PROJECT_ID and YOUR_EXPO_ACCOUNT
```

### 6.2 Testing on Your Phone (Quickest Path)

**Option A: Expo Go (development, no build required)**

```bash
cd apps/mobile
npm start
# Scan QR code with Expo Go app
# Phone and computer must be on same WiFi
```

**Option B: Development build (better for testing native features)**

```bash
npx eas build --profile development --platform ios
# or --platform android
# Install the resulting build on your device
```

**Option C: Preview build (share with testers)**

```bash
npx eas build --profile preview --platform all
# Generates installable links for iOS (ad-hoc) and Android (APK)
```

### 6.3 Environment Configuration

The `eas.json` already has environment-specific API URLs per build profile. For Supabase keys, add them to each profile:

```bash
# Set secrets for EAS builds (not committed to code)
npx eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "https://<REF>.supabase.co" --scope project
npx eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<key>" --scope project
```

---

## 7. Stripe Setup

### 7.1 Test Mode (Staging)

1. Go to https://dashboard.stripe.com/test → Developers → API keys.
2. Copy `sk_test_...` → use as `STRIPE_SECRET_KEY` for staging API.
3. Create a webhook endpoint pointing at `https://api-staging.frapp.live/v1/billing/webhook`.
4. Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET`.
5. Create a Product + Price → copy price ID → `STRIPE_PRICE_ID`.

### 7.2 Live Mode (Production)

Same steps but toggle to Live mode in Stripe dashboard. Requires business verification.

---

## 8. Step-by-Step Launch Checklist

### Phase 1: Staging (do this first)

- [ ] Create Supabase staging project, apply migrations
- [ ] Create Render staging service (`preview` branch), add env vars
- [ ] Import repo to Vercel 3 times (web, landing, docs)
- [ ] Add Preview env vars to each Vercel project
- [ ] Assign staging domains to `preview` branch in Vercel
- [ ] Configure DNS records for staging subdomains
- [ ] Set up Stripe test mode webhook for staging API URL
- [ ] Push to `preview` → verify all staging sites deploy
- [ ] Test mobile with Expo Go pointing at staging API
- [ ] Run through core flows: sign up, create chapter, invite member

### Phase 2: Production

- [ ] Create Supabase production project, apply migrations
- [ ] Create Render production service (`main` branch), add env vars
- [ ] Add Production env vars to each Vercel project
- [ ] Assign production domains in Vercel
- [ ] Configure DNS records for production domains
- [ ] Set up Stripe live mode (after business verification)
- [ ] Merge `preview` → `main` via PR
- [ ] Verify all production sites deploy
- [ ] Set up Sentry for error tracking (API + web)
- [ ] Build production mobile app with EAS

### Phase 3: Ongoing

- [ ] Store Render deploy hook URLs as GitHub secrets
- [ ] Verify CI workflow runs on PRs
- [ ] Set up uptime monitoring (e.g., BetterUptime, Checkly)

---

## 9. Cost Estimate (Hobby/Starter Tier)

| Service | Staging | Production | Notes |
|---------|---------|------------|-------|
| **Vercel** | Free (Preview) | Free (Hobby, 1 member) | Upgrade to Pro ($20/mo) for team |
| **Render** | Free | $7/mo (Starter) | Free tier sleeps after inactivity |
| **Supabase** | Free | Free | 2 free projects; Pro is $25/mo |
| **Stripe** | Free (test mode) | 2.9% + $0.30 per txn | No monthly fee |
| **EAS** | Free (30 builds/mo) | Free | Priority builds are $99/mo |
| **Domain** | — | ~$12/yr | frapp.live |
| **Total** | ~$0/mo | ~$7–19/mo | Before Stripe transaction fees |

---

## 10. Troubleshooting

**Vercel build fails with "module not found"**
→ Ensure `transpilePackages` in `next.config.js` includes all `@repo/*` packages used by that app. The `vercel.json` `buildCommand` uses Turbo to build dependencies first.

**Render deploy fails**
→ Check that the Dockerfile path is `apps/api/Dockerfile` and the build context is the repo root (Render default).

**Supabase connection refused in deployed API**
→ Ensure `SUPABASE_URL` uses `https://` (not `http://`) and points to the cloud project, not `localhost`.

**Mobile can't reach API**
→ Expo Go requires the API to be network-accessible. Use the deployed staging URL, not `localhost`. For local dev, use your machine's LAN IP (e.g., `http://192.168.1.x:3001/v1`).

**Preview deploys on Vercel use wrong env vars**
→ Check that you scoped the env vars to the correct environment (Production vs Preview) in Vercel dashboard.
