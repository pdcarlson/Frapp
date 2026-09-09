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

`eas.json` carries the values that are the same for everyone and safe in git (`EXPO_PUBLIC_API_URL`,
`EXPO_PUBLIC_SENTRY_ENVIRONMENT`) per build profile, and since 2026-09-06 **binds each profile to
the EAS environment of the same name** (`"environment": "development" | "preview" | "production"`).
Everything else the bundle inlines is an **EAS environment variable**, created once per EAS
environment so a `preview` build gets the *staging* Supabase project and a `production` build the
*production* one:

```bash
# Once, after `eas init`, per environment. Values are public by design (the anon key and the
# publishable key ship inside the binary) — `--visibility plaintext` is the honest setting;
# `sensitive` only hides them in the dashboard.
cd apps/mobile
for ENV in preview production; do
  npx eas env:create --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref for this env>.supabase.co"
  npx eas env:create --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key for this env>"
  npx eas env:create --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value "<pk_test_… for preview, pk_live_… for production>"
  npx eas env:create --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SENTRY_DSN --value "<frapp-mobile DSN>"
done
```

The refs are in [`.github/environments.json`](../../../../.github/environments.json); the anon keys
come from each project's dashboard → Settings → API (or `GET /v1/projects/<ref>/api-keys`).
`development` needs nothing here — a development build talks to the local stack through
`apps/mobile/.env.local`, and `getSupabaseClient()` returns `null` with a visible sign-in notice
when the pair is missing rather than crashing (`ENV_REFERENCE.md` § Mobile).

> **Why not `eas secret:create --scope project`, which this section used to say.** A project-scoped
> secret has one value for every profile, so preview and production builds would have pointed at
> the *same* Supabase project — whichever was set last. `eas secret:*` is also deprecated in favour of
> `eas env:*`, which is where the per-environment split lives.

---
