# Pre-beta go-live runbook for Signet: six hand-executed setup procedures

Every one of these six tasks is doable by hand from a dashboard or CLI, and for each one the official current docs give a precise procedure. The two highest-risk steps are **task 1** (a wrong `--status` choice on migration repair can cause `db push` to re-run or skip real migrations) and **task 2** (enabling the auth hook toggle before the production function exists can break sign-in entirely). Tasks 3–6 are lower-risk configuration work where the failures are silent-nothing-shows-up problems rather than data-corruption problems. Below, each task gives the concrete current steps followed by the single mistake first-timers make most.

---

## 1. Supabase migration repair for the orphan "foreign" row

**Your situation exactly:** the remote `supabase_migrations.schema_migrations` table has a version row (`20260228000000`) that has no matching file in `supabase/migrations`, and this drift is blocking `supabase db push`. The correct fix is to **delete that remote history row**, which is what `--status reverted` does.

**The exact command sequence:**

1. Confirm the drift first: `supabase migration list`. Supabase compares only timestamps between your local `supabase/migrations` directory and the remote `schema_migrations` table, so a row that appears under the `REMOTE` column with a blank `LOCAL` column is your orphan. [supabase](https://supabase.com/docs/reference/cli/supabase-migration-list)
2. Repair it: `supabase migration repair 20260228000000 --status reverted`. Per the official CLI reference, "Marking as reverted will delete an existing record from the migration history table." [supabase](https://supabase.com/docs/reference/cli/supabase-migration-repair) Pass **only the timestamp** as the version argument — the docs use the bare timestamp (e.g. `supabase migration repair 20230103054303 --status reverted`), not the full `_enable_rls...` name. [supabase](https://supabase.com/docs/reference/cli/supabase-migration-repair)
3. Verify the row is gone: re-run `supabase migration list` and confirm `20260228000000` no longer appears under `REMOTE`. [supabase](https://supabase.com/docs/reference/cli/supabase-migration-repair)
4. Verify `db push` will proceed cleanly **without applying anything yet**: `supabase db push --dry-run`, which "Print[s] the migrations that would be applied, but don't actually apply them." [supabase](https://supabase.com/docs/reference/cli/supabase-db-push) You should see your ~49 pending migrations listed. Then run the real `supabase db push`.

**Why `reverted` and not `applied` or a manual `DELETE`:** `--status applied` does the opposite — it "insert[s] a new record" into the history table. [supabase](https://supabase.com/docs/reference/cli/supabase-migration-repair) Using it here would leave the orphan (or a duplicate) in place and keep `db push` treating the system as out of sync. A manual SQL `DELETE` on `schema_migrations` achieves the same end result as `--status reverted` (a Supabase maintainer describes reverted as deleting "the row associated with the migration in the migration history"), but the CLI command is the sanctioned, less-error-prone path. [github](https://github.com/orgs/supabase/discussions/134)

**The real risk if done wrong:** `db push` "compares your local `supabase/migrations` folder against that table and runs only the ones not yet applied, in order." [supabase](https://supabase.com/docs/guides/deployment/database-migrations) So the danger is metadata-driven, not immediate: `migration repair` "updates the tracking table only — it does not apply or revert any SQL," meaning it can't directly corrupt your schema, but it *can* corrupt the metadata that drives future pushes. [supabase](https://supabase.com/docs/guides/deployment/database-migrations) Concretely — **if you ever mark as `reverted` a migration whose SQL changes *are actually present* in the database and which *does* have a local file, the next `db push` will try to re-run that file** because it's no longer recorded as applied. In your specific case this is safe because the row has no local file to re-run, so deleting it just unblocks the queue. Confidence: **high** — the command semantics are quoted directly from the current CLI reference.

**Prerequisite / connection note:** `supabase migration repair` requires your project to be linked (`supabase link`); it accepts `--linked`, `--db-url`, and `-p/--password` flags for the remote connection. [supabase](https://supabase.com/docs/reference/cli/supabase-migration-repair)

**Most common mistake:** running the repair with `--status applied` (the wrong direction) because it sounds like "make it consistent," or passing the full migration name instead of the bare timestamp. Also note two open CLI bug reports where users found the repair recommendation confusing or where version-ordering assumptions didn't reconcile [github](https://github.com/supabase/cli/issues/6036) — so **always follow with `--dry-run` before the real push** rather than trusting the first `migration list` output blindly.

---

## 2. Enabling the custom access token hook in production

**Order of operations matters here more than anywhere else.** The function must exist in production *before* you flip the dashboard toggle, or you risk breaking sign-in.

**Step-by-step:**

1. **Create the function in production first** (via migration, since it currently has 0 rows in `pg_proc`). The required signature is a single JSONB argument named `event`, returning JSONB: `create or replace function public.custom_access_token_hook(event jsonb) returns jsonb ...`. [supabase](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook) The return value must be a JSONB object with a top-level `claims` key (e.g. `return jsonb_build_object('claims', new_claims);`), and it **must not remove any required claims** — Supabase validates the returned claims after the hook runs and returns an error if required ones (`iss`, `aud`, `exp`, `iat`, `sub`, `role`, `aal`, `session_id`, `email`, `phone`, `is_anonymous`) are missing. [supabase](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)

2. **Grant the auth admin role permission** (this is the single most commonly missed step). Run exactly:
   - `grant execute on function public.custom_access_token_hook to supabase_auth_admin;`
   - `grant usage on schema public to supabase_auth_admin;`
   - `revoke execute on function public.custom_access_token_hook from authenticated, anon, public;` [supabase](https://supabase.com/docs/guides/auth/auth-hooks)
   
   Supabase explicitly recommends **not** using `SECURITY DEFINER` on hook functions — it would grant the extensive permissions of the `postgres` role; instead grant explicitly to `supabase_auth_admin` as above. [supabase](https://supabase.com/docs/guides/auth/auth-hooks)

3. **If your function reads any application table**, you must also grant `supabase_auth_admin` access to it *and* add an RLS policy permitting it, e.g. `grant all on table public.user_roles to supabase_auth_admin;` plus a policy like `create policy "Allow auth admin to read user roles" ... to supabase_auth_admin ... using (true);`. [supabase](https://supabase.com/docs/guides/database/postgres/custom-claims-and-role-based-access-control-rbac) Skipping this makes the hook error at runtime once enabled.

4. **Enable the hook in the dashboard:** navigate to **Authentication → Hooks** (`/dashboard/project/_/auth/hooks`), select the "Postgres Function" type (not HTTP), and point it at your function. The dashboard references a Postgres hook internally as a URI of the form `pg-functions://postgres/public/custom_access_token_hook`. [supabase](https://supabase.com/docs/guides/auth/auth-hooks)

**What breaks in each wrong order:**
- **Toggle on, function missing:** the hook invocation fails inside Postgres. Supabase documents that runtime hook errors "propagate from the hook to Supabase Auth and [are] translated into an HTTP error which is returned to your application" — meaning token issuance fails and **sign-in breaks**. (The docs confirm the error-propagation mechanism but don't spell out this exact scenario, so this is well-supported inference, confidence **moderate-high**.) [supabase](https://supabase.com/docs/guides/auth/auth-hooks)
- **Function created, toggle never flipped:** no breakage — Supabase simply never invokes the hook, so your custom claims are silently never added to tokens. This fails quiet, not loud.

**Additional gotchas:** Postgres hooks have a **2-second execution budget**; slow logic causes hook failure during auth. [supabase](https://supabase.com/docs/guides/auth/auth-hooks) Save the enabled hook as a migration so it's versioned and reproducible. [supabase](https://supabase.com/docs/guides/auth/auth-hooks)

**Most common mistake:** forgetting the `grant execute ... to supabase_auth_admin` block — the function exists and looks fine, but the auth admin can't call it, so every login errors once the toggle is on. The safe production rollout: run the create-function + grants migration, confirm the function appears in `pg_proc`, *then* flip the dashboard toggle, and immediately test one sign-in.

---

## 3. Stripe going live (web API + Next.js + Expo mobile)

**(a) Live API keys and placement.** First complete business verification/account activation — live mode is gated on it. [stripe](https://docs.stripe.com/get-started/account/set-up) Then switch to live keys in the dashboard: publishable keys start `pk_live_`, secret `sk_live_`, restricted `rk_live_`. [stripe](https://docs.stripe.com/keys) **Stripe now recommends restricted keys (RAKs) over unrestricted secret keys** — it says secret keys aren't recommended for new use cases and to migrate to RAKs. [stripe](https://docs.stripe.com/keys/restricted-api-keys) For your stack: the `pk_live_` publishable key goes in the Next.js frontend (safe to embed) and the Expo client; the `rk_live_` or `sk_live_` key stays server-side in the NestJS API environment only. [stripe](https://docs.stripe.com/keys) One activation-era note: accounts created before May 2026 may not have RAKs by default and should create them. [stripe](https://docs.stripe.com/keys)

**(b) Live webhook endpoint.** This is a **fresh registration** — you cannot reuse test-mode config. Register a new endpoint (Workbench → Webhooks) pointing at your production HTTPS URL, select your event types, and Stripe issues a **new signing secret starting `whsec_`**. [stripe](https://docs.stripe.com/webhooks/go-live) The critical, explicitly-documented gotcha: **"if you use the same endpoint for both test and live API keys, the webhook signing secret is different for each one."** [stripe](https://docs.stripe.com/webhooks/go-live) So your NestJS handler needs a *different* `whsec_` value in the production environment than in staging/test. Also note the Stripe CLI `stripe listen` secret is different again and defaults to test mode (it has a `--live` flag but you generally shouldn't use it for production verification).  Stripe's checklist requires confirming the live endpoint handles delayed, duplicate, and out-of-order events and returns a `2xx` quickly. [stripe](https://docs.stripe.com/get-started/checklist/go-live)

**(c) Mobile / PaymentSheet going live** — this is where first-timers lose the most time. The Expo app needs only the `pk_live_` publishable key in `StripeProvider`; the secret key stays server-side creating the PaymentIntent. [stripe](https://docs.stripe.com/payments/accept-a-payment?platform=react-native&ui=payment-sheet) The commonly-forgotten mobile items:
- **Apple Pay merchant ID:** `StripeProvider` requires `merchantIdentifier="merchant.com.yourapp"` — "required for Apple Pay," and in Expo it's also set via the `@stripe/stripe-react-native` config plugin in `app.json`, "otherwise Apple Pay will not work as expected." [expo](https://docs.expo.dev/versions/latest/sdk/stripe/)
- **Return URL / URL scheme:** `urlScheme` in `StripeProvider` plus `returnURL: 'your-app://stripe-redirect'` in `initPaymentSheet` are "required for 3D Secure and bank redirects." [stripe](https://docs.stripe.com/payments/accept-a-payment?platform=react-native&ui=payment-sheet)
- **`merchantDisplayName`** must be set in `initPaymentSheet`. [stripe](https://docs.stripe.com/payments/accept-a-payment?platform=react-native&ui=payment-sheet)
- **Expo Go does not support Apple Pay or Google Pay** — you must use a development/production build (ties directly into task 4). [stripe](https://docs.stripe.com/apple-pay?platform=react-native)
- **Google Pay going live:** request production access in the Google Pay & Wallet Console, add the `com.google.android.gms.wallet.api.enabled` metadata to `AndroidManifest.xml`, and test with `testEnv: false` from a signed release build with live keys. [stripe](https://docs.stripe.com/google-pay?platform=react-native)
- You need **at least one payment method enabled in the dashboard** to create a PaymentIntent at all. [stripe](https://docs.stripe.com/payments/accept-a-payment?platform=react-native&ui=payment-sheet)

**(d) Stripe's own go-live checklist highlights:** keep server library and webhook endpoint on the same API version; test invalid/incomplete/duplicate data; **do not rely on test objects** (sandbox-created products/plans/coupons don't exist in live mode — recreate them with the *same ID values*, since your code references IDs not names); rotate keys and confirm none are committed in code; register production webhooks; enable 2FA and confirm bank/payout details before accepting live charges. [stripe](https://docs.stripe.com/get-started/checklist/go-live) [stripe](https://docs.stripe.com/get-started/account/checklist)

**Most common mistake first-timers hit first:** reusing the test-mode webhook signing secret in production (signature verification then fails on every live event), or forgetting `merchantIdentifier` so Apple Pay silently doesn't appear in the sheet. The "test objects don't carry over to live mode" surprise is the other classic. Note: fulfillment should be driven by webhooks (`payment_intent.succeeded`), not client callbacks. [stripe](https://docs.stripe.com/payments/accept-a-payment?platform=react-native&ui=payment-sheet)

---

## 4. Expo EAS project setup from scratch

**Exact command sequence and what each writes:**

1. `eas login`.
2. `eas init` — this **creates the EAS project and writes `extra.eas.projectId` into `app.json` automatically** (prompting "Which account should own this project?"). This is the canonical way to populate your missing `projectId`. [expo](https://docs.expo.dev/tutorial/eas/configure-development-build/)
3. `eas build:configure` — creates `eas.json` in the project root with default `development`, `preview`, and `production` build profiles. If `android.package` or `ios.bundleIdentifier` aren't set yet, it prompts you for them (Android application ID / iOS App Store identifier respectively). [expo](https://docs.expo.dev/build-reference/build-configuration/) (Note: this bundle-ID prompt is the point where the "changing the bundle ID later strands existing installs" concern from your canvas becomes locked in — get `live.frapp.mobile` vs a Signet identifier decided *before* this step if it matters.)

**Recommended `eas.json` profile shape** (matches current defaults): `development` → `{ "developmentClient": true, "distribution": "internal" }`; `preview` → `{ "distribution": "internal" }`; `production` → `{ "autoIncrement": true }` plus a `submit.production: {}` block. [expo](https://docs.expo.dev/tutorial/eas/configure-development-build/) Development and preview builds are never submitted to a store; production builds are store-only (they can't be installed directly on a simulator/device). [expo](https://docs.expo.dev/build/eas-json/)

**Apple IDs required for `eas submit` (iOS)**, all set under `submit.production.ios` in `eas.json`, with where to find each:

| Field | What it is | Where to find it |
|---|---|---|
| `appleId` | Your Apple login email/username [expo](https://docs.expo.dev/eas/json/) | Your Apple account settings; can also set `EXPO_APPLE_ID` env var |
| `appleTeamId` | Your Apple Developer Team ID (10 uppercase chars/digits) [expo](https://docs.expo.dev/eas/json/) | Apple Developer Portal → Membership details [github](https://github.com/expo/fyi/blob/main/apple-team.md) |
| `ascAppId` | App Store Connect app's numeric Apple ID (10 digits; skips app-creation step) [expo](https://docs.expo.dev/eas/json/) | App Store Connect → Apps → your app → General → App Information → "Apple ID" [expo](https://docs.expo.dev/submit/ios/) |
| `ascApiKeyId` / `ascApiKeyIssuerId` / `ascApiKeyPath` | App Store Connect API key credentials (Key ID, Issuer ID, `.p8` file) [expo](https://docs.expo.dev/eas/json/) | App Store Connect → Users and Access → Integrations/Keys; download the `.p8`, copy Key ID and Issuer ID [github](https://github.com/expo/fyi/blob/main/creating-asc-api-key.md) |

Critical naming trap: **"Apple ID" in the `ascAppId` context is NOT your account username** — it's the numeric App ID of the app itself. [github](https://github.com/expo/fyi/blob/main/asc-app-id.md) EAS validates these formats strictly: `ascAppId` digits-only, `appleTeamId` 10 uppercase letters/digits, `appleId` a valid email. [github](https://github.com/expo/eas-cli/issues/2232)

**Is the $99 Apple Developer Program a hard prerequisite?** No, not for setup or all builds — only for device/store work:
- `eas init` and `eas build:configure` are config-only and don't require Apple membership. [expo](https://docs.expo.dev/tutorial/eas/configure-development-build/)
- **iOS Simulator builds** run "without needing an Apple Developer account." [expo](https://docs.expo.dev/build-reference/simulators/)
- **iOS builds on real devices, internal (ad hoc) distribution, and App Store submission all require** the paid Apple Developer Program ($99/yr). [expo](https://docs.expo.dev/submit/ios/) [expo](https://docs.expo.dev/tutorial/eas/internal-distribution-builds/)
- Google Play parallels: you can build/sign Android without membership, but uploading to the Play Store requires the $25 one-time Google Play Developer account. [expo](https://docs.expo.dev/build/setup/)

**Environment variables:** use `eas env:set --name EXPO_PUBLIC_API_URL --value ... --environment production --visibility plaintext`, scoped per environment (`development`/`preview`/`production`), then reference them via `build.<profile>.environment` in `eas.json` for builds and `eas update --environment <env>` for OTA updates. [expo](https://docs.expo.dev/eas/environment-variables/) **Security caveat:** anything prefixed `EXPO_PUBLIC_` is inlined at build time and visible to any app user — never put secrets (like your Stripe secret key) behind that prefix. [expo](https://docs.expo.dev/eas/environment-variables/usage/) Recent change to flag: **SDK 55+ requires the `--environment` flag on `eas update`.** [expo](https://docs.expo.dev/eas/environment-variables/usage/)

**Most common mistake:** the "`extra.eas.projectId` field is missing" build failure — often because `app.json` was accidentally in `.gitignore` or untracked, so the ID `eas init` wrote never reached CI. ^[github](https://github.com/expo/eas-cli/issues/2084 "The \"extra.eas.projectId\" field is missing from your app config ...") ^[stackoverflow](https://stackoverflow.com/questions/76943134/error-the-extra-eas-projectid-field-is-missing-from-your-app-config "react native - Error: The \"extra.eas.projectId\" field is missing ...") Confirm `app.json` is committed after `eas init`.

---

## 5. PostHog across Next.js + NestJS + Expo

**SDKs are per-platform** — three of them:
- **Next.js web:** `posthog-js`, now initialized via `instrumentation-client.ts` (Next.js 15.3+, works for both App and Pages routers) — this is the current recommended pattern, replacing older provider-only setups. [posthog](https://posthog.com/docs/libraries/next-js?tab=Pages+router) Client env vars must be prefixed `NEXT_PUBLIC_` (`NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`, `NEXT_PUBLIC_POSTHOG_HOST`). For SPA navigation, use `defaults` with `capture_pageview: 'history_change'` or you'll miss client-side route changes. [posthog](https://posthog.com/tutorials/single-page-app-pageviews)
- **NestJS API:** `posthog-node`, `new PostHog('<project_token>', { host: 'https://us.i.posthog.com' })`. [posthog](https://posthog.com/docs/libraries/node)
- **Expo mobile:** `posthog-react-native` with `PostHogProvider` in your root component. [posthog](https://posthog.com/docs/libraries/react-native)

**API keys:** the **Project API key** (`phc_...`, aka project token) is **public and client-safe** — it goes in the browser, the mobile app, *and* is what `posthog-node` uses. [posthog](https://posthog.com/docs/feature-flags/installation) [posthog](https://posthog.com/docs/libraries/node) The **Personal API key** is private, for server-side admin/private endpoints, and must never touch the frontend; `posthog-node` only needs it optionally for local feature-flag evaluation. [posthog](https://posthog.com/docs/api/personal-api-keys) Set `host` to `us.i.posthog.com` or `eu.i.posthog.com` consistently across all three. [posthog](https://posthog.com/docs/libraries/react-native)

**Separating dev/staging/prod without mixing data — PostHog's own recommendation is separate PROJECTS, not one project with filters.** The official guidance: "The best practice for using PostHog across multiple environments is to use multiple projects," and for most companies PostHog recommends **three projects: Local Development, Staging, Production**, each with its own project token. [posthog](https://posthog.com/tutorials/multiple-environments) [posthog](https://posthog.com/docs/settings/projects) (PostHog has an "environments" API concept, but no official doc found recommends it *over* separate projects for analytics separation — so separate projects is the safe call.) The mechanism to get this right: **set a distinct `POSTHOG_API_KEY` / project token per environment** in Vercel (per-environment env vars, or via the PostHog Vercel Marketplace integration which maps projects to Vercel environments), Render, and EAS. [posthog](https://posthog.com/docs/integrations/vercel-marketplace) The pollution happens precisely when you reuse one token across environments — dev/staging events then combine with production. [posthog](https://posthog.com/tutorials/multiple-environments)

**Verify it works:** load a page (or trigger a mobile event), then open **Activity → Live events** in the relevant PostHog project to confirm events arrive in real time. [posthog](https://posthog.com/docs/health-checks/no-live-events)

**Most common mistakes (and a Render/Vercel-specific serverless one):**
- **Serverless event loss on the NestJS/Render side and any Vercel functions:** short-lived runtimes terminate before queued events flush. Set `flushAt: 1`, `flushInterval: 0`, use `captureImmediate` instead of `capture`, and always `await posthog.shutdown()`. [posthog](https://posthog.com/docs/libraries/node)
- **CSP blocking web events silently:** if you run a Content-Security-Policy, allow `*.posthog.com` in `script-src` and `connect-src` or capture fails silently. [posthog](https://posthog.com/docs/libraries/next-js?tab=Pages+router)
- The single biggest data-integrity mistake: reusing one project token across environments (dev data pollutes prod). [posthog](https://posthog.com/tutorials/multiple-environments)

---

## 6. Sentry across NestJS/Render + Next.js/Vercel + Expo

**DSN structure:** each Sentry project has its own unique DSN, so create **separate projects** for your API, web, and mobile, each with its own DSN. [sentry](https://docs.sentry.io/concepts/key-terms/dsn-explainer/) The DSN is safe to expose — it only allows submitting new events, not reading anything. [sentry](https://docs.sentry.io/concepts/key-terms/dsn-explainer/) Place it as `SENTRY_DSN` for the NestJS API (Render env var), `NEXT_PUBLIC_SENTRY_DSN` for Next.js browser code (needs the `NEXT_PUBLIC_` prefix to reach the bundle), and as an EAS env var / `SENTRY_DSN` for Expo. [sentry](https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/pages-router/) [sentry](https://docs.sentry.io/platforms/react-native/manual-setup/expo/eas-build-hooks) **If the DSN is unset or empty, the SDK sends nothing** — this is the #1 cause of "configured but nothing shows up." [sentry](https://docs.sentry.io/platforms/javascript/guides/nestjs/configuration/options/)

**NestJS on Render — the import-order gotcha is everything.** Create `instrument.ts` at the project root with `Sentry.init({ dsn, environment: 'staging' })`, and **import it before any other module.** The docs are explicit: in `main.ts`, `import "./instrument";` must be the *first* line, before `NestFactory` and `AppModule`. [sentry](https://docs.sentry.io/platforms/javascript/guides/nestjs/) Add `SentryModule.forRoot()` to `AppModule` imports, and if you don't have a custom global catch-all filter, register `SentryGlobalFilter` as an `APP_FILTER` **before any other exception filters.** [sentry](https://docs.sentry.io/platforms/javascript/guides/nestjs/)

The **Render-relevant deployment gotcha most likely to cause your "staging errors don't show up":** if your app runs in ESM mode, a plain `import "./instrument"` won't reliably load Sentry before the app starts — you must load it via Node's `--import` flag in your start command: `"start": "--import ./instrument.mjs nest start"` (or `NODE_OPTIONS="--import ./instrument.mjs"`). [sentry](https://docs.sentry.io/platforms/javascript/guides/nestjs/install/esm/) Check whether your Render start command needs this. Also note **NestJS `HttpException`s are not captured by default** (they're treated as control flow), so a route throwing a 400/404 won't appear — test with a real unhandled error. [sentry](https://docs.sentry.io/platforms/javascript/guides/nestjs/)

**Environment tagging separates staging from prod:** set the `environment` option (case-sensitive); Sentry auto-creates the environment on the first event it receives with that value. [sentry](https://docs.sentry.io/platforms/javascript/configuration/options/#environment) This is how you keep Render-staging errors from mixing with prod in the dashboard.

**Source maps are NOT required for errors to appear** — this is a common misconception. Sentry states source maps are for "readable stack traces"; errors are captured and delivered without them, they'll just show minified traces. [sentry](https://docs.sentry.io/platforms/javascript/sourcemaps/) So if nothing is showing up, source maps are not your problem — check the DSN and import order first. For Next.js on Vercel, the wizard sets up source-map upload via a `SENTRY_AUTH_TOKEN` (in `.env.sentry-build-plugin`, and you must set it in CI); source maps only generate on production builds, so building in dev mode is a common CI mistake. [sentry](https://docs.sentry.io/platforms/javascript/guides/nextjs/)

**Fastest end-to-end validation, per platform:**
- **NestJS/Render:** add `@Get("/debug-sentry") getError() { throw new Error("My first Sentry error!"); }`, hit that route on your deployed staging URL, then check Sentry Issues. [sentry](https://docs.sentry.io/platforms/javascript/guides/nestjs/)
- **Next.js/Vercel:** the wizard creates `/sentry-example-page` with a "Throw Sample Error" button. [sentry](https://docs.sentry.io/platforms/javascript/guides/nextjs/)
- **Expo:** build a Release and press a button calling `Sentry.captureException(new Error("First error"))`. [sentry](https://docs.sentry.io/platforms/react-native/manual-setup/expo/)

**Most common mistake:** for your NestJS-on-Render staging specifically, it's almost always one of three things in this order — (1) `SENTRY_DSN` not actually set in the Render dashboard for that service, (2) `instrument.ts` not loaded before app bootstrap (missing `--import` in ESM), or (3) testing with an `HttpException` that Sentry deliberately ignores. Fix the DSN and import order, then hit `/debug-sentry`.

---

## Where more research would most change these conclusions

Two items rest on documented inference rather than an explicit doc statement and are worth a 5-minute live confirmation before you write final docs: **(1)** the exact production failure when the auth-hook toggle is enabled before the function exists — the error-propagation mechanism is documented but the specific "missing function" case isn't spelled out, so confirm by testing on a throwaway project; and **(2)** whether *your* Render start command runs the NestJS API in ESM or CommonJS mode, which determines whether the `--import ./instrument` flag is mandatory for Sentry to capture anything — a two-minute check of your build output that resolves the most likely "nothing shows up" cause. Everything else in this runbook is sourced directly from current official documentation and can be written up as-is.