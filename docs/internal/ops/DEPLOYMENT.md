# Frapp Deployment Guide

This guide walks through the complete deployment setup: Vercel for frontends, Render for the API, Supabase Cloud for the database, and EAS for mobile. It covers both **staging** and **production** environments.

## Current rollout status

- ✅ Landing and web are configured in Vercel with Preview and Production environments.
- ✅ CI pipeline uses domain-specific parallel jobs with required status checks.
- ✅ Branch protection enforced on `main` and `production`.
- ✅ API deployment is automated on Render: `frapp-api-staging` deploys from `main`,
  `frapp-api-prod` from `production`, and `.github/workflows/deploy-api.yml` additionally
  triggers gated deploys and applies staging migrations after green CI. ⚠️ Verified against the
  Render API 2026-08-27: both services also have **Render-side auto-deploy set to trigger on
  commit**, which deploys on push _without waiting for CI_ (the latest staging deploy started
  seconds after its commit). The workflow's green-CI gate governs only its own deploy hook;
  reconciling the two is a Render-dashboard-only setting — "After CI checks pass" is the mode
  that keeps the gate honest _without_ breaking `verify-render-api` (§ Deploy verification),
  which treats "no deploy created for this SHA" as a failure and so rules out turning
  auto-deploy fully off.
- ✅ Infisical is the central secrets store; deploy workflows inject secrets from it, and provider
  syncs are inventoried in [`../environment/SECRETS_MANAGEMENT.md`](../environment/SECRETS_MANAGEMENT.md).
- ✅ Staging database migrations apply automatically on every green `main` run (`migrate-staging`
  in `deploy-api.yml`, since #1265). Production migrations are gated —
  [`DB_PROMOTION_RUNBOOK.md`](DB_PROMOTION_RUNBOOK.md) has the current production state.
- 🚧 Mobile store distribution is planned; local and EAS workflows are documented.

Treat this guide as the target-state runbook plus current operational notes.
For live rollout tracking, see **GitHub Issues** — work status is not a doc
([`../DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md) rule 4,
[`../ci-cd/GITHUB_PM.md`](../ci-cd/GITHUB_PM.md)).

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

## 1. Prerequisites

Before you begin, you need accounts on:

| Service        | URL                  | Free Tier?             |
| -------------- | -------------------- | ---------------------- |
| **Vercel**     | https://vercel.com   | Yes (Hobby)            |
| **Render**     | https://render.com   | Yes (free web service) |
| **Supabase**   | https://supabase.com | Yes (2 free projects)  |
| **Stripe**     | https://stripe.com   | Yes (test mode)        |
| **Expo (EAS)** | https://expo.dev     | Yes (free builds)      |

You also need the `frapp.live` domain registered and DNS managed (Squarespace Domains or Vercel).

---

## 2. Git Branching Model

Two long-lived branches map to environments:

| Branch       | Environment    | Vercel                            | Render              | Supabase           |
| ------------ | -------------- | --------------------------------- | ------------------- | ------------------ |
| `main`       | **Staging**    | Preview deploys → staging domains | `frapp-api-staging` | Staging project    |
| `production` | **Production** | Production deploys → prod domains | `frapp-api-prod`    | Production project |
| `feature/*`  | **Ephemeral**  | No automatic Vercel deploys       | —                   | —                  |

**How it flows:**

```
feature/xyz ──PR──▶ main (staging) ──PR──▶ production (production)
```

1. Feature branches are typically created from `main`.
2. Feature PRs target `main`. Merging triggers staging deployments.
3. Test on staging domains (e.g. `app.staging.frapp.live`).
4. When ready for production, open a promotion PR from `main` → `production`.
5. Merging to `production` triggers production deployments.

> `develop` is not used. `main` is the active staging integration branch. See `CONTRIBUTING.md` for the full branch model, merge strategy, and required checks.

**Vercel environment mapping:**

| Vercel environment           | Git trigger           | Domain example                                 |
| ---------------------------- | --------------------- | ---------------------------------------------- |
| **Production**               | Push to `production`  | `app.frapp.live`, `frapp.live`                 |
| **Preview** (pre-production) | Push to `main`        | `app.staging.frapp.live`, `staging.frapp.live` |
| **Disabled**                 | Any other branch / PR | No auto deployment                             |

The `main` branch's staging domain is configured by assigning the domain to the Preview environment and filtering to the `main` branch in Vercel's domain settings. Each app's `vercel.json` also uses `git.deploymentEnabled` so only `main` and `production` auto-deploy (`"**": false` is used to match feature branch names that include `/`).

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

Follow the internal promotion and rollback runbooks when promoting schema changes:

- `docs/internal/ops/DB_PROMOTION_RUNBOOK.md`
- `docs/internal/ops/DB_ROLLBACK_PLAYBOOK.md`

### Collect Keys

From each project's dashboard → Settings → API, note:

| Key                         | Where it goes                                                  |
| --------------------------- | -------------------------------------------------------------- |
| **Project URL**             | `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`                    |
| **anon public key**         | `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`          |
| **service_role secret key** | `SUPABASE_SERVICE_ROLE_KEY` (API only, never expose to client) |

---

## 4. Vercel Setup

You import the **same GitHub repo twice** — once per Next.js app (`apps/web`, `apps/landing`). Each import becomes a separate Vercel project with its own domains and env vars.

### 4.1 Import the Repo (repeat for each app)

1. Go to https://vercel.com/new.
2. **Import** your `pdcarlson/Frapp` repo.
3. Configure:

| Setting            | Web Dashboard           | Landing         |
| ------------------ | ----------------------- | --------------- |
| **Project Name**   | `frapp-web`             | `frapp-landing` |
| **Framework**      | Next.js (auto-detected) | Next.js         |
| **Root Directory** | `apps/web`              | `apps/landing`  |

**Build and Output Settings:** Leave all toggles OFF. Vercel auto-detects the correct commands for Turborepo monorepos:

- **Install:** `npm install --prefix=../..` (installs from monorepo root)
- **Build:** `turbo run build` (auto-scoped to the current workspace)
- **Output:** Next.js default (`.next`)

The `vercel.json` in each app adds `git.deploymentEnabled` (deploy only `main`/`production`, disable all others with `"**": false`), `turbo-ignore` (skip rebuilds when files haven't changed), and security headers.

### 4.2 Environment Variables per Project

Vercel scopes env vars to **Production** and **Preview**. The `main` branch triggers Preview deploys, which use Preview env vars. The `production` branch triggers Production deploys.

#### `frapp-web` (Web Dashboard)

| Variable                        | Production                       | Preview (Staging)                   |
| ------------------------------- | -------------------------------- | ----------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `https://<PROD_REF>.supabase.co` | `https://<STAGING_REF>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `<prod anon key>`                | `<staging anon key>`                |
| `NEXT_PUBLIC_API_URL`           | `https://api.frapp.live`         | `https://api-staging.frapp.live`    |

> ⚠️ **`NEXT_PUBLIC_API_URL` is the bare origin — no `/v1`.** The SDK's generated
> paths already include it, so a value ending in `/v1` yields `/v1/v1/...` and
> 404s every dashboard request. This table previously showed the `/v1` form, so
> **check the value currently set in Vercel for both environments** and drop the
> suffix if it is there. It is a build-time inlined variable: changing it
> requires a redeploy to take effect.

#### `frapp-landing` (Marketing Site)

| Variable              | Production               | Preview (Staging)                |
| --------------------- | ------------------------ | -------------------------------- |
| `NEXT_PUBLIC_APP_URL` | `https://app.frapp.live` | `https://app.staging.frapp.live` |

### 4.3 Domain Configuration

In each Vercel project → Settings → Domains:

#### Production Domains (connected to Production environment)

| Project         | Domain                          |
| --------------- | ------------------------------- |
| `frapp-web`     | `app.frapp.live`                |
| `frapp-landing` | `frapp.live` + `www.frapp.live` |

#### Staging Domains (connected to Preview environment, filtered to `main` branch)

| Project         | Domain                   | Environment | Branch filter |
| --------------- | ------------------------ | ----------- | ------------- |
| `frapp-web`     | `app.staging.frapp.live` | Preview     | `main`        |
| `frapp-landing` | `staging.frapp.live`     | Preview     | `main`        |

**To set this up:** In each project, go to Settings → Domains → Add the staging domain → Connect to environment: **Preview** → set the branch filter to `main`.

**Operational note:** The dashboard branch link is correct, but Vercel does not always attach the custom hostname to every Preview deployment on `main` (GitHub and the deployment list may still show the unique `*.vercel.app` URL while `app.staging.frapp.live` lags on an older build). The repo mitigates this: after each push to `main`, `.github/workflows/verify-deployments.yml` runs `scripts/ci/ensure-vercel-staging-alias.mjs`, which calls `POST /v2/deployments/{id}/aliases` so `app.staging.frapp.live` and `staging.frapp.live` alias the deployment for the pushed commit once it is `READY`. When turbo-ignore cancels a build (`CANCELED`) or there is no deployment row for the SHA, the alias step exits successfully without assigning (aligned with `verify-vercel-deploy.mjs` neutral skips). Manual recovery: `vercel alias set <deployment-url> app.staging.frapp.live` (same idea as the API).

### 4.4 DNS Records (Squarespace Domains)

In Squarespace Domains → `frapp.live` → DNS Settings → Custom Records:

```
# Production
frapp.live          A      76.76.21.21
www.frapp.live      CNAME  cname.vercel-dns.com
app.frapp.live      CNAME  cname.vercel-dns.com

# Staging
staging.frapp.live       CNAME  cname.vercel-dns.com
app.staging.frapp.live   CNAME  cname.vercel-dns.com

# API (Render — fill in after creating Render services)
api.frapp.live           CNAME  <frapp-api-prod>.onrender.com
api-staging.frapp.live   CNAME  <frapp-api-staging>.onrender.com
```

### Retired: `frapp-docs` and docs.frapp.live

The monorepo **no longer contains** `apps/docs`. Developer documentation is markdown under `docs/guides/` in GitHub.

**Operator checklist (outside git):**

1. **Vercel** — Pause or delete the `frapp-docs` project (builds would fail: missing `apps/docs`).
2. **DNS** — Remove or repoint `docs.frapp.live` and `docs.staging.frapp.live` if they still CNAME to Vercel.
3. **Infisical** — Remove any integration row that synced only to `frapp-docs`, if still present.

A future public documentation site is possible post-launch; treat as a separate initiative.

### 4.5 Vercel Project Settings

For each project, verify:

- **Settings → Git → Production Branch**: `production`

> **Operational note (2026-03-19):** The public Vercel REST API exposes `link.productionBranch` as a readable field but does not currently provide a documented/working write field to update it via `PATCH /v9|v10/projects/{idOrName}`.  
> In practice, changing the production branch must be done in the Vercel dashboard UI.

### 4.6 Vercel Branch Wiring Verification

After setting Production Branch to `production` for each project, validate:

1. Push to `production` branch → deployment target should be `production`.
2. Push to `main` branch → deployment target should be `preview`.
3. Feature branches should stay disabled by `vercel.json` (`"**": false`).

Quick API read check (requires valid `VERCEL_API_KEY`):

```bash
curl -s -H "Authorization: Bearer $VERCEL_API_KEY" \
  "https://api.vercel.com/v10/projects/<project-id>" \
  | jq '{name, productionBranch: .link.productionBranch, targets: .targets}'
```

---

## 5. Render Setup (API)

Create **two** Render Web Services: one for production, one for staging.

### 5.1 Create Services

1. Go to https://dashboard.render.com → **New** → **Web Service**.
2. Connect your GitHub repo.

| Setting             | Production                                | Staging               |
| ------------------- | ----------------------------------------- | --------------------- |
| **Name**            | `frapp-api-prod`                          | `frapp-api-staging`   |
| **Branch**          | `production`                              | `main`                |
| **Root Directory**  | (leave empty — Dockerfile uses repo root) | (same)                |
| **Runtime**         | Docker                                    | Docker                |
| **Dockerfile Path** | `apps/api/Dockerfile`                     | `apps/api/Dockerfile` |
| **Instance Type**   | Starter ($7/mo) or Free                   | Free                  |

### 5.2 Environment Variables

| Variable                    | Production                       | Staging                             |
| --------------------------- | -------------------------------- | ----------------------------------- |
| `SUPABASE_URL`              | `https://<PROD_REF>.supabase.co` | `https://<STAGING_REF>.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | `<prod service role key>`        | `<staging service role key>`        |
| `SUPABASE_ANON_KEY`         | `<prod anon key>`                | `<staging anon key>`                |
| `STRIPE_SECRET_KEY`         | `sk_live_...`                    | `sk_test_...`                       |
| `STRIPE_WEBHOOK_SECRET`     | `whsec_...` (prod)               | `whsec_...` (test)                  |
| `STRIPE_PRICE_ID`           | `price_...` (prod)               | `price_...` (test)                  |
| `SENTRY_DSN`                | `<prod sentry dsn>`              | `<staging sentry dsn>`              |
| `PORT`                      | `3001`                           | `3001`                              |
| `NODE_ENV`                  | `production`                     | `staging`                           |

### 5.3 Custom Domains

- Production: `api.frapp.live` → point to `frapp-api-prod.onrender.com`
- Staging: `api-staging.frapp.live` → point to `frapp-api-staging.onrender.com`

### 5.4 Health Check

The API exposes `GET /health`, which answers `200` in both states — `status: ok` when the database
round-trip succeeds, `status: degraded` when it does not
([`health.controller.ts`](../../../apps/api/src/interface/controllers/health.controller.ts)). It
never throws, so a `200` proves the process booted and Nest is serving, not that the database is
reachable.

> **This section previously claimed Render auto-detects the health check from the Dockerfile
> `HEALTHCHECK` directive. That claim is unverified and the configuration contradicts it.** Render
> exposes a per-service `healthCheckPath` setting, and on 2026-08-21 the live `frapp-api-staging`
> service reported `healthCheckPath: ""` — empty — while [`render.yaml`](../../../render.yaml)
> declares `healthCheckPath: /health` for both API services. So the blueprint is **not** applied to
> that service, whatever Render does with the Dockerfile directive.
>
> What Render actually does with `HEALTHCHECK`, and whether an empty `healthCheckPath` disables
> health-gated deploys, is **not established here** — `render.com` is unreachable from agent
> sessions (egress-blocked), so it was not checked against Render's documentation. Confirm before
> relying on either behaviour. Reconciling the drift is tracked on #1160.

### 5.5 In-process chat workers (Chunk 05)

Two background workers run inside the API Render service via NestJS `OnApplicationBootstrap` hooks — `ChatBridgeWorkerModule` (audit-log → `#chapter-audit` mirroring) and `ChatPushWorkerModule` (chat push fanout). Both open Supabase Realtime subscriptions with the service-role key on boot.

This is the deliberate default for now per **`spec/architecture/README.md` ADR-09** (Push worker host = in-process API). The workers should be split into a standalone Render service when **either** condition is sustained:

- `p99 fanout latency > 1s` (measured per recipient, from `chat_messages` INSERT to `notifyUser` returning), **or**
- `worker-loop CPU > 40%` of the API instance over a 10-minute window.

When the split happens, deploy `ChatPushWorkerModule` (and `ChatBridgeWorkerModule` if needed) as a separate Render Background Worker reading from the same secrets; no code changes are required beyond a new entry point that boots just those modules.

### 5.6 In-process scheduled jobs

`ScheduledJobsModule` runs four `@Cron` sweeps inside the API Render service: attendance auto-absent (hourly), invoice and task due/overdue reminders (daily at 09:00), and generated-report retention (hourly). They are registered against the `ScheduleModule.forRoot()` in `app.module.ts`.

**These differ from the §5.5 chat workers in one way that matters for scaling.** The chat workers each hold a single Supabase Realtime subscription, so extra replicas mostly duplicate a stream. A `@Cron` handler instead fires on **every replica, on every tick**. Multi-instance safety therefore comes from the database, not the topology: each unit of work claims a row in `scheduled_notification_dispatches`, unique on `(entity_type, entity_id, threshold, due_date)`, and only the replica that wins the insert acts. Reminders cannot be double-sent, and auto-absent runs once per event rather than once per replica per hour.

**The report-retention sweep is the exception, and deliberately takes no claim.** The claim exists to stop a _duplicate side effect_ — the same reminder sent twice. Deleting a storage object is idempotent: both replicas list before either deletes, so the loser issues `remove()` against keys that are already gone, and Supabase reports success for those (verified against the local stack: `remove()` on a missing key returns no error and an empty result array). It needs no dispatch row, and adding one would only make the sweep skip work after a crash. It also reads its work list from storage rather than the `chapters` table — it lists the chapter folders under the `reports` bucket — so its cost scales with chapters that have _exported_, not with chapters that exist, and a prefix whose chapter row was deleted still gets reaped.

Consequences worth knowing before scaling the API service:

- Adding replicas does **not** multiply notifications, and needs no configuration change.
- The sweeps are self-healing across missed ticks — auto-absent looks back 24 hours, overdue reminders 7 days, and due-soon reminders accept the due date itself as a late catch-up — so a deploy that skips 09:00 delays reminders rather than dropping them. Report retention re-derives what is expired from each object's stored-at timestamp on every tick, so missed ticks delay a delete rather than skipping it. A _persistent_ read failure is a different matter and is deliberately audible: the sweep logs a warning naming how many chapter prefixes it skipped, another if any object carries no stored-at timestamp (which it keeps rather than guessing), and an info line when it finds no chapter prefixes at all — the storage layer reports a missing bucket as an empty folder, so an unprovisioned or renamed `reports` bucket would otherwise be the one persistent failure that logged nothing. A sweep that silently reaps nothing forever would otherwise be indistinguishable from a healthy one.
- The claim is taken _before_ sending. If every delivery for a claim fails it is released and retried next tick; if only some recipients fail the claim is kept and the shortfall is logged, so a partial failure is visible but never re-spams the recipients who did get it. Both the claim insert and the compensating delete bind `chapter_id` from the sweep row, so a failed send in one chapter cannot drop another chapter's claim.
- Timing is UTC. No `TZ` is set on the API service, so `EVERY_DAY_AT_9AM` means 09:00 UTC and the sweeps' date arithmetic is UTC-based. Setting `TZ` on the service would shift both together; do it deliberately, not incidentally.

Splitting these into a standalone Render Background Worker is not currently warranted — the sweeps are short and run at most hourly — but if they are split, they must not run in _both_ places at once unless the dispatch claim is preserved, since that is the only thing preventing duplicate work.

### 5.7 Deploy Hooks (for GitHub Actions)

In each Render service → Settings → Deploy Hook → copy the URL. Store secrets as GitHub **environment-scoped** secrets (same names in both environments, different values):

- `RENDER_DEPLOY_HOOK_URL` → deploy hook URL for that environment
- `API_HEALTHCHECK_URL` → smoke-check URL for that environment (e.g. `https://api-staging.frapp.live/health` or `https://api.frapp.live/health`)

---

## 6. Mobile (EAS) Setup

### 6.1 Initial Setup

```bash
cd apps/mobile

# Login to Expo
npx eas login

# Initialize EAS project (creates project on expo.dev)
npx eas init
```

`eas init` writes `extra.eas.projectId` and `owner` into `app.json` itself. Those
keys are deliberately absent from the committed `app.json`: a placeholder `owner`
makes `expo start` try to resolve an Expo account that does not exist, and it
aborts the dev server with `CommandError: Interactive prompt was cancelled`.
Leave them out until a real EAS project exists, and do not commit them back as
placeholders.

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
3. Create a webhook endpoint pointing at `https://api-staging.frapp.live/v1/webhooks/stripe`.
4. Copy the webhook signing secret → `STRIPE_WEBHOOK_SECRET`.
5. Create a Product + Price → copy price ID → `STRIPE_PRICE_ID`.

### 7.2 Live Mode (Production)

Same steps but toggle to Live mode in Stripe dashboard. Requires business verification.

---

## 7A. Discord Application Setup (the archive importer's bot path)

**Optional.** Skip it entirely and the DiscordChatExporter upload flow still
works — the wizard simply does not offer "Connect Discord". What it is not is a
fallback that switches on: the two paths are independent, and the upload one is
what keeps working if Discord ever throttles one shared bot across every chapter.

Everything below is **provider-side configuration that no repo state creates and
no CI check can detect.** Three of the five steps produce an Infisical value; two
produce nothing but a toggle, and getting either wrong fails at runtime with an
error that names neither this page nor the setting.

1. **Create the application.** https://discord.com/developers/applications → New
   Application, owned by **Signet**, not by a chapter. A separate application per
   environment is recommended so a staging mistake cannot read production
   chapters' servers.
2. **Bot token.** Bot → Reset Token → copy (shown once) → Infisical
   `DISCORD_BOT_TOKEN`. **One global value per environment, not one per chapter.**
3. **OAuth2 credentials.** OAuth2 → copy Client ID → `DISCORD_CLIENT_ID`; Reset
   Secret → copy → `DISCORD_CLIENT_SECRET`. The secret is what signs the
   server-to-server code exchange, which is the step that proves the authorizing
   human holds Manage Server on the guild — without it that fact would have to be
   taken from the browser, which the flow must never do.
4. **Register the redirect URI** — OAuth2 → Redirects → Add, **exactly**:

   | Environment | Redirect URI                                                 |
   | ----------- | ------------------------------------------------------------ |
   | local       | `http://localhost:3001/v1/discord/connect/callback`          |
   | staging     | `https://api-staging.frapp.live/v1/discord/connect/callback` |
   | production  | `https://api.frapp.live/v1/discord/connect/callback`         |

   It is `API_URL` + `/v1/discord/connect/callback` and Discord matches it
   **character for character**. Get it wrong and every admin who clicks "Add to
   Server" gets Discord's own `invalid_redirect_uri` page with **nothing in the
   API logs** — Discord rejects the request before the callback is ever reached.
   The path is pinned in code as `DISCORD_CALLBACK_PATH`
   (`apps/api/src/application/services/discord-oauth.service.ts`); this table is
   the third copy, and the one that drifts.

5. **Enable Message Content Intent** — Bot → Privileged Gateway Intents →
   Message Content Intent → on. This is **self-serve below 100 servers** and is
   separate from bot verification, which is not needed yet (revisit before that
   threshold). Without it Discord answers `200` with `content: ""` on every
   message a chapter's members wrote. The importer detects that and fails with a
   message naming this toggle rather than importing a decade of empty bubbles —
   but only turning it on makes an import actually work.

**Permissions.** The install requests View Channels + Read Message History and
nothing else (bitfield `66560`, pinned as `DISCORD_BOT_PERMISSIONS` in
`apps/api/src/domain/adapters/discord.interface.ts`). Do not widen it in the
portal: the bitfield in the authorize URL is what the consent screen shows a
chapter, and a read-only archiver has no business holding a permission that can
change anything in someone's server.

**One thing the portal cannot express, so it is worth knowing here.** Discord's
consent screen names _Signet_ — it does not name the chapter the connection will
be bound to, and it cannot. Signet closes that gap on its own side: the callback
parks the server and links nothing, and an authenticated request scoped to the
chapter is what activates it. So a Signet officer cannot send their authorize
link to somebody else's Discord admin and end up reading that server. Do not
"simplify" the flow by binding on the callback.

**Verify after setup**: `GET /v1/discord/availability` (as an officer with
`channels:manage`) must answer `{"available": true}`. If it answers `false`, one
of the three secrets or `API_URL` / `APP_URL` is unset in that environment — see
[`ENV_REFERENCE.md`](../environment/ENV_REFERENCE.md) § API-Only Settings.

---

## 8. Step-by-Step Launch Checklist

### Phase 1: Staging (do this first)

- [ ] Create Supabase staging project, apply migrations
- [ ] Create Render staging service (`main` branch), add env vars
- [ ] Import repo to Vercel 3 times (web, landing, docs)
- [ ] Add Preview env vars to each Vercel project
- [ ] Assign staging domains to `main` branch in Vercel
- [ ] Configure DNS records for staging subdomains
- [ ] Set up Stripe test mode webhook for staging API URL
- [ ] Push to `main` → verify all staging sites deploy
- [ ] Test mobile with Expo Go pointing at staging API
- [ ] Run through core flows: sign up, create chapter, invite member

### Phase 2: Production

- [ ] Create Supabase production project, apply migrations
- [ ] Create Render production service (`production` branch), add env vars
- [ ] Add Production env vars to each Vercel project
- [ ] Assign production domains in Vercel
- [ ] Configure DNS records for production domains
- [ ] Set up Stripe live mode (after business verification)
- [ ] Merge `main` → `production` via PR
- [ ] Verify all production sites deploy
- [ ] Set up Sentry for error tracking (API + web)
- [ ] Build production mobile app with EAS

### Phase 3: Ongoing

- [ ] Store Render deploy hook URLs as GitHub secrets
- [ ] Verify CI workflow runs on PRs
- [ ] Set up uptime monitoring (e.g., BetterUptime, Checkly)

---

## 9. Cost Estimate (Hobby/Starter Tier)

| Service      | Staging             | Production             | Notes                             |
| ------------ | ------------------- | ---------------------- | --------------------------------- |
| **Vercel**   | Free (Preview)      | Free (Hobby, 1 member) | Upgrade to Pro ($20/mo) for team  |
| **Render**   | Free                | $7/mo (Starter)        | Free tier sleeps after inactivity |
| **Supabase** | Free                | Free                   | 2 free projects; Pro is $25/mo    |
| **Stripe**   | Free (test mode)    | 2.9% + $0.30 per txn   | No monthly fee                    |
| **EAS**      | Free (30 builds/mo) | Free                   | Priority builds are $99/mo        |
| **Domain**   | —                   | ~$12/yr                | frapp.live                        |
| **Total**    | ~$0/mo              | ~$7–19/mo              | Before Stripe transaction fees    |

---

## 10. CI/CD Pipeline

### How Deployments Are Gated

All deployments are gated behind CI success. The flow is:

1. **PR created** → CI runs domain-specific jobs in parallel. Vercel deployments do not run for feature/PR branches.
2. **All checks pass** → PR is mergeable (branch protection enforced).
3. **PR merged** → Push event triggers deploy pipeline (`workflow_run` waits for CI).
4. **Deploy pipeline**: DB migration (dry-run → apply) → API deploy (Render) → Frontends auto-deploy (Vercel).

Production deploys run automatically after the `main` → `production` promotion PR merges and CI passes — there is no separate GitHub Actions environment-approval pause. The control point for production is the promotion PR itself (branch protection: CI + an approving review + conversation resolution). This used to be explained as required-reviewer environment rules being Enterprise-only _on private repositories_; **that reason is wrong — this repo is public** (corrected 2026-08-21, see `docs/internal/ci-cd/AGENT_INFRA.md` § GitHub environments and bootstrap secrets). The gate is unchanged; whether to add environment reviewers on top is an open question, not a correction.

### Required Status Checks

See `CONTRIBUTING.md` for the full list of CI jobs required for merge.

### API build parity (Render / Docker)

Render builds the API with `nest build` inside `apps/api/Dockerfile` (see the builder stage). That uses `tsconfig.build.json`, which can surface TypeScript errors that never ran in CI if the API workspace had no `check-types` task aligned with that config.

CI now runs **`npm run build -w apps/api`** in `lint-and-typecheck` (same `nest build` as production) and **`docker build -f apps/api/Dockerfile .`** in a separate `api-docker-build` job so the image layer that compiles the API is exercised on every push and PR. **`api-docker-build`** is a required status check for merge (listed in `CONTRIBUTING.md` and applied by [`scripts/configure-branch-protection.mjs`](../../../scripts/configure-branch-protection.mjs); re-run `npm run configure:branch-protection` after changing CI job names).

**A green build is not a startable image.** `api-docker-build` compiles the image; it long said
nothing about whether the container can start. #1160 is what that gap costs: the runner stage
copied `/app/node_modules/` and `/app/apps/api/node_modules/` but none of the `packages/*/node_modules/`
trees, so the image was correct only while npm hoisted every workspace dependency to the root. When
`colorjs.io` moved to `packages/chapter-theme/node_modules/` (2026-08-17) and then `zod` to
`packages/validation/node_modules/` (2026-08-20), each vanished from the image. **`verify-render-api`
then failed on 67 consecutive pushes to `main` while this job stayed green on every one of them**,
with Render reporting `update_failed` — a post-build state, which is why the build logs looked clean.
The 67 failures are counted from the Actions API; the `MODULE_NOT_FOUND` cause was read from Render's
runtime logs on two sampled dates in that window (`colorjs.io` on 08-18, `zod` on 08-21) rather than
on all 67.

Two consequences worth carrying:

- **The Dockerfile now copies each workspace package's `node_modules/`**, and `prod-deps` `mkdir -p`s
  every tree the runner copies. The guard has to run in both directions: a dependency that hoists to
  the root leaves `packages/<name>/node_modules` absent, and one forced down by a version conflict
  leaves it present — either way an unguarded `COPY` fails or silently ships an incomplete image.
- **`api-docker-build` now boots the image and probes `/health`** before passing. The build step sets
  `load: true` so there is an image to run, and the probe supplies obviously-fake values for the six
  variables [`env.validation.ts`](../../../apps/api/src/config/env.validation.ts) requires at boot —
  no secret is needed, because `/health` answers `200` without a working database (§5.4).

**Optional hardening (not implemented here):** poll the Render [Deploys API](https://render.com/docs/deploys) after CI for the commit SHA and fail if the deploy never leaves `build_in_progress` / reaches `build_failed` — closest to “exactly what Render does,” but slower and flakier than building the same Dockerfile in Actions.

### Deploy verification (observer workflow)

After a push to `main` or `production`, `.github/workflows/verify-deployments.yml` polls Render and Vercel to confirm the deploy for that SHA reached a healthy terminal state:

- **Render** (`verify-render-api`): fails on `build_failed` / `update_failed` / `pre_deploy_failed` or on "no deploy created for this SHA within 5 minutes" (autoDeploy-wiring red flag). Treats `canceled` / `deactivated` as neutral (superseded).
- **Vercel web** (`verify-vercel-web`) and **Vercel landing** (`verify-vercel-landing`): fail on `ERROR`. Treat `CANCELED` as neutral (turbo-ignore skip). Treat "no deployment for this SHA within 3 minutes" as neutral, because turbo-ignore legitimately skips builds when nothing in the app tree changed.

The workflow is currently advisory (not a required check). When a failure shows up in the Actions UI, the failure message will name the commit SHA and last observed state; open the linked Render / Vercel dashboard to read full deploy logs. Recipe for marking it required on `production` later: [`docs/internal/ops/GITHUB_BRANCH_PROTECTION_RUNBOOK.md`](GITHUB_BRANCH_PROTECTION_RUNBOOK.md#future-require-deploy-verification-on-production).

Script implementations and unit tests live under [`scripts/ci/`](../../../scripts/ci/).

### Secrets in CI vs CD

**CI (lint, typecheck, tests)** does **not** use any runtime secrets. No Supabase, Stripe, or Vercel credentials are needed.

**CD (deploy workflows)** uses Infisical-injected runtime secrets in `deploy-api.yml`. Variable names are **unified** — no `_STAGING` / `_PRODUCTION` suffixes. The workflow resolves secrets at runtime from Infisical using the environment slug that matches the target branch (`staging` for `main`, `prod` for `production`):

| Variable                 | Purpose                                                  |
| ------------------------ | -------------------------------------------------------- |
| `RENDER_DEPLOY_HOOK_URL` | Trigger API deploy (value differs per environment)       |
| `API_HEALTHCHECK_URL`    | Post-deploy health check (value differs per environment) |
| `SUPABASE_ACCESS_TOKEN`  | Supabase CLI auth for migrations                         |
| `SUPABASE_PROJECT_REF`   | Target DB for migrations (value differs per environment) |

3 permanent GitHub repository secrets bootstrap the Infisical connection: `INFISICAL_MACHINE_IDENTITY_ID`, `INFISICAL_CLIENT_SECRET`, and `INFISICAL_PROJECT_ID`. No GitHub environment-scoped deploy secrets are required once the workflow is using `Infisical/secrets-action`.

See `docs/internal/environment/ENV_REFERENCE.md` for the complete variable mapping.

---

## 11. Secrets Management (Infisical)

All secrets are centrally managed in [Infisical](https://infisical.com) (free tier) with automatic syncs to deployment providers.

### Key Design

- **Canonical values stored once** per environment — no duplication.
- **Secret references** handle framework prefixes (`NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}`).
- **No environment suffixes** — `RENDER_DEPLOY_HOOK_URL` has different values per Infisical environment.
- **No `.env.local` files needed** — local dev defaults to `npm run dev:stack` (Infisical CLI injects `dev` secrets). See [`docs/internal/environment/LOCAL_DEV.md`](../environment/LOCAL_DEV.md).

### Sync Map (7 of 10 free-tier integrations; docs Vercel project retired)

| #   | Infisical env | Destination                               |
| --- | ------------- | ----------------------------------------- |
| 1   | staging       | Vercel → frapp-web (Preview scope)        |
| 2   | production    | Vercel → frapp-web (Production scope)     |
| 3   | staging       | Vercel → frapp-landing (Preview scope)    |
| 4   | production    | Vercel → frapp-landing (Production scope) |
| 5   | staging       | Render → frapp-api-staging                |
| 6   | production    | Render → frapp-api-prod                   |
| 7   | per-env       | GitHub Actions (OIDC)                     |

See `docs/internal/environment/SECRETS_MANAGEMENT.md` for the full setup guide and `docs/internal/environment/ENV_REFERENCE.md` for the complete variable list.

---

## 12. Troubleshooting

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
