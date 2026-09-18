## 6. Mobile (EAS) Setup

> **Install `eas-cli` first.** It is **not** a dependency of this repo, so `npx eas …` resolves
> nothing — npm reports "could not determine executable to run", because no npm package named
> `eas` provides that binary. Every `eas` command in this section assumes a global install:
>
> ```bash
> npm install -g eas-cli
> ```
>
> Use **>= 21.1.0**: `eas env:set` (§ 6.3) first ships there — `21.0.0` has only the deprecated
> `env:create` / `env:update`, verified from each release's `oclif.manifest.json`. The
> `"cli": { "version": ">= 15.0.0" }` floor in `apps/mobile/eas.json` is a *different*
> constraint (what EAS Build accepts) and is not sufficient for the commands here.
> `npx eas-cli@latest <command>` works too, at the cost of re-resolving the package each run.

### 6.1 Initial Setup

```bash
cd apps/mobile

# Login to Expo
eas login

# Inspect the linked EAS project
eas project:info
```

The committed [`apps/mobile/app.json`](../../../../apps/mobile/app.json) links
the app to EAS through `extra.eas.projectId` and `owner: pdcarlson`. Keep these
real project identifiers committed; do not replace them with placeholders or
run `eas init` to create a new project for routine setup.

This linkage satisfies the project-id check in `isPushAvailable()`; an installed
build must also load the native notifications module. It does not prove push
credentials, environment variables, or delivery are configured or verified.
Verify remote push on an installed build with the required platform credentials
and notification permission. Expo Go remains unsupported. Android
`GOOGLE_SERVICES_JSON` configuration remains a separate follow-up.

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
eas build --profile development --platform ios
# or --platform android
# Install the resulting build on your device
```

**Option C: Preview build (share with testers)**

```bash
eas build --profile preview --platform all
# Generates installable links for iOS (ad-hoc) and Android (APK)
```

### 6.3 Environment Configuration

`eas.json` carries the values that are the same for everyone and safe in git (`EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_SENTRY_ENVIRONMENT`) per build profile, and since 2026-09-06 **binds each profile to
the EAS environment of the same name** (`"environment": "development" | "preview" | "production"`).
Everything else the bundle inlines is an **EAS environment variable**, created once per EAS
environment so a `preview` build gets the *staging* Supabase project and a `production` build the
*production* one:

`eas env:set` is create-or-update, so re-running these is idempotent. It replaced `env:create`
in eas-cli 21.1.0 (see the install note at the top of § 6).

```bash
# Once, after `eas init`, per environment. Values are public by design (the anon key and the
# publishable key ship inside the binary) — `--visibility plaintext` is the honest setting;
# `sensitive` only hides them in the dashboard.
cd apps/mobile
for ENV in preview production; do
  eas env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref for this env>.supabase.co"
  eas env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key for this env>"
  eas env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value "<pk_test_… for preview, pk_live_… for production>"
  eas env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SENTRY_DSN --value "<frapp-mobile DSN>"
  eas env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_POSTHOG_KEY --value "<write-only phc_ project token>"
done
```

Optional: `EXPO_PUBLIC_POSTHOG_HOST` (defaults to `https://us.i.posthog.com` in `lib/posthog/config.ts`). Neither PostHog name is Infisical-synced — EAS dashboard only, like the DSN.

The refs are in [`.github/environments.json`](../../../../.github/environments.json); the anon keys
come from each project's dashboard → Settings → API (or `GET /v1/projects/<ref>/api-keys`).
`development` needs nothing here — a development build talks to the local stack through
`apps/mobile/.env.local`, and `getSupabaseClient()` returns `null` with a visible sign-in notice
when the pair is missing rather than crashing (`ENV_REFERENCE.md` § Mobile).

**`SENTRY_AUTH_TOKEN` is the one variable here that is not `EXPO_PUBLIC_*`, and the one whose
absence fails the build rather than degrading.** Everything above is inlined into the bundle and
public by design; this one is build-time only, never bundled, and is the same org-auth-token class
as the API's (`org:frapp-live` releases:write). `@sentry/react-native` uploads source maps and
native debug files from the build itself, and **a Release build with no token fails** — on iOS in
the Xcode phases, on Android in the Gradle upload task. Mechanism, failure signatures and the
`SENTRY_DISABLE_AUTO_UPLOAD` / `SENTRY_ALLOW_FAILURE` escape hatches (and why neither is the
remedy) are in
[`ENV_REFERENCE.md` § apps/mobile](../../environment/ENV_REFERENCE.md#appsmobile-expo--eas) — that
row is the canonical account; this section only creates the variable.

```bash
cd apps/mobile
# Sentry -> Settings -> Auth Tokens, at the ORGANIZATION level (frapp-live), not a personal token.
for ENV in preview production; do
  eas env:set --environment $ENV --scope project --visibility secret \
    --name SENTRY_AUTH_TOKEN --value "<token>"
done
```

`--visibility secret`, not the `plaintext` above: those values ship inside the binary anyway, this
one must not be readable back. `preview` and `production` because the upload is skipped whenever the
compiled Xcode configuration or Gradle variant name contains `debug` — that is keyed on the
configuration, **not** on the profile name, so a `development` profile given an explicit Release
`buildConfiguration` would need the token too.

> **Why not `eas secret:create --scope project`, which this section used to say.** A project-scoped
> secret has one value for every profile, so preview and production builds would have pointed at
> the *same* Supabase project — whichever was set last. `eas secret:*` is also deprecated in favour of
> `eas env:*`, which is where the per-environment split lives.

---
