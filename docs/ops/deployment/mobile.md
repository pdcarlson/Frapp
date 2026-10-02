## 6. Mobile (EAS) Setup

> **Run `eas` as `npm run eas -- <command>`, from the repo root.** eas-cli is pinned to the
> version CI's store build installs (`.github/workflows/_mobile-build.yml`, step "Install EAS CLI"),
> and [`scripts/eas.mjs`](../../../scripts/eas.mjs) installs that version into the gitignored
> `.cache/eas-cli/` on first use (about 10 seconds), with CI's flags, then runs it in `apps/mobile`,
> where `app.json` and `eas.json` are. Nothing needs installing globally, and it works the same from
> Windows Git Bash, PowerShell or cmd. Inside a workspace (`apps/mobile`, or any other `apps/*` or
> `packages/*` directory) npm reads that workspace's own `package.json` and answers
> `Missing script: "eas"`, so run it from the root. Add `-s` (`npm run -s eas -- …`) when you parse
> the output, so npm's own `> node scripts/eas.mjs` banner stays off stdout. To move the version,
> change CI's install line; this follows it.
>
> **Never put a secret on an `npm run` command line.** npm prints every argument in that banner
> and keeps them in its debug log (`~/.npm/_logs/`, the last ten runs), `-s` or not. Leave
> `--value` off and eas asks for the value at a hidden prompt (§ 6.3's `SENTRY_AUTH_TOKEN`), or run
> `node scripts/eas.mjs <command>` from the root, which doesn't go through npm.
>
> A global `npm install -g eas-cli` still works as a fallback, at whatever version you get, which may
> not take the flags written here. `eas env:set` (§ 6.3) needs **>= 21.1.0** (`21.0.0` has only the
> deprecated `env:create` / `env:update`, verified from each release's `oclif.manifest.json`). The
> `"cli": { "version": ">= 15.0.0" }` floor in `apps/mobile/eas.json` is a *different* constraint
> (what EAS Build accepts).

### 6.1 Initial Setup

```bash
# From the repo root. Login to Expo
npm run eas -- login

# Inspect the linked EAS project
npm run eas -- project:info
```

The committed [`apps/mobile/app.json`](../../../apps/mobile/app.json) links
the app to EAS through `extra.eas.projectId` and `owner: pdcarlson`. Keep these
real project identifiers committed; do not replace them with placeholders or
run `eas init` to create a new project, ever: the project is permanent from the
first store build
([`spec/environments/README.md` § Mobile (EAS)](../../../spec/environments/README.md#mobile-eas)).

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
# From the repo root (Option A leaves you in apps/mobile: `cd ../..` first)
npm run eas -- build --profile development --platform ios
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
# From the repo root. One platform per command: `--platform all` starts Android, then stops on an iOS
# failure and leaves the Android build running unreported (§ 6.6).
npm run eas -- build --profile preview --platform ios
npm run eas -- build --profile preview --platform android
# Each prints an installable link: iOS (ad-hoc) and Android (APK)
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
# Values are public by design (the anon key and the publishable key ship inside the
# binary) — `--visibility plaintext` is the honest setting;
# `sensitive` only hides them in the dashboard. From the repo root:
for ENV in preview production; do
  npm run eas -- env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SUPABASE_URL --value "https://<ref for this env>.supabase.co"
  # The project's PUBLISHABLE key (`sb_publishable_…`), not the legacy JWT anon key:
  # a production build refuses anything else (#2526), and every EAS build refuses a
  # value that isn't a client key. Name kept for history; see ENV_REFERENCE.md
  # § apps/mobile (Expo — EAS).
  npm run eas -- env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<sb_publishable_… key for this env>"
  # STOP before the production limb of this one. The App Store listing
  # (`apps/mobile/store/README.md` § Identity and § Review notes) tells Apple the app
  # takes no payment of any kind, and that is only true while `production` holds no
  # Stripe key — the beta chapter is not collecting dues by card (decided 2026-09-21).
  # Setting it here switches card payments on with no repo change and nothing in CI
  # able to notice, falsifying the Price row, the App Review note and the
  # Financial Info → Payment Info privacy answer. `pk_test_…` in `preview` is fine.
  # See #2415 before running the production limb.
  npm run eas -- env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY --value "<pk_test_… for preview, pk_live_… for production>"
  npm run eas -- env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_SENTRY_DSN --value "<frapp-mobile DSN>"
  npm run eas -- env:set --environment $ENV --scope project --visibility plaintext \
    --name EXPO_PUBLIC_POSTHOG_KEY --value "<write-only phc_ project token>"
done
```

Optional: `EXPO_PUBLIC_POSTHOG_HOST` (defaults to `https://us.i.posthog.com` in `lib/posthog/config.ts`). Neither PostHog name is Infisical-synced — EAS dashboard only, like the DSN.

The refs are in [`.github/environments.json`](../../../.github/environments.json); the publishable
keys come from each project's dashboard → Project Settings → API Keys (or `GET /v1/projects/<ref>/api-keys`).
Why production refuses the legacy anon key: [`ENV_REFERENCE.md` § apps/mobile (Expo — EAS)](../../internal/environment/ENV_REFERENCE.md#appsmobile-expo--eas).
`development` needs nothing here — a development build talks to the local stack through
`apps/mobile/.env.local`, and `getSupabaseClient()` returns `null` with a visible sign-in notice
when the pair is missing rather than crashing ([`ENV_REFERENCE.md` § apps/mobile (Expo — EAS)](../../internal/environment/ENV_REFERENCE.md#appsmobile-expo--eas)).

**`SENTRY_AUTH_TOKEN` is the one variable here that is not `EXPO_PUBLIC_*`, and the one whose
absence fails the build rather than degrading.** Everything above is inlined into the bundle and
public by design; this one is build-time only, never bundled, and is the same org-auth-token class
as the API's (`org:frapp-live` releases:write). `@sentry/react-native` uploads source maps and
native debug files from the build itself, and **a Release build with no token fails** — on iOS in
the Xcode phases, on Android in the Gradle upload task. Mechanism, failure signatures and the
`SENTRY_DISABLE_AUTO_UPLOAD` / `SENTRY_ALLOW_FAILURE` escape hatches (and why neither is the
remedy) are in
[`ENV_REFERENCE.md` § apps/mobile](../../internal/environment/ENV_REFERENCE.md#appsmobile-expo--eas) — that
row is the canonical account; this section only creates the variable.

```bash
# From the repo root. Sentry -> Settings -> Auth Tokens, at the ORGANIZATION level (frapp-live), not a personal token.
# No --value: eas asks for the token at a hidden prompt, once per environment. On the command
# line npm would print it and log it (the note at the top of § 6).
for ENV in preview production; do
  npm run eas -- env:set --environment $ENV --scope project --visibility secret --type string \
    --name SENTRY_AUTH_TOKEN
done
```

`--visibility secret`, not the `plaintext` above: those values ship inside the binary anyway, this
one must not be readable back. With no `--value`, eas-cli 24.8.0 prompts for it as a password
field whenever the visibility isn't `plaintext`, and `--type string` skips its question about a
file (read from its `env:set` source, `resolveVariableDetailsAsync`). `preview` and `production` because the upload is skipped whenever the
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
([`apps/mobile/store/README.md`](../../../apps/mobile/store/README.md) § Description): Chat
home, a chat thread, Events, Host check-in (the rotating QR), Tasks (assigned tasks, points and
house rank), Study hours and the Directory. The list is `STORE_SCREENS` in
[`scripts/demo/capture-mobile.mjs`](../../../scripts/demo/capture-mobile.mjs). **No Ask shot:**
the store binary has no Ask ([#2259](https://github.com/pdcarlson/Frapp/issues/2259)), and
Guideline 2.3.3 wants the screenshots to show the app as it ships. **No Dues shot:** a populated
ledger shows "Payments run through your chapter's Stripe account.", and the reviewer's own Dues tab
is seeded empty so App Review never sees that footer or a Pay control (the store README's § Seed the
reviewer's chapter). The listing's text still names dues and payment history; the shots keep out the
in-app payment copy.

**Procedure**, on a machine or cloud sandbox with the local stack running (API on `:3001`, local
Supabase):

1. Write `apps/mobile/.env.local` per
   [`docs/guides/demo-data.md` § Mobile setup](../../guides/demo-data.md#mobile-setup), **without**
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
is not 1320 × 2868, and then deletes `screenshots/app-store/` so there is no set with a gap to upload;
re-run it. If any Ask surface is on screen it stops at once, with the same deletion.

**Upload is the owner's step:** App Store Connect → the app → the version → iPhone 6.9" Display →
drag in the files in order, for the English (U.S.) localization. `screenshots/` is gitignored and
the PNGs are not committed; regenerate them with the procedure above rather than keeping copies.

### 6.5 Google Play screenshots

Play can't reuse the App Store set: 1320 × 2868 is about 2.17:1, and Play caps a screenshot's long
side at twice its short side ([#2557](https://github.com/pdcarlson/Frapp/issues/2557)). The Play set
is the same seven screens, rendered the same way, at Play's shape.

**Size: 1242 × 2208 pixels, portrait (9:16)**, a 414 × 736 point viewport at 3x. Play Console Help
("Add preview assets to showcase your app") takes JPEG or 24-bit PNG with no alpha, 320 to 3840 px
per side, the long side at most twice the short one, and 2 to 8 phone screenshots. For promotion it
prefers 9:16 with at least 1080 px on each side, which this size also meets. **Not read from the
page itself:** support.google.com is blocked from the cloud sandbox, so these rules come from search
snippets of that page (2026-09-27). Replace this paragraph's source with the console's wording once
the set is uploaded ([#2720](https://github.com/pdcarlson/Frapp/issues/2720)). The limits are held
in [`scripts/demo/store-screenshots.mjs`](../../../scripts/demo/store-screenshots.mjs) and
tested against the preset, so change them there too.

**Procedure:** § 6.4's steps 1 to 3 unchanged, then from the repo root
`node scripts/demo/capture-mobile.mjs --google-play` (same `CHROMIUM_PATH` prefix in the sandbox). It
writes `screenshots/google-play/01-chat-home.png` … `07-directory.png`, with the same Ask refusal and
landed-route checks as the App Store run. It also fails if a file isn't 1242 × 2208 or isn't an
opaque 8-bit RGB PNG (colour type 2, no `tRNS` chunk), because Play rejects a PNG with alpha. Any
failure deletes `screenshots/google-play/`, so a failed run leaves nothing to upload.

**Upload is the owner's step:** Play Console → the app → Main store listing → Phone screenshots →
the files in order, for the default language. The upload needs the developer account (#2556).

### 6.6 Store submission

Two paths put a production build on the stores: **Deploy production** does it on request (CI,
below), and a maintainer can still do it from a terminal (by hand, further below). Both **upload
without releasing**. iOS lands on TestFlight and Android on the Play `internal` track
(`submit.production.android.track` in `apps/mobile/eas.json`). Submitting for App Review and
promoting a Play track stay a human's clicks in the consoles.

**Which commit.** Build a store binary from the commit production serves, which is the latest `v*`
tag (`git tag --list 'v*' --sort=-version:refname | head -n1`), and never from `main`'s tip. That
tag must be a plain `vX.Y.Z`; if anything else is on top (a hand-pushed `v1.10.0-rc1`, say), stop:
nothing says what production serves until it's resolved. The rule is `release.yml`'s, and
[`scripts/ci/lib/release-tag.mjs`](../../../scripts/ci/lib/release-tag.mjs) is its one home. A
binary newer than production calls routes production doesn't serve yet (#2526); that is why the
`v0.7.0` ship had to come before the 0.9.0 binary. The CI path checks that its commit is still the
latest `v*` tag before it builds and again before it uploads, and stops otherwise, a re-run
included. The manual path keeps the rule by hand.

**Record every upload.** Each build uploaded to TestFlight or a Play track gets a
`shipped-builds.json` entry before any tester installs it, because that list arms the required
`api-contract-check` gate. The CI path opens that PR itself. By hand, it's
[`apps/mobile/store/README.md` § Shipped builds and the API contract](../../../apps/mobile/store/README.md#shipped-builds-and-the-api-contract).

**Version and build number.** `expo.version` in `apps/mobile/app.json` is still a manual bump
before any build with native changes
([`spec/environments/README.md` § Mobile (EAS)](../../../spec/environments/README.md#mobile-eas),
**Native changes**). Neither path bumps it. The build number is EAS's: `appVersionSource: remote`
with `autoIncrement` gives every production build the next one. When a store refuses an upload
(a version it no longer takes, say), the upload step fails with the store's message.

#### From Deploy production (CI)

Dispatch **Deploy production** as usual and set **`mobile_build`** to `ios`, `android` or `all`.
The default, `none`, builds nothing, and the run is exactly what it was without the input. The
store build runs only on a `full`, non-dry-run ship, after the deploy **and** the version tag
succeed. A dry run or a `migrations-only` run never builds, whatever the input says. The `mobile`
job then calls [`_mobile-build.yml`](../../../.github/workflows/_mobile-build.yml) (#3111):

1. **`build`** checks out the validated SHA and nothing else, runs `npm ci`, and installs eas-cli
   **24.8.0** with `--before=2026-10-01`, so none of eas-cli's own dependencies can be a version
   published after that date (it ships no lockfile; the lockfile fix is #3118). It refuses to go
   on unless the tree is exactly that commit with nothing changed (eas-cli uploads uncommitted
   changes with the build), and unless that commit is still the latest `v*` tag, read from the
   API. Then:
   - Each platform starts on its own:
     `eas build --platform <p> --profile production --non-interactive --no-wait --json` hands its
     build id on at once. `eas build --platform all` would start Android and then die on an iOS
     failure, leaving the Android build running unreported.
   - One step polls the builds (`eas build:view <id> --json`) until each ends, under a 230-minute
     deadline of its own. A build still queued at the deadline is reported by id, not lost.
   - Only a build EAS reports `FINISHED` from the shipped commit goes on.
   - The latest-tag check runs again: a ship made while EAS was building (a rollback, say) stops
     every upload.
   - Then `eas submit --platform <p> --profile production --id <build id> --non-interactive --wait`;
     iOS also passes `--no-auto-testflight-setup`, so CI never creates a TestFlight group.

   One platform's failure doesn't stop the other's build or upload.
2. **`record`** opens the PR that adds one `shipped-builds.json` entry per uploaded build
   (`scripts/ci/record-shipped-builds.mjs`). It uses the PR base sync GitHub App's token, because
   a PR opened with the Actions `GITHUB_TOKEN` starts no CI, and that PR's `api-contract-check`
   is the point. **Merge it before any tester installs the build.** A build EAS reports from any
   other commit is refused, not recorded. The run summary lists every build: its EAS id, status,
   version, upload result, and whether it was recorded.
   If that PR's `api-contract-check` fails, `main` has already changed the API in a way the new
   build can't take: `main` is ahead of the tag, and nothing compared the change against this
   build until it was listed. Fix it on `main` before the next production ship, or waive a route
   no shipped binary calls ([`apps/mobile/store/README.md` § Shipped builds and the API contract](../../../apps/mobile/store/README.md#shipped-builds-and-the-api-contract)).
   Don't merge around it.
3. **`snapshot`** dispatches **Migration snapshot** as the store build starts. The run stays in
   flight for as long as EAS takes, and the snapshot otherwise publishes only when a Deploy
   production run completes, so the required PR migration gates would judge production against
   the pre-ship state until then (`download-migration-snapshot`'s header).

All three jobs name the `automation` environment, which has no reviewers, so a ship stays one Approve
click ([`agent-infra.md` § GitHub environments and bootstrap secrets](../../ci-cd/agent-infra.md#github-environments-and-bootstrap-secrets)).
The build reads the same EAS `production` environment variables (§ 6.3) and credentials as a
laptop build, so anything a hand build needs, this one needs too.

**When it fails.** Production and the tag are already live and stay as they are. The `mobile` job
goes red on its own, and the deploy summary and alert don't change. The `record` job's summary
lists each platform's EAS id, status and upload, and says which of these applies. A build that
uploaded but couldn't be recorded is listed there as the JSON entries to add.

A re-run builds every platform the run asked for again, so re-run only when nothing uploaded and
nothing is still building.

- **A build finished but its upload failed:** fix the cause, run the summary's
  `npm run eas -- submit … --id <build id>` from the repo root, and record the build by hand.
- **A build was still running when the job stopped waiting:** it may finish on EAS. Don't start
  another. When it finishes, and its commit is still the latest `v*` tag, upload it with the same
  `npm run eas -- submit … --id` and record it.
- **One platform uploaded and the other didn't build:** fix the cause, then build and upload the
  other by hand from the latest `v*` tag (below), and record it.
- **Production shipped another commit before or while EAS was building:** nothing from this run
  may upload. The next store build comes with the next ship.
- **A tag check failed without finding production moved** (a GitHub API error that outlasted its
  retries, or a top `v*` tag that isn't `vX.Y.Z`; the summary keeps both apart from a moved
  production): resolve that first. Before the builds, nothing started, so then re-run; before the
  uploads, the builds are done, so confirm the commit is the latest `v*` tag and upload them by
  hand with the summary's `npm run eas -- submit … --id`.
- **Nothing built:** **Re-run failed jobs** on the same run. The deploy and the tag succeeded and
  don't run again, and the builds get fresh build numbers. The re-run stops if a later ship has
  tagged another commit; dispatch Deploy production for that one instead.
- **The tag failed, so the store build never started:** `mobile` shows skipped, and the deploy
  summary says the run asked for one. Fix the tag's cause, then use **Re-run failed jobs** on this
  run rather than the Release workflow: it retries the tag without redeploying, then runs the
  store build. The Release workflow on its own tags and builds nothing; if that is how the tag
  landed, build by hand from it (below). One exception: if the release job's log says it created
  the tag and a later step failed, retry neither, because either would put a second tag on the
  commit (#3126). Build by hand from the tag that landed.

**What a run needs outside the repo.** A non-interactive run stops without each of these. Each
*Status* says what existed when someone last looked, and how they looked.

- **`EXPO_TOKEN`**: an Expo access token, as a secret of the GitHub **`automation`** environment.
  Not Infisical, and never a repository secret (#2518). Without it the `build` job's first step
  fails, before any checkout. *Status (Expo → account → Access tokens, and the `automation`
  environment's secrets in GitHub, 2026-10-01):* the token of the robot user
  `github-deploy-production` (role Developer) on the `pdcarlson` Expo account, so it isn't tied to
  a person. To rotate it, create a new token for that robot on that page, replace the secret, then
  revoke the old token.
- **iOS signing credentials in EAS.** A non-interactive build can't create the distribution
  certificate (eas-cli's `SetUpDistributionCertificate` throws `MissingCredentialsNonInteractiveError`).
  One interactive `npm run eas -- build --platform ios --profile production` creates it. *Status
  (`eas credentials --platform ios`, 2026-10-01):* the distribution certificate and the App Store
  provisioning profile for `live.frapp.mobile`, made by the first build by hand in September 2026,
  both expire on 2027-09-17. Renew them before then with an interactive build or
  `npm run eas -- credentials --platform ios`. An expired certificate doesn't stop the run at the certificate
  step: a non-interactive build doesn't validate it, finds the profile expired, and fails trying to
  make a new profile from the old certificate (read from eas-cli 24.8.0's
  `SetUpDistributionCertificate` and `SetUpProvisioningProfile`; Apple's error itself hasn't been
  seen).
- **An App Store Connect API key, assigned to the app for EAS Submit.** Stored on the account is
  not enough: a non-interactive submit uses only the key assigned to `live.frapp.mobile` for
  submissions (`npm run eas -- credentials --platform ios` → App Store Connect: Manage your API Key → Use an
  existing API Key for EAS Submit). The table below gives the error otherwise. *Status
  (`eas credentials --platform ios`, 2026-10-01):* a key is assigned to `live.frapp.mobile` for EAS
  Submit.
- **Android:** the Play service-account key in EAS credentials (#2556, #938). Until it exists,
  choose `ios`: an Android build would finish and then fail its upload. The keystore is no
  obstacle: a non-interactive build generates one when none exists (`CreateKeystore`). A
  production Android build also needs the `GOOGLE_SERVICES_JSON` file variable
  (`apps/mobile/app.config.js` refuses to evaluate without it).
- **An EAS plan whose build quota covers each ticked ship** (one build per platform). *Status
  (Expo → account → Billing, 2026-10-01):* the Free plan, with 15 iOS and 15 Android builds a
  month, on the low-priority queue. A queued build can outlast the wait's deadline (When it fails,
  above, says what to do then); if that keeps happening, a paid plan is the fix.

#### By hand

Run from the repo root, after checking out the latest `v*` tag and building it on EAS
(`npm run eas -- build --platform <p> --profile production`). A tag cut before `npm run eas`
existed (#3124) doesn't have it; there, use the global fallback at the top of § 6. Both platforms read the `production` submit
profile in `apps/mobile/eas.json`; `eas submit` defaults to it, and falls back to it when the
build's own profile has no submit profile of the same name.

**Google Play:** `npm run eas -- submit -p android --latest` uploads to the `internal` track, the one the
profile sets. It authenticates with the Play service-account key held in EAS credentials, or a
local file named by `serviceAccountKeyPath` in the profile. No key exists yet (#2556, #938); where
it lives: [`ENV_REFERENCE.md`](../../internal/environment/ENV_REFERENCE.md#appsmobile-expo--eas), the
`eas submit` note.

**App Store:** `npm run eas -- submit -p ios --latest`, interactively or not:

- **App.** `submit.production.ios.ascAppId` names the App Store Connect app, `6812025642`, the
  Apple ID recorded in [`apps/mobile/store/README.md`](../../../apps/mobile/store/README.md)
  § As submitted. Without it, an interactive run signs in to the Apple account and finds the app
  by bundle ID (it would create one if none existed), and a non-interactive run stops.
- **Credentials.** The upload uses the App Store Connect API key assigned to the app for EAS
  Submit; one stored only on the account doesn't count. With none assigned, an interactive run
  offers to reuse a key already on the account, or creates one when the account has none. If
  `EXPO_APPLE_APP_SPECIFIC_PASSWORD` is set, it is used **instead of** the key, and it needs an
  Apple ID too (`EXPO_APPLE_ID`, or the sign-in).

**What a `--non-interactive` run needs** (the CI path is one). Each gap stops the run with the
message shown:

| Missing | eas-cli stops with |
| --- | --- |
| An archive flag (`--latest`, `--id`, `--path` or `--url`) | "You need to specify the archive source when running in non-interactive mode" |
| iOS: `ascAppId` in `submit.production.ios` | "Set ascAppId in the submit profile (eas.json) or re-run this command in interactive mode." |
| iOS: an App Store Connect API key assigned to the app for EAS Submit (one only on the account doesn't count) | "App Store Connect API Keys cannot be set up in --non-interactive mode." |
| iOS, password route: an Apple ID | "Set appleId in the submit profile (eas.json)." |

Plus `EXPO_TOKEN` for the Expo account. `ascAppId` is committed since #3111, and
`deploy-production-mobile.test.mjs` pins it to the Apple ID the store README records
(`eas-production-profile.test.mjs` leaves it to that suite).

**Source:** read from the eas-cli 24.8.0 source (`IosSubmitCommand`, `AscApiKeySource`,
`SetUpAscApiKey`, `AppSpecificPasswordSource`, `submit/commons`) and `@expo/eas-json` 24.8.0
(`resolveSubmitProfile`) on 2026-09-27 (#2379). The CI path's commands were read from the same
version's `--help` and source on 2026-10-01 (#3111): `eas build --no-wait --json` prints the
started builds as a JSON array (`platform` `IOS` or `ANDROID`) and exits; `eas build:view <id>
--json` prints one build with `status`, `appVersion`, `appBuildVersion` and `gitCommitHash`, and
eas-cli sets no request timeout on it; `eas submit --wait` exits 1 unless the submission
`FINISHED`, and `--auto-testflight-setup` defaults to on. On a version bump, re-check those
shapes too: with a changed `build:view` shape, no build ever reads as finished, and the wait runs
to its deadline.
`npm run eas` runs the version CI pins (see the top of this section), so the table holds on a
laptop too; after a bump, or when a run disagrees, re-check it against
`npm run eas -- submit --help`.

---
