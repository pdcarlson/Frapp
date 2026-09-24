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

> **Not usable today (2026-09-21).** The EAS `preview` environment holds only
> `SENTRY_AUTH_TOKEN` ([#2415](https://github.com/pdcarlson/Frapp/issues/2415), owner's
> `env:list` 2026-09-18), so a `preview` build has no `EXPO_PUBLIC_SUPABASE_URL` /
> `_ANON_KEY` and `getSupabaseClient()` returns `null` — it installs and then reports
> sign-in unavailable. Nothing fails at build time: outside `production`, the key fences
> in `apps/mobile/app.config.js` check a value only when one is set. Run
> § 6.3 for `preview` first, or you will pay for a build you cannot sign into.

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
# Once per environment, on the EAS project app.json already links (never a new `eas init`).
# Values are public by design (the anon key and the
# publishable key ship inside the binary) — `--visibility plaintext` is the honest setting;
# `sensitive` only hides them in the dashboard.
cd apps/mobile
for ENV in preview production; do
  eas env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref for this env>.supabase.co"
  # The project's PUBLISHABLE key (`sb_publishable_…`), not the legacy JWT anon key:
  # a production build refuses anything else (#2526), and every EAS build refuses a
  # value that isn't a client key. Name kept for history; see ENV_REFERENCE.md
  # § apps/mobile (Expo — EAS).
  eas env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<sb_publishable_… key for this env>"
  # STOP before the production limb of this one. The App Store listing
  # (`apps/mobile/store/README.md` § Identity and § Review notes) tells Apple the app
  # takes no payment of any kind, and that is only true while `production` holds no
  # Stripe key — the beta chapter is not collecting dues by card (decided 2026-09-21).
  # Setting it here switches card payments on with no repo change and nothing in CI
  # able to notice, falsifying the Price row, the App Review note and the
  # Financial Info → Payment Info privacy answer. `pk_test_…` in `preview` is fine.
  # See #2415 before running the production limb.
  eas env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value "<pk_test_… for preview, pk_live_… for production>"
  eas env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SENTRY_DSN --value "<frapp-mobile DSN>"
  eas env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_POSTHOG_KEY --value "<write-only phc_ project token>"
done
```

Optional: `EXPO_PUBLIC_POSTHOG_HOST` (defaults to `https://us.i.posthog.com` in `lib/posthog/config.ts`). Neither PostHog name is Infisical-synced — EAS dashboard only, like the DSN.

The refs are in [`.github/environments.json`](../../../../.github/environments.json); the publishable
keys come from each project's dashboard → Project Settings → API Keys (or `GET /v1/projects/<ref>/api-keys`).
Why production refuses the legacy anon key: [`ENV_REFERENCE.md` § apps/mobile (Expo — EAS)](../../environment/ENV_REFERENCE.md#appsmobile-expo--eas).
`development` needs nothing here — a development build talks to the local stack through
`apps/mobile/.env.local`, and `getSupabaseClient()` returns `null` with a visible sign-in notice
when the pair is missing rather than crashing ([`ENV_REFERENCE.md` § apps/mobile (Expo — EAS)](../../environment/ENV_REFERENCE.md#appsmobile-expo--eas)).

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

### 6.4 App Store screenshots

App Store Connect will not take a submission without at least one iPhone screenshot set
([#2454](https://github.com/pdcarlson/Frapp/issues/2454)). The owner approved **renders of the app
on Expo web** as that set (2026-09-22): the real screens and components (react-native-web) against
the local demo chapter, with no EAS build, device or `preview` environment involved. What differs
from a device capture is chrome, not content: there is no iOS status bar, and native-only surfaces
(sheets, the system keyboard) are web-rendered, which is why the set below has neither.

**Size: 1320 × 2868 pixels, portrait** — a 440 × 956 point viewport at 3x. Apple's
[screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications)
(read 2026-09-22) list it among the accepted 6.9" iPhone sizes, alongside 1290 × 2796 and
1260 × 2736, and require a 6.5" set only when no 6.9" set is provided; smaller iPhone sizes are
scaled from the larger set. `app.json` sets `ios.supportsTablet: false`, so no iPad set applies.
**Not yet confirmed in the console:** #2454 asks for the sizes App Store Connect states at upload to
be recorded here, so replace this paragraph's source with the console's wording once uploaded.

The set is seven screens, chosen to match what the listing's Description claims
([`apps/mobile/store/README.md`](../../../../apps/mobile/store/README.md) § Description): Chat
home, a chat thread, Events, Host check-in (the rotating QR), Tasks (assigned tasks, points and
house rank), Study hours and the Directory. The list is `STORE_SCREENS` in
[`scripts/demo/capture-mobile.mjs`](../../../../scripts/demo/capture-mobile.mjs). **No Ask shot:**
the store binary has no Ask ([#2259](https://github.com/pdcarlson/Frapp/issues/2259)), and
Guideline 2.3.3 wants the screenshots to show the app as it ships. **No Dues shot:** a populated
ledger shows "Payments run through your chapter's Stripe account.", and the reviewer's own Dues tab
is seeded empty so App Review never sees that footer or a Pay control (the store README's § Seed the
reviewer's chapter). The listing's text still names dues and payment history; the shots keep out the
in-app payment copy.

**Procedure**, on a machine or cloud sandbox with the local stack running (API on `:3001`, local
Supabase):

1. Write `apps/mobile/.env.local` per
   [`docs/guides/demo-data.md` § Mobile setup](../../../guides/demo-data.md#mobile-setup), **without**
   `EXPO_PUBLIC_ASK_ENABLED`. With it set the app draws the ✦ Ask pill, and the preset stops
   rather than write a set containing it. The same section's `EVENT_CHECK_IN_TOKEN_SECRET` must be
   in `apps/api/.env.local` before the API starts (the cloud sandbox's bring-up does not write
   it): without it the Host check-in screen shows "Code unavailable" instead of a QR, and that
   shot times out.
2. Re-seed, so every unread badge and the demo data are fresh (opening a channel marks it read):
   `bash scripts/demo/setup-demo.sh`
3. From `apps/mobile`, start Expo web on the port the API's CORS list allows, clearing Metro's
   cache so no earlier flag value is inlined: `npx expo start --web --port 3002 --clear`. Wait for
   `http://localhost:3002` to answer 200.
4. From the repo root: `node scripts/demo/capture-mobile.mjs --app-store`
   (sandbox Chromium: prefix `CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`).
   It signs in as the demo president — Host check-in needs an officer — and writes
   `screenshots/app-store/01-chat-home.png` … `07-directory.png`.

It prints each file's measured size, and exits non-zero if a screen lands on a route other than the
one requested (a lost session redirects to sign-in), if a screen's data never arrives, or if a file
is not 1320 × 2868 — re-run rather than upload a set with a gap. If any Ask surface is on screen it
stops at once and deletes `screenshots/app-store/`, so there is nothing to upload by mistake.

**Upload is the owner's step:** App Store Connect → the app → the version → iPhone 6.9" Display →
drag in the files in order, for the English (U.S.) localization. `screenshots/` is gitignored and
the PNGs are not committed; regenerate them with the procedure above rather than keeping copies.

---
