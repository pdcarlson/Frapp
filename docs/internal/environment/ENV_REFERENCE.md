# Environment Variable Reference

> **This is the single source of truth for every environment variable in the Frapp project.**
>
> All values are managed in [Infisical](https://infisical.com). Canonical values are stored once per environment. Framework-specific names (e.g., `NEXT_PUBLIC_*`) are Infisical **secret references** that auto-resolve to the canonical value.

---

## How It Works

```text
Infisical stores each value ONCE per environment:
  SUPABASE_URL = https://xyz.supabase.co     (canonical)

Framework-specific names are REFERENCES that resolve automatically:
  NEXT_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}  (resolves to same value)
  EXPO_PUBLIC_SUPABASE_URL = ${SUPABASE_URL}  (resolves to same value)

Change SUPABASE_URL → both references update instantly.
```

---

## Infisical Environments

| UI name     | **Slug**      | When it's used                                                       | Maps to                                                                                  |
| ----------- | ------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Development | **`dev`**     | Running the app on your machine against local Docker Supabase        | `npm run dev:stack` (API + web + landing); per-app: see [`LOCAL_DEV.md`](./LOCAL_DEV.md) |
| Staging     | **`staging`** | Deployed to Render staging when code merges to `main` branch. The **Vercel half ended 2026-09-02** — `frapp-landing` unlinked from Git 2026-09-01, `frapp-web` 2026-09-02, so no merge deploys web or landing (ADR-21 in [`spec/architecture/README.md`](../../../spec/architecture/README.md)) | Vercel Preview, Render staging, Supabase staging project                                 |
| Production  | **`prod`**    | Deployed to production infra when a commit is dispatched through `deploy-production.yml` | Vercel Production, Render production, Supabase production project                        |

> **Always use the slug, never the UI name.** Two of the three differ: the environment shown as
> “Development” is `dev`, and the one shown as “Production” is `prod`. Every
> `infisical run --env=`, every workflow `env-slug:`, and `.infisical.json` takes the slug.
>
> This table used to claim `local` and `production`. Neither slug exists, so all five
> `npm run dev:*` scripts failed to resolve an environment — a bug that survived because the
> deploy workflows hardcode `staging`/`prod` correctly and the cloud sandbox writes
> `apps/*/.env.local` directly, so nothing in CI exercised the broken path.
> `npm run check:env-slugs` now enforces this column.

**`dev` uses local Supabase (Docker) but real staging Stripe/Sentry keys.** This lets you test billing flows, webhook handling, and error tracking during local development without pushing to main. Supabase stays local because the database schema and seed data are managed by your local Docker instance.

---

## Canonical Variables — The Complete Grid

These are the real values you enter into Infisical. **Every cell tells you exactly what to type.**

### Core App Secrets

| Variable                    | `dev`                                                                                                                                                                                                                  | `staging`                                                                                                                                                                                                                      | `prod`                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SUPABASE_URL`              | `http://127.0.0.1:54321`                                                                                                                                                                                               | `https://YOUR_STAGING_REF.supabase.co` ← copy from Supabase staging dashboard → Settings → API → Project URL                                                                                                                   | `https://YOUR_PROD_REF.supabase.co` ← copy from Supabase production dashboard → Settings → API → Project URL                                                 |
| `SUPABASE_SERVICE_ROLE_KEY` | Output of `npx supabase status -o env` for your local stack (`SUPABASE_SERVICE_ROLE_KEY`)                                                                                                                              | Copy from Supabase staging dashboard → Settings → API → `service_role` key (⚠️ secret!)                                                                                                                                        | Copy from Supabase production dashboard → Settings → API → `service_role` key (⚠️ secret!)                                                                   |
| `SUPABASE_ANON_KEY`         | Output of `npx supabase status -o env` for your local stack (`SUPABASE_ANON_KEY`)                                                                                                                                      | Copy from Supabase staging dashboard → Settings → API → `anon` `public` key                                                                                                                                                    | Copy from Supabase production dashboard → Settings → API → `anon` `public` key                                                                               |
| `STRIPE_SECRET_KEY`         | **Same as staging** — use your real Stripe test-mode key (`sk_test_...`) so you can test billing flows locally. Copy from Stripe dashboard → Developers → API keys → Secret key (test mode).                           | ← same `sk_test_...` key as local                                                                                                                                                                                              | Copy from Stripe dashboard → Developers → API keys → Secret key (live mode: `sk_live_...`)                                                                   |
| `STRIPE_WEBHOOK_SECRET`     | **Same as staging.** The staging endpoint cannot deliver to your laptop, so to exercise webhooks locally run `stripe listen --forward-to localhost:3001/v1/webhooks/stripe` and use the `whsec_...` it prints instead. | Signing secret of endpoint `we_1U93QB3Dzz3XLCb6mYeeNzUF` (Signet **test** mode → `https://api-staging.frapp.live/v1/webhooks/stripe`). Read it from Stripe dashboard → Developers → Webhooks → that endpoint → Signing secret. | **Not yet created.** Signet live mode holds no webhook endpoint. Create one on `https://api.frapp.live/v1/webhooks/stripe` and copy its signing secret here. |
| `STRIPE_PRICE_ID`           | **Same as staging** — `price_1U93Pm3Dzz3XLCb6okJnzjat` (Signet **test** mode, "Chapter Pro — $149/chapter/month", `lookup_key` `signet_chapter_pro_monthly_usd`, on product `prod_V9M7moDbzFs0UP`).                    | ← same `price_...` as local                                                                                                                                                                                                    | **Not yet created.** Signet live mode holds no Product or Price. Create the live twin of the row to the left, then copy its `price_...` here.                |
| `STRIPE_PUBLISHABLE_KEY`    | **Same as staging** — the test-mode publishable key (`pk_test_...`). Copy from Stripe dashboard → Developers → API keys → Publishable key (test mode).                                                                 | ← same `pk_test_...` key as local                                                                                                                                                                                              | Copy from Stripe dashboard → Developers → API keys → Publishable key (live mode: `pk_live_...`)                                                              |
| `API_URL`                   | `http://localhost:3001`                                                                                                                                                                                                | `https://api-staging.frapp.live`                                                                                                                                                                                               | `https://api.frapp.live`                                                                                                                                     |
| `APP_URL`                   | `http://localhost:3000`                                                                                                                                                                                                | `https://app.staging.frapp.live`                                                                                                                                                                                               | `https://app.frapp.live`                                                                                                                                     |

> ⚠️ **`API_URL` is the bare origin — no `/v1`, no trailing slash.** The generated
> OpenAPI contract carries the version in the path (`/v1/users/me`, and so on;
> only `/health` sits outside it) and declares no `servers` entry, so the SDK
> concatenates `API_URL` + path. Setting `http://localhost:3001/v1` produces
> `/v1/v1/users/me` and **404s every request**. `createFrappClient` strips a
> trailing `/v1` defensively so a stale deployed value degrades to a no-op, but
> do not rely on that — set the bare origin.

> **The Stripe account is the "Signet" org (`acct_1U930c3Dzz3XLCb6`), and it started empty.** Every Stripe object referenced above was created from scratch on 2026-08-27; nothing carried over from the previous org. **A `price_...` from the old org is a non-empty string, so it passes `validateEnv` and the API boots — then checkout fails at runtime because the Price does not exist in this account.** Any environment whose `STRIPE_SECRET_KEY` now points at Signet must have its `STRIPE_PRICE_ID` replaced with the value above; a booting API is not evidence that it was.
>
> **Register only the five events the API handles** — `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `payment_intent.succeeded`. The allowlist in [`apps/api/src/application/services/billing.service.ts`](../../../apps/api/src/application/services/billing.service.ts) drops everything else before it reaches the database, so registering more only adds noise. The path is `/v1/webhooks/stripe` — the `v1` comes from global URI versioning in `main.ts`, not from the controller.

### API-Only Settings

| Variable                      | `dev`                                                                                                                                          | `staging`                                                                                        | `prod`                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PORT`                        | `3001`                                                                                                                                         | `3001`                                                                                           | `3001`                                                                                                                                                  |
| `NODE_ENV`                    | `development`                                                                                                                                  | `staging`                                                                                        | `production`                                                                                                                                            |
| `SENTRY_DSN`                  | **Same as staging** — use the same DSN so errors during local development show up in Sentry. Copy from Sentry → Settings → Client Keys → DSN.  | ← same DSN as local                                                                              | Copy from Sentry → Settings → Client Keys → DSN (use a separate production project if you want isolation)                                               |
| `SENTRY_TRACES_SAMPLE_RATE`   | `0.1`                                                                                                                                          | `0.1`                                                                                            | `0.1`                                                                                                                                                   |
| `SUPABASE_JWT_SECRET`         | The `JWT secret` field from `npx supabase status -o env` for your local stack                                                                  | Copy from Supabase staging dashboard → Settings → API → JWT Settings → `JWT Secret` (⚠️ secret!) | Copy from Supabase production dashboard → Settings → API → JWT Settings → `JWT Secret` (⚠️ secret!)                                                     |
| `EVENT_CHECK_IN_TOKEN_SECRET` | Any high-entropy random string, e.g. `openssl rand -base64 48`. It only has to be stable within an environment — nothing else derives from it. | Generate a **distinct** value and store it in Infisical                                          | Generate a **distinct** value and store it in Infisical                                                                                                 |
| `DISCORD_BOT_TOKEN`           | **Same as staging** — the one Signet bot token. Discord Developer Portal → your application → Bot → Reset Token (⚠️ shown once).               | ← same token as local                                                                            | Copy from the Developer Portal. A **separate application** for production is recommended so a staging mistake cannot read production chapters' servers. |
| `DISCORD_CLIENT_ID`           | **Same as staging.** Developer Portal → your application → OAuth2 → Client ID. Not secret, but it lives here so the four stay together.        | ← same id as local                                                                               | The production application's Client ID                                                                                                                  |
| `DISCORD_CLIENT_SECRET`       | **Same as staging.** Developer Portal → OAuth2 → Client Secret → Reset Secret (⚠️ secret!).                                                    | ← same secret as local                                                                           | The production application's Client Secret                                                                                                              |

> `SUPABASE_JWT_SECRET` is **optional**. It lets the API verify access-token signatures locally so the rate limiter can key buckets per authenticated user (see `spec/architecture/README.md`, Security). When it is absent the limiter safely falls back to per-IP keying — set it in every environment to enable per-user limiting.

> `EVENT_CHECK_IN_TOKEN_SECRET` is **optional** and signs the rotating event check-in codes (`spec/behavior/events.md` § Check-In). Unset, `GET /v1/events/:eventId/attendance/check-in-token` returns 503 and the mobile host screen (s22) says the feature is not configured; a supplied token is rejected rather than accepted. The mint route is **GET**, not POST — minting writes nothing (the code is derived from the event id, the clock, and this secret), and GET keeps the host screen's polling on the read throttle bucket (`attendance.controller.ts`). Plain self check-in and the check-in geofence are unaffected, so local dev, tests, and CI run without it. **Use a different value per environment** — sharing one would make a staging code redeemable in production.

> The three `DISCORD_*` variables are **optional, and all-or-nothing**. They power the "Connect
> Discord" path of the archive importer (`spec/behavior/chat/README.md` § Imported archive
> messages). Unset, `GET /v1/discord/availability` answers `available: false`, the wizard offers
> only the DiscordChatExporter upload flow, and every other `/v1/discord/*` route answers 503. **The
> upload flow is a separate path, not a fallback that switches on** — it works identically whether or
> not these are set, which is the whole point of keeping it.
>
> `DiscordOAuthService.isAvailable()` requires **all four** of `DISCORD_BOT_TOKEN`,
> `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `API_URL`/`APP_URL` (below). Three of four is not
> a degraded mode: without the client secret there is no server-to-server code exchange, which is
> the step that proves the authorizing human holds Manage Server on the guild — so the flow would
> have to trust the browser for it, which it must never do. Without `API_URL` there is no redirect
> URI to register, and without `APP_URL` the callback has nowhere to send the browser back to.
>
> **`DISCORD_BOT_TOKEN` is ONE global Signet value per environment, not one per tenant.** There is
> no per-chapter credential anywhere in this feature and no secret store that would hold one — what
> a chapter contributes is a `guild_id` in `discord_connections`, which is a public snowflake and
> inert without an install behind it. Do not go looking for per-chapter Discord secrets; there are
> none by design.
>
> **Two things live outside Infisical and no CI check can detect either.** (1) The OAuth redirect URI
> must be registered by hand in the Developer Portal → OAuth2 → Redirects, exactly
> `${API_URL}/v1/discord/connect/callback` per environment — see
> [`DEPLOYMENT.md`](../ops/DEPLOYMENT.md) § Discord application setup. (2) **Message Content Intent**
> must be enabled under Bot → Privileged Gateway Intents. Without it Discord answers `200` with
> `content: ""` on every message, so an import would otherwise write a chapter's whole history as
> empty bubbles; the importer detects this and fails loudly rather than importing blanks, but only
> the toggle makes it actually work.

### Analytics (Pseudonymous — API-only)

Product analytics is pseudonymous by construction: the API keys every event by `hmac_sha256(salt, user_id)` and the raw user id never reaches the provider (`spec/behavior/data-retention.md` #analytics-events-pseudonymous). **The salt is API-only on purpose** — it must never be exposed to a client bundle (no `NEXT_PUBLIC_`/`EXPO_PUBLIC_` reference), or the dataset could be rainbow-tabled back to user ids. Clients fetch their pseudonymous id from `GET /v1/analytics/identity` and post events through `POST /v1/analytics/events`; the API does the keying.

| Variable              | `dev`                                                                                                                               | `staging`                                                                                                                             | `prod`                                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ANALYTICS_HMAC_SALT` | _(optional locally)_ a random 32+ char hex string — generate with `openssl rand -hex 32`. When empty, server analytics is disabled. | A **distinct** random per-environment salt (`openssl rand -hex 32`). Held only here, never in the analytics provider.                 | A **distinct** random per-environment salt (`openssl rand -hex 32`). Held only here, never in the analytics provider.                                                                                                          |
| `POSTHOG_API_KEY`     | _(leave empty → no-op provider, events logged at debug only)_                                                                       | PostHog project API key (`phc_...`) for the staging project — project `569878` ("Default project", org "Signet", US Cloud), per #1173 | **Not yet created.** Create a **separate** production project in PostHog org "Signet" (staging and production must not share a project — #1173, and #709 is a hard prerequisite), then copy its `phc_...` Project API Key here |
| `POSTHOG_HOST`        | _(leave empty → defaults to `https://us.i.posthog.com`)_                                                                            | Override only for EU/self-host                                                                                                        | Override only for EU/self-host                                                                                                                                                                                                 |

> All three are **optional**. With no `POSTHOG_API_KEY` the API uses a no-op provider (debug logging), and with no `ANALYTICS_HMAC_SALT` server analytics is disabled entirely — so local dev, tests, and CI run without any analytics secret.

> **Which provider was selected is visible in the boot log.** `selectAnalyticsProvider()` logs its choice under the `AnalyticsProvider` context every time: the PostHog host when a key is set, a plain `log` line when neither the key nor the salt is set (the intended local/CI state), and a **warning** when `ANALYTICS_HMAC_SALT` is set but `POSTHOG_API_KEY` is not — the case where events are pseudonymized and then silently discarded. The API is the only analytics transport (clients post to `POST /v1/analytics/events` and carry no provider SDK), so this log line is the only place the distinction is observable; it was silent until 2026-08-21.

> ⚠️ **`ANALYTICS_HMAC_SALT` is no longer analytics-only.** It is now the salt for every pseudonym the API produces: analytics keys, the `originHash` on security-event logs, and the user/chapter hashes on Sentry events (`spec/behavior/observability.md` § Error Tracking). Two consequences when it is unset in an environment that _does_ have a `SENTRY_DSN`:
>
> - Sentry events arrive with identifiers **removed rather than hashed** — they are safe, but unattributable, so you cannot tell which tenant hit an error. The API logs a `Bootstrap` warning at startup in exactly this case.
> - Security-event records omit `originHash`, so the auth-failure spike rule cannot group by origin.
>
> Set it wherever `SENTRY_DSN` is set. **Rotating it re-keys every pseudonym at once** — analytics continuity, Sentry grouping, and in-flight spike windows all break together. That is the intended blast radius of a salt rotation, but do it deliberately.

### Invite Email (Optional — API-only)

Powers the bulk-email invite path (`POST /v1/invites/email`, #238) — the onboarding wizard's "Or invite by email" field. The share-link invite path is unaffected either way.

| Variable            | `dev`                                                          | `staging`                                                                | `prod`                                                                   |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `RESEND_API_KEY`    | _(leave empty → no-op provider, invite emails logged at debug only)_ | Resend API key (`re_...`) for the Signet Resend account                    | Resend API key (`re_...`) — a **separate** key from staging is recommended |
| `RESEND_FROM_EMAIL` | _(leave empty → default `Frapp <invites@frapp.live>`)_          | Override only if sending from a different verified domain                 | Override only if sending from a different verified domain                   |

> Both are **optional**. With no `RESEND_API_KEY` the API uses a no-op provider that logs instead of sending — the invite tokens are still created either way, so local dev, tests, and CI never need a real email credential; only delivery is skipped. `selectEmailProvider()` logs its choice under the `EmailProvider` context at boot, same posture as `selectAnalyticsProvider()`.

> **The From address must be on a domain verified with Resend**, or sends will bounce at request time regardless of the key's validity. The default `invites@frapp.live` is a placeholder — verify the domain in the Resend dashboard before relying on it in a deployed environment.

> The join link an invite email carries is built from `APP_URL` (above), with the same production-origin fallback the mobile app uses when its own `EXPO_PUBLIC_APP_URL` twin is unset — see `apps/api/src/infrastructure/email/invite-link.util.ts`.

### CD Secrets (Deploy Workflows Only)

These are only used by GitHub Actions. Leave them empty in the `dev` environment — they're not needed for local development.

| Variable                 | `dev`           | `staging`                                                                                                                                                     | `prod`                                                                          |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `RENDER_DEPLOY_HOOK_URL` | _(leave empty)_ | Copy from Render dashboard → frapp-api-staging → Settings → Deploy Hook → copy URL                                                                            | Copy from Render dashboard → frapp-api-prod → Settings → Deploy Hook → copy URL |
| `API_HEALTHCHECK_URL`    | _(leave empty)_ | `https://api-staging.frapp.live/health`                                                                                                                       | `https://api.frapp.live/health`                                                 |
| `SUPABASE_PROJECT_REF`   | _(leave empty)_ | Copy from Supabase staging dashboard → Settings → General → Reference ID (looks like `abcdefghijklmnop`)                                                      | Copy from Supabase production dashboard → Settings → General → Reference ID     |
| `SUPABASE_ACCESS_TOKEN`  | _(leave empty)_ | Go to https://supabase.com/dashboard/account/tokens → Generate token → copy it. **Same token for both staging and production** — it's an account-level token. | _(same token as staging)_                                                       |
| `SUPABASE_DB_PASSWORD`   | _(leave empty)_ | The **frapp-staging** database password (Supabase dashboard → project → database settings; reset it there if unknown).                                        | The **frapp-prod** database password — a _different_ value from staging.        |

> **`SUPABASE_DB_PASSWORD` is required, not optional.** The Supabase CLI pinned in `deploy-api.yml` cannot initialise its `cli_login_postgres` login role — it issues that role's password with an already-expired validity window and fails with `permission denied to alter role`, which reads like a permissions problem but is a CLI bug ([supabase/cli#5091](https://github.com/supabase/cli/issues/5091), tracked here as #835). With `SUPABASE_DB_PASSWORD` set, `supabase link` / `db push` connect directly and skip login-role initialisation. Without it, **every** migration job fails. Unlike `SUPABASE_ACCESS_TOKEN`, this value is per-project — staging and production have different passwords.

### Offsite Backup Secrets (`db-backup.yml` only)

Read at job time by the nightly DB backup workflow, which dumps `frapp-staging`
into a private Cloudflare R2 bucket (#852 / #1287). Provisioned in `staging`
2026-08-27. The bucket name, account endpoint, and key values are deliberately
not written into this public repo — read them from Infisical or the Cloudflare
dashboard. They do not live *only* there, though: the path-`/` staging syncs
([`SECRETS_MANAGEMENT.md`](./SECRETS_MANAGEMENT.md) §5) push every Staging
secret onward, so copies also sit in the Render staging service env and both
Vercel projects' Preview envs — the #834 blast radius. Count those three
destinations in any compromise assessment of this credential.

| Variable                      | `dev`           | `staging`                                                                                                                                                                          | `prod`                                                                                                             |
| ----------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `BACKUP_S3_ENDPOINT`          | _(leave empty)_ | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` — Cloudflare dashboard → R2 Object Storage → Account Details → S3 API. No trailing slash, no bucket name.                            | _(same value as staging when the prod job is added — see #814 `scope:production`)_                                 |
| `BACKUP_S3_BUCKET`            | _(leave empty)_ | The R2 backup bucket's name (Cloudflare dashboard → R2 Object Storage → the private bucket created for #1287). Just the name, no `s3://`.                                            | _(same bucket planned — but today the workflow hardcodes its `staging/` object prefix, so the prod job (#814 `scope:production`) must parameterize that prefix to `production/`, not just duplicate the job)_ |
| `BACKUP_S3_ACCESS_KEY_ID`     | _(leave empty)_ | From the R2 API token scoped **Object Read & Write on that one bucket only** (R2 → `{} API` → Manage API tokens). Not an account-wide key.                                            | _(same token as staging — it is bucket-scoped, not environment-scoped)_                                            |
| `BACKUP_S3_SECRET_ACCESS_KEY` | _(leave empty)_ | The same R2 API token's secret. Shown once at token creation; rotate the token if lost.                                                                                              | _(same token as staging)_                                                                                          |

Optional, not currently set: `BACKUP_S3_REGION` (defaults to `auto`, which is
correct for R2 — set it only for a provider that pins a real region) and
`BACKUP_RETENTION_DAYS` (defaults to 30).

---

## References — Framework-Specific Names

Add these in **all three environments** in Infisical. The value is always the same reference string — Infisical resolves it to the canonical value for that environment.

| Variable                             | Value to enter in Infisical                             | Which app reads it |
| ------------------------------------ | ------------------------------------------------------- | ------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`           | `${SUPABASE_URL}`                                       | apps/web           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`      | `${SUPABASE_ANON_KEY}`                                  | apps/web           |
| `NEXT_PUBLIC_API_URL`                | `${API_URL}`                                            | apps/web           |
| `NEXT_PUBLIC_APP_URL`                | `${APP_URL}`                                            | apps/landing       |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `${STRIPE_PUBLISHABLE_KEY}`                             | apps/web           |
| `NEXT_PUBLIC_SENTRY_DSN`             | _(literal DSN — see below, **not** a `${…}` reference)_ | apps/web           |
| `EXPO_PUBLIC_SUPABASE_URL`           | `${SUPABASE_URL}`                                       | apps/mobile        |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`      | `${SUPABASE_ANON_KEY}`                                  | apps/mobile        |
| `EXPO_PUBLIC_API_URL`                | `${API_URL}`                                            | apps/mobile        |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `${STRIPE_PUBLISHABLE_KEY}`                             | apps/mobile        |
| `EXPO_PUBLIC_APP_URL`                | `${APP_URL}`                                            | apps/mobile        |

**You type the literal string `${SUPABASE_URL}` as the value.** Infisical recognizes this as a reference and resolves it at sync/inject time.

---

## What Each App Actually Reads

### apps/api (NestJS — Render)

Reads these directly (no prefix needed):

| Variable                      | Source file                                                                                                                                                                                                                                                              | Required |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| `SUPABASE_URL`                | `supabase.provider.ts`                                                                                                                                                                                                                                                   | ✅       |
| `SUPABASE_SERVICE_ROLE_KEY`   | `supabase.provider.ts`                                                                                                                                                                                                                                                   | ✅       |
| `SUPABASE_ANON_KEY`           | `env.validation.ts`                                                                                                                                                                                                                                                      | ✅       |
| `STRIPE_SECRET_KEY`           | `stripe.service.ts`                                                                                                                                                                                                                                                      | ✅       |
| `STRIPE_WEBHOOK_SECRET`       | `stripe.service.ts`                                                                                                                                                                                                                                                      | ✅       |
| `STRIPE_PRICE_ID`             | `stripe.service.ts`                                                                                                                                                                                                                                                      | ✅       |
| `PORT`                        | `main.ts` (default: `3001`)                                                                                                                                                                                                                                              | ❌       |
| `NODE_ENV`                    | `infrastructure/observability/sentry-options.ts` (default: `development`)                                                                                                                                                                                                | ❌       |
| `SENTRY_DSN`                  | `main.ts` (optional; unset → Sentry no-ops entirely. When set, pair it with `ANALYTICS_HMAC_SALT`)                                                                                                                                                                       | ❌       |
| `SENTRY_TRACES_SAMPLE_RATE`   | `infrastructure/observability/sentry-options.ts` (default: `0.1`; a malformed value yields `NaN` — #904)                                                                                                                                                                 | ❌       |
| `SUPABASE_JWT_SECRET`         | `custom-throttler.guard.ts` (per-user rate-limit keying; falls back to per-IP when unset)                                                                                                                                                                                | ❌       |
| `EVENT_CHECK_IN_TOKEN_SECRET` | `application/services/attendance.service.ts` (signs/verifies rotating event check-in codes; mint 503s and tokens are rejected when unset)                                                                                                                                | ❌       |
| `ANALYTICS_HMAC_SALT`         | `analytics.service.ts` (analytics keying) · `infrastructure/observability/pseudonyms.ts` (Sentry user/chapter hashes + security-event `originHash`); analytics disabled and pseudonyms omitted when unset                                                                | ❌       |
| `POSTHOG_API_KEY`             | `analytics.module.ts` — `selectAnalyticsProvider()` (selects PostHog vs no-op provider; **the choice is logged at boot** under the `AnalyticsProvider` context, and a salt set with no key warns)                                                                        | ❌       |
| `POSTHOG_HOST`                | `analytics.module.ts` (provider host override; default PostHog US)                                                                                                                                                                                                       | ❌       |
| `RESEND_API_KEY`              | `modules/email/email.module.ts` — `selectEmailProvider()` (selects Resend vs no-op provider for invite emails; **the choice is logged at boot** under the `EmailProvider` context)                                                                                       | ❌       |
| `RESEND_FROM_EMAIL`           | `modules/email/email.module.ts` (from-address override; default `Frapp <invites@frapp.live>`)                                                                                                                                                                            | ❌       |
| `DISCORD_BOT_TOKEN`           | `infrastructure/discord/discord-bot-gateway.service.ts` (the one global Signet bot token; unset → the bot import path reports itself unavailable and every `/v1/discord/*` route 503s)                                                                                   | ❌       |
| `DISCORD_CLIENT_ID`           | `infrastructure/discord/discord-oauth-client.service.ts` (builds the authorize URL)                                                                                                                                                                                      | ❌       |
| `DISCORD_CLIENT_SECRET`       | `infrastructure/discord/discord-oauth-client.service.ts` (HTTP Basic on the token exchange and revoke — the step that proves the authorizing human administers the guild)                                                                                                | ❌       |
| `API_URL`                     | `application/services/discord-oauth.service.ts` — **the API reads this too, not just the web/mobile twins.** The Discord redirect URI is this value string-concatenated with `/v1/discord/connect/callback`, and it must match the Developer Portal registration exactly | ❌       |
| `APP_URL`                     | `application/services/discord-oauth.service.ts` — where the OAuth callback sends the browser back to. Every return path is resolved against this origin, which is what stops the callback becoming an open redirect                                                      | ❌       |

### apps/web (Next.js — Vercel)

Reads the `NEXT_PUBLIC_*` references:

| Variable                                | Source file                                                                                                                                             | Required                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`              | `lib/supabase/client.ts`, `server.ts`, `proxy.ts` — **`proxy.ts` is the one that throws** when it is missing under `NODE_ENV=production`                                                                                                                   | ✅                                                                                                                                                                                                                                                                                                                                                |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`         | `lib/supabase/client.ts`, `server.ts`, `proxy.ts` — **`proxy.ts` is the one that throws** when it is missing under `NODE_ENV=production`                                                                                                                   | ✅                                                                                                                                                                                                                                                                                                                                                |
| `NEXT_PUBLIC_API_URL`                   | `lib/providers/frapp-client-provider.tsx` (SDK base URL), `lib/providers/network-provider.tsx` (health poll — `/health` is the one route outside `/v1`) | ✅                                                                                                                                                                                                                                                                                                                                                |
| `NEXT_PUBLIC_LANDING_URL`               | `components/onboarding/chapter-wizard.tsx`                                                                                                              | ❌ — optional; base URL of the marketing site for the legal links (Terms/Privacy/FERPA) in chapter onboarding. Defaults to `https://frapp.live` when unset.                                                                                                                                                                                       |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`    | `lib/stripe.ts`                                                                                                                                         | ❌ — optional; Stripe **publishable** key (`pk_…`) for the member dues payment sheet. When unset, `getStripe()` returns `null` and no Pay affordance renders — local dev, CI, and the production build prerender all run without it. Publishable by design (it is safe in a client bundle); the secret key stays API-only as `STRIPE_SECRET_KEY`. |
| `NEXT_PUBLIC_SENTRY_DSN`                | `lib/sentry/options.ts` (read by `instrumentation.ts` and `instrumentation-client.ts`)                                                                  | ❌ — optional; **unset → `Sentry.init` is never called on any runtime**, so local dev, tests, and CI report nowhere. This is the `frapp-web` project's DSN, _not_ the API's `frapp-api` one — the two projects are separate so a browser error and a server error do not land in the same stream.                                                 |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT`        | `lib/sentry/options.ts` — **derived, never configured**                                                                                                 | 🚫 — **do not set this anywhere, including Infisical.** `next.config.js` maps it from Vercel's own `VERCEL_ENV` system variable under the `env` config, which inlines at build time and would silently win over any value you set. `NODE_ENV` cannot substitute: Vercel Preview and Production are _both_ `production` to Next.                   |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE` | `lib/sentry/options.ts` (default: `0.1`)                                                                                                                | ❌ — optional; same default as the API's `SENTRY_TRACES_SAMPLE_RATE`. Carries the same #904 caveat: a malformed value yields `NaN`, which the SDK treats as tracing enabled.                                                                                                                                                                      |
| `SENTRY_AUTH_TOKEN`                     | `next.config.js`, and `apps/mobile`'s `@sentry/react-native/expo` config plugin (both build-time only, never bundled)                                    | ❌ — optional; when absent, `withSentryConfig` skips source-map upload and the build still succeeds. Only needed in the deploy environment, where readable stack traces are wanted. **The mobile half is a second, separate place to set it:** the Expo plugin resolves it from the environment at EAS build time (the generated `sentry.properties` carries no token, only `# Using SENTRY_AUTH_TOKEN environment variable`), and there is no Infisical→EAS sync, so it does not arrive on its own. Unset, a mobile build still succeeds and every `frapp-mobile` stack trace arrives minified. |
| `SUPABASE_AUTH_BYPASS`                  | `proxy.ts`                                                                                                                                              | ❌ — CI-only flag (`"true"` skips auth redirects so Playwright visual tests can render protected pages; ignored when `NODE_ENV` is `production`)                                                                                                                                                                                                  |

> **Why `NEXT_PUBLIC_SENTRY_DSN` is a literal, not an Infisical `${…}` reference.** The other
> `NEXT_PUBLIC_*` rows above resolve to a canonical value shared with the API. This one must not:
> `SENTRY_DSN` is `frapp-api`'s DSN, and pointing the browser at it would merge two projects'
> events. Type the `frapp-web` DSN in as a literal value. A DSN is public by design (it is in every
> client bundle) — it authorizes _writing_ events, not reading them.
>
> **It still goes in Infisical, not in Vercel's dashboard.** Infisical is the canonical store and
> Vercel is a sync _destination_; a value set directly on the Vercel project lives outside the one
> place that is supposed to hold it and is invisible to every other environment. Add it to the
> **Staging** and **Production** Infisical environments and let `vercel-web-staging` /
> `vercel-web-production` carry it (inventory: [`SECRETS_MANAGEMENT.md` §5](./SECRETS_MANAGEMENT.md#5-configure-secret-syncs)).
> Leave the **local** environment unset — no DSN means `Sentry.init` is never called, which is what
> keeps local dev, tests, and CI reporting nowhere.
>
> **The DSN is the only Sentry variable you set for `apps/web`.** The environment tag is derived
> from `VERCEL_ENV` at build time (see the row above), and the sample rate has a working default.
> Configuration that restates something the platform already knows is a second copy to keep true,
> and its failure mode is silent — a Staging entry reading `production` mislabels every staging
> event with nothing to catch it.
>
> Note the blast radius (#834): every sync reads path `/` and pushes its **whole** source
> environment, so `frapp-landing` receives this key too. It is inert there — `apps/landing` never
> reads it, so Next has nothing to inline — but it is one more key riding a sync that cannot filter.
>
> ⚠️ **`ANALYTICS_HMAC_SALT` must never gain a `NEXT_PUBLIC_` twin**, including for Sentry. The
> browser scrubber deliberately holds no salt and redacts identifiers instead of hashing them; the
> one pseudonym on a web event is fetched already-hashed from `GET /v1/analytics/identity`. See
> `apps/web/lib/sentry/options.ts`.

### apps/landing (Next.js — Vercel)

| Variable              | Source file    | Required |
| --------------------- | -------------- | -------- |
| `NEXT_PUBLIC_APP_URL` | `app/page.tsx` | ✅       |

### apps/mobile (Expo — EAS)

Reads the `EXPO_PUBLIC_*` references:

| Variable                             | Source                                                          | Required                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `EXPO_PUBLIC_SUPABASE_URL`           | `lib/supabase.ts` — Supabase client init                        | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY`      | `lib/supabase.ts` — Supabase client init                        | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXPO_PUBLIC_API_URL`                | API client init + `eas.json`                                    | ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `lib/payments/stripe.ts` — the s11 dues payment sheet           | ❌ — optional, and the mobile twin of `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` above (same `pk_…` value, same publishable-by-design reasoning; the secret key stays API-only). When unset, `isStripeAvailable()` is false and the Pay control renders **disabled with its reason stated** rather than hidden — balance and history still load. Expo Go cannot run Stripe's native module at all, so a Go session behaves the same way whether or not the key is set.                                                                                                                                                                                                                                                                                  |
| `EXPO_PUBLIC_APP_URL`                | `lib/onboarding/chapter-wizard/invite-link.ts` `webAppOrigin()` | ❌ — optional Infisical `${APP_URL}` twin of `NEXT_PUBLIC_APP_URL`. Unset, the first-officer wizard shares `https://app.frapp.live/join?token=…`. Device builds also need this name in the EAS dashboard (`development` / `preview` / `production`); **there is no Infisical→EAS sync** (the six live syncs are Render + Vercel only — [`SECRETS_MANAGEMENT.md` §5](./SECRETS_MANAGEMENT.md#5-configure-secret-syncs)).                                                                                                                                                                                                                                                                                                                           |
| `EXPO_PUBLIC_LANDING_URL`            | `lib/more/legal.ts` — Terms / Privacy / FERPA                   | ❌ — optional, mobile twin of `NEXT_PUBLIC_LANDING_URL` (direct-set; there is no canonical `LANDING_URL`). Unset, `legal.ts` falls back to `https://frapp.live` via `??` (an **empty** string does not fall back — leave it unset rather than blank). Device builds: also set in the EAS dashboard.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `EXPO_PUBLIC_ASK_ENABLED`            | `lib/ask/flag.ts` — the s17 Ask sheet                           | ❌ — optional, **default off**, and **not a secret**: it is a build-time on/off switch, not a credential, and it has no canonical variable behind it (set it directly per build, not as an Infisical `${…}` reference). Only the exact strings `"1"` and `"true"` switch Ask on; unset, empty, `"0"`, `"yes"` and `"TRUE"` all leave it off, because the corpus behind Ask is synthetic and a loose truthiness check would put invented figures in front of a real member. With it off the ✦ pill still opens the sheet and the sheet states why it cannot answer. `EXPO_PUBLIC_` is inlined at build time, so this is fixed for a given build — it is **not** a per-chapter or per-member switch and must never be described to a member as one. |
| `EXPO_PUBLIC_SENTRY_DSN`             | `lib/sentry/options.ts` (read by `app/_layout.tsx`)             | ❌ — optional; **unset → `Sentry.init` is never called**, so `expo start`, Expo Go, CI and vitest report nowhere. This is the `frapp-mobile` project's DSN — **not** `frapp-web`'s and not the API's `frapp-api` one; three surfaces, three noise profiles, three alert thresholds. **Not an Infisical entry**: there is no Infisical→EAS sync ([`SECRETS_MANAGEMENT.md` §5](./SECRETS_MANAGEMENT.md#5-configure-secret-syncs) — the six live syncs are Render + Vercel only), so it is set by hand in the **EAS dashboard** per build profile (`development` / `preview` / `production`). A DSN is public by design — it authorizes _writing_ events, not reading them. |
| `EXPO_PUBLIC_SENTRY_ENVIRONMENT`     | `lib/sentry/options.ts` — the Sentry `environment` tag  | ❌ — optional, and **set in the committed `eas.json`**, not in Infisical or the EAS dashboard. EAS exposes no `VERCEL_ENV` equivalent to the bundle (`EAS_BUILD_PROFILE` is unprefixed, so it is never inlined), so the mapping lives in the repo where it can be reviewed: `development` → `development`, `preview` → `staging`, `production` → `production`. Unset it defaults to `development` — **not** `production`, which is what Sentry itself would assume, and which would file a simulator crash beside a real member's. |
| `EXPO_PUBLIC_WEB_SECURE_STORE`       | `lib/secure-store.web.ts` — Expo-web session persistence | ❌ — optional, **default off**, and **local demo capture only**. Set to exactly `"1"` it parks the Supabase session in `localStorage` on Expo web, which any XSS on that origin can lift — acceptable for `localhost` holding a seeded demo chapter, never for a build a real member signs into. **Must never be set for a hosted build**; nothing ships mobile-web today (`eas.json` builds native only), so it has no deployed surface. See [`demo-data.md`](../../guides/demo-data.md#mobile-setup). |

Both Supabase values are read at module scope and are **optional at boot**: when
either is missing `getSupabaseClient()` returns `null` instead of throwing, so
`npm run check-types` / `npm run test` and a bare `expo start` still work. Sign-in
is unavailable in that state and the sign-in screen says so.

> One mobile credential lives **outside Infisical entirely**: `eas submit` (Android)
> reads a Google Play **service-account key** from `apps/mobile/play-service-account.json`
> (`eas.json` → `submit.production.android.serviceAccountKeyPath`). Keep it on the
> machine running `eas submit`; it is gitignored and must never be committed. No such
> key exists yet — it becomes real when Play submission is set up (#938).

`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` is optional for the same class of reason:
CI, a local `expo start`, and every Expo Go session run without it, and none of
them can take a payment anyway. `EXPO_PUBLIC_APP_URL` and `EXPO_PUBLIC_LANDING_URL`
are optional in the same way — unset, invite links and legal pages fall back to
the production origins documented in the table. `EXPO_PUBLIC_ASK_ENABLED` is optional in a
stronger sense — nothing sets it anywhere today, which is what keeps the mocked
Ask corpus off every shipped build (`spec/ui/mobile/screens.md` s17).

### Client-exposure audit

**Every _prefixed_ variable in the three tables above is public by design.** A
`NEXT_PUBLIC_`/`EXPO_PUBLIC_` prefix means the value is inlined into a bundle any user can read — so
the prefix is the decision, and it is irreversible once shipped.

The prefixed set is deliberately small. It is **exactly these nineteen variables** — enumerated by name
rather than summarised, so it can be diffed against a bundle without interpretation:

|                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` · `EXPO_PUBLIC_SUPABASE_URL`                     | project URL                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `EXPO_PUBLIC_SUPABASE_ANON_KEY`           | anon key — public by Supabase's design, gated by RLS and the API's own guards                                                                                                                                                                                                                                                                                                                                                             |
| `NEXT_PUBLIC_API_URL` · `EXPO_PUBLIC_API_URL`                               | API base URL                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` · `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **publishable** key — public by Stripe's design; the secret key stays API-only                                                                                                                                                                                                                                                                                                                                                     |
| `NEXT_PUBLIC_APP_URL` · `EXPO_PUBLIC_APP_URL`                               | landing / mobile-wizard → app URL. The Expo twin is Infisical `${APP_URL}` like the Next one; unset, `invite-link.ts` falls back to `https://app.frapp.live`                                                                                                                                                                                                                                                                              |
| `NEXT_PUBLIC_LANDING_URL` · `EXPO_PUBLIC_LANDING_URL`                       | app → landing URL (web chapter-wizard legal links; mobile `legal.ts`). **Two of three entries with no canonical variable behind them** — there is no `LANDING_URL` in the grid and they are absent from the references table, so they are optional and set directly where set at all. Both defaults are `https://frapp.live` via `??` (nullish), so an **empty** value does not trigger the fallback — leave them unset rather than blank |
| `EXPO_PUBLIC_ASK_ENABLED`                                                   | s17 Ask on/off for a build. **The other entry with no canonical variable behind it** — a feature switch, not a value, so it is set directly where set at all (nothing sets it today) and carries nothing worth reading out of a bundle                                                                                                                                                                                                    |
| `NEXT_PUBLIC_SENTRY_DSN` · `EXPO_PUBLIC_SENTRY_DSN`                         | Sentry ingest DSNs. **A pair that deliberately does _not_ share a value** — the two names point at different projects (`frapp-web`, `frapp-mobile`), and the API's unprefixed `SENTRY_DSN` at a third (`frapp-api`). A DSN authorizes _writing_ events, not reading them, so it is public by design; it is in this set because it reaches a bundle, not because it is sensitive. The web half is an Infisical literal synced to Vercel; the mobile half is entered in the EAS dashboard, because no Infisical→EAS sync exists |
| `NEXT_PUBLIC_SENTRY_ENVIRONMENT` · `EXPO_PUBLIC_SENTRY_ENVIRONMENT`         | The Sentry `environment` tag. Neither has a canonical value: the web half is **derived** from Vercel's `VERCEL_ENV` in `next.config.js` and must not be set anywhere; the mobile half is set per build profile in the committed `eas.json`. Carries no credential |
| `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`                                     | Web tracing sample rate (default `0.1`). **Web only** — `apps/mobile` hardcodes its rate in `lib/sentry/options.ts` rather than reading a variable, so there is no `EXPO_PUBLIC_` twin. Carries no credential |
| `EXPO_PUBLIC_WEB_SECURE_STORE`                                              | Expo-web session persistence for local demo capture. **Mobile only, default off, and never set on a hosted build** — it is a behavior switch, not a credential, but it is in this set because turning it on changes where a real session is stored. Nothing ships mobile-web today, so it has no deployed surface |

Nineteen variables over **five** canonical values plus nine direct-set or derived entries; each
`NEXT_PUBLIC_`/`EXPO_PUBLIC_` pair that shares a canonical is an Infisical reference to the same value —
the three Sentry rows are the exception, being pairs of *names* over deliberately different values. No secret
belongs in this set; `ANALYTICS_HMAC_SALT` is the worked example of why, above.

Six names were missing from this enumeration until #1167 — the five Sentry ones and
`EXPO_PUBLIC_WEB_SECURE_STORE` — though all six reach a bundle and three of them were already documented in
the tables above it. `EXPO_PUBLIC_WEB_SECURE_STORE` was absent from this file entirely, documented only in
[`demo-data.md`](../../guides/demo-data.md); it is the reason the count moved by four rather than the three
#1167 estimated. Worth stating plainly, because the set's whole
value is being exhaustive: **nothing checks this list.** `check:doc-tables` is a required-check-roster gate
over `GITHUB_BRANCH_PROTECTION_RUNBOOK.md` — it never
opens this file. Adding a prefixed variable without adding it here fails no CI job, which is how the previous
three survived.

`SUPABASE_AUTH_BYPASS` is the one **unprefixed** entry in the `apps/web` table: it is read in
`proxy.ts` (middleware, server-side), is CI-only, and is ignored when `NODE_ENV` is `production`. It
is not client-visible and must never gain a prefix.

Audited **2026-08-15** (#851) against production builds of `apps/web` and `apps/landing` and the
`apps/mobile` config: none of 15 server-only variable names appeared in the emitted client output,
gitleaks found nothing in either client bundle, and mobile read only the three `EXPO_PUBLIC_*`
values listed here at the time. **`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY` was added afterwards** (C6 of
#937): it is a publishable key by Stripe's own design, the same value the web bundle already carries,
so it changes the count but not the finding. **`EXPO_PUBLIC_ASK_ENABLED` was added later still** (C7
of #937): it is a boolean feature switch with no credential behind it, so it likewise changes the
count and not the finding. **`EXPO_PUBLIC_APP_URL` was documented 2026-08-20** after #1102
(`invite-link.ts`); it is the same public origin `NEXT_PUBLIC_APP_URL` already carries, so it
changes the count but not the finding. **`EXPO_PUBLIC_LANDING_URL` was already consumed**
(`legal.ts`, related #275) and is listed here as of the same date **without re-running the
2026-08-15 bundle audit** — it is the same public landing origin `NEXT_PUBLIC_LANDING_URL`
already carries. **The name check is the load-bearing one** — the audit built with placeholder
env values, so it establishes which variables reach the browser, not which values do; a clean
gitleaks pass over a placeholder build is not by itself evidence that no real credential ships. Full
method, caveats, and re-run instructions:
[`SECRET_SCANNING.md` § Audit history](../ci-cd/SECRET_SCANNING.md#audit-history).

**Adding a client-read variable? The prefix decision is the security review.** Step 3 of _Adding a
New Variable_ at the end of this document is mechanical — it tells you how to add the reference, not
whether you should. Before you do: confirm the value is safe in a bundle any user can read, add it to
the table above with its justification, and re-run the audit above if it could carry a credential.

---

## Infisical → Provider Syncs

**The sync inventory lives in one place: [`SECRETS_MANAGEMENT.md` §5 "Configure Secret Syncs"](./SECRETS_MANAGEMENT.md#5-configure-secret-syncs).** Go there for the
per-sync source environment, secret path, destination scope, and git branch, plus how to verify all
of it against the dashboards.

This section used to carry its own copy of that table and drifted badly enough to send a reader
looking for problems that did not exist while missing ones that did. Two facts it asserted were
false, and both are worth naming so they are not reintroduced here:

- It claimed the Vercel syncs carry only `NEXT_PUBLIC_*` variables. They do not. **Every sync reads
  secret path `/` and pushes the entire source environment** — Infisical has no per-key filter. The
  frontend Vercel projects therefore receive backend credentials they never use. Narrowing this is
  tracked in **#834**.
- It listed a GitHub Actions sync. There is none — `deploy-api.yml` _pulls_ from Infisical at job
  time. See "GitHub Actions is not a sync" in `SECRETS_MANAGEMENT.md`.

There are **6 live syncs**. Do not restate their configuration here; link instead. A second copy of
provider state in a second file has no mechanism to stay true.

---

## GitHub Secrets

**Permanent (Infisical bootstrap):**

| Secret                          | Where to get it                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `INFISICAL_MACHINE_IDENTITY_ID` | Infisical → Access Control → Machine Identities → open the identity → **Universal Auth** panel → **Client ID**. ⚠️ **Not** the identity's own **ID** shown on its Details page — those are two different UUIDs on two different screens, and this secret's name points at the wrong one. Pasting the Details-page ID produces `401 Invalid credentials` with no other symptom. |
| `INFISICAL_CLIENT_SECRET`       | Same **Universal Auth** panel → **Add Client Secret**. The value is shown once, at creation — if it was not saved, issue a new one rather than hunting for the old.                                                                                                                                                                                                            |
| `INFISICAL_PROJECT_ID`          | Infisical → Project Settings → Project ID. Not read by `deploy-api.yml`, which hardcodes `project-slug: frapp-live-ej-ls`.                                                                                                                                                                                                                                                     |

**Current deploy workflow state:**

`deploy-api.yml` now injects deploy-time secrets directly from Infisical using `Infisical/secrets-action`. That means GitHub **environment-scoped** copies of:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `RENDER_DEPLOY_HOOK_URL`
- `API_HEALTHCHECK_URL`

are **no longer required** for the workflow to run, as long as the three bootstrap repository secrets above remain valid and the referenced Infisical project/environment slugs exist.

---

## Local Development

**Primary method (recommended — no `.env.local` files):**

```bash
# One-time: Infisical CLI (also available via repo devDependency / npx)
npx infisical login

# Default — API + web + landing from repo root:
npm run dev:stack
```

Mobile and per-app `dev:*` commands: [`LOCAL_DEV.md`](./LOCAL_DEV.md).

**Fallback (if you don't want to use Infisical CLI):**

Create `.env.local` files in each app directory with the values from the `local` column above. These files are gitignored.

### Production builds (`npm run build`) and `NODE_ENV`

The two Next apps build through [`scripts/next-build.mjs`](../../../scripts/next-build.mjs), which pins
`NODE_ENV=production` for the build. **Do not change `build` back to a bare `next build`.**

`next build` does _not_ force a production `NODE_ENV` — `next/dist/bin/next` only warns, then does
`process.env.NODE_ENV = process.env.NODE_ENV || defaultEnv`, so an ambient `NODE_ENV=development`
survives. Next selects its server runtime purely off that value
(`next/dist/server/route-modules/app-page/module.compiled.js`), loading the React **dev** runtime to
prerender chunks Turbopack compiled against the React **prod** runtime. Two React copies means the
prod copy's dispatcher is `null`, so the first hook in Next's own `OuterLayoutRouter` throws:

```
TypeError: Cannot read properties of null (reading 'useContext')
```

Every prerendered route dies; the route named in the error is just whichever build worker reached it
first, so the failure looks route-specific when it is not. The cloud sandbox exports
`NODE_ENV=development`, which is what surfaced this (FRA-305). `next build --debug-prerender` is
unaffected — Next sets `NODE_ENV=development` itself, after the wrapper hands off.

`apps/web` additionally needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` **at build
time**. Exactly one route reaches for a Supabase client while prerendering — `/chat`, via
`lib/chat/chat-provider.tsx` → `lib/realtime/supabase-realtime.ts` — and the build exits there with
`Your project's URL and API key are required to create a Supabase client!`. Both are read non-null-asserted
in `lib/supabase/client.ts`, so TypeScript never flags the gap and it only appears at prerender.

Vercel supplies these. Locally, run the build under `npx infisical run` or export your local stack's
values. In a Claude Code cloud sandbox nothing is needed:
[`scripts/cloud-sandbox-up.sh`](../../../scripts/cloud-sandbox-up.sh) writes them to
`apps/web/.env.local` at session start (#1156), so a red `npm run build -w apps/web` there is a real
failure rather than a missing-env one.

---

## Adding a New Variable

1. Add to code (`process.env.YOUR_VAR` or `ConfigService`).
2. Add canonical value to Infisical in all 3 environments.
3. If it needs a framework prefix → add an Infisical reference (`NEXT_PUBLIC_YOUR_VAR = ${YOUR_VAR}`).
4. Update this document.

## Removing a Variable

1. Remove from code.
2. Remove from Infisical (all environments, canonical + references).
3. Update this document.
