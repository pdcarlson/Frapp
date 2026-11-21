### ADR-29: Desktop app — an Electron shell around the hosted web app, sign-in through the system browser, updates from GitHub Releases (2026-11-13)

**Status: Current.** Paul took the two product decisions on 2026-11-13, in the project thread
"Build a Frapp desktop app": build a real desktop app rather than only an installable web app, and
build it on Electron rather than Tauri. The rest (decisions 3 to 8) are the drafting session's
defaults, listed so he can object to any of them in review. ADR-24 asked for the shell choice to
be recorded in its own ADR when desktop work started ([#2512](https://github.com/pdcarlson/Frapp/issues/2512)).
When this record was written nothing here was built: there was no `apps/desktop`, and `apps/web`
has no web manifest and no service worker.

> **Updated 2026-11-13 ([#4840](https://github.com/pdcarlson/Frapp/issues/4840)).** Decisions 3
> and 4 are built in `apps/desktop`: the window, tray, Open at Login, the navigation and
> permission rules, the `window.frappDesktop` bridge, and an unsigned `Desktop build` workflow
> ([`../README.md` §3.4a](../README.md#34a-desktop-appsdesktop)). Decisions 5 to 8 are not.

**Decision.**

1. **Frapp ships a desktop app for macOS and Windows.** Paul was offered the cheaper path first, an
   installable web app (PWA) with web push, about a week of work with no signing or update feeds,
   and chose the full app. The bar is Discord and Slack desktop: its own window and dock or
   taskbar icon, a tray icon, launch at login, OS notifications and an unread badge.
2. **The shell is Electron.** It renders with the same Chromium the web app is built and tested
   against on every OS, so what works on the web works on the desktop. Its updater
   (`electron-updater`) has channels and staged rollout built in, and the shell is TypeScript like
   the rest of the repo.
3. **The shell is thin and loads the hosted web app.** The window opens `https://app.frapp.live`;
   the web app is not bundled or statically exported, because it needs its server
   (`apps/web/proxy.ts`, `apps/web/app/auth/callback/route.ts`). UI changes ship as web deploys and
   reach desktop users on their next load. The shell carries no environment (ADR-24 rule I2):
   staging is an internal launch option, never a separate build. *Corrected 2026-11-13:* this
   said the option was allow-listed to `*.frapp.live`; the shell accepts exactly
   `https://app.frapp.live` and `https://app.staging.frapp.live`, plus `http://localhost:3000`
   from an unpackaged run (`apps/desktop/src/shared/app-url.ts`).
4. **The renderer is locked down.** `contextIsolation` and `sandbox` on, `nodeIntegration` off.
   Navigation stays on the app's origin; every other link opens in the system browser. The web app
   reaches the OS only through a small preload bridge, `window.frappDesktop`, whose presence is
   also how the web app knows it is inside the shell.
5. **Google and Apple sign-in run in the system browser.** Both refuse embedded browsers. Inside the
   shell, the web app starts OAuth with `skipBrowserRedirect` and a `frapp-desktop://auth/callback`
   return, so the PKCE verifier cookie lives in the app window; the shell opens the provider page
   in the default browser, receives the `frapp-desktop://` link, and loads the existing
   `/auth/callback?code=…` route in its window. No second callback route. The scheme is
   `frapp-desktop`, not the phone's, so the two apps never claim each other's links.
6. **Notifications come from the running app, not a push service.** The shell shows OS
   notifications from the realtime connections the web app already holds, following the member's
   existing settings and mutes, and keeps running in the tray or dock when its window is closed.
   This is how Discord and Slack behave. Whether an open desktop app holds back the phone push
   under ADR-04's presence rules is decided and recorded with that step ([#4842](https://github.com/pdcarlson/Frapp/issues/4842)).
7. **Signed builds only.** macOS with an Apple Developer ID certificate and notarization (the
   Apple program is already paid for iOS). Windows with Azure Artifact Signing (about $9.99 a
   month), whose identity validation Paul started on 2026-11-13.
8. **Updates come from GitHub Releases.** The repo is public, so `electron-updater` reads
   `desktop-v<version>` releases with no extra host. `beta` is a prerelease and `stable` a full
   release, and both point at production (ADR-24: channels are not environments). Promotion
   re-publishes the same signed files, and `stagingPercentage` stages a rollout.

**The steps** are the sub-issues of [#2512](https://github.com/pdcarlson/Frapp/issues/2512), each its
own PR: the shell ([#4840](https://github.com/pdcarlson/Frapp/issues/4840)), sign-in
([#4841](https://github.com/pdcarlson/Frapp/issues/4841)), notifications and the badge
([#4842](https://github.com/pdcarlson/Frapp/issues/4842)), signing, updates and the release workflow
([#4843](https://github.com/pdcarlson/Frapp/issues/4843)), and a download page
([#4844](https://github.com/pdcarlson/Frapp/issues/4844)).

**Context.** On 2026-11-13 Paul asked how hard a desktop app would be. The research found the web
app had nothing desktop-shaped yet: no manifest, no service worker, and push only to phones through
Expo (`apps/api/src/infrastructure/notifications/expo-push.provider.ts`), with web push recorded as
out of scope in [`notifications.md`](../../behavior/notifications.md). #2512 already held the
delivery shape from the September research (#2504 digest 06): a thin shell on the hosted app,
channels that both use production, Developer ID plus Azure signing.

**Rejected alternatives.**

- **An installable web app with web push only.** About a week, no signing, no stores, updates with
  every web deploy. Rejected by Paul for now in favour of the full app; it stays possible later and
  would also help members who never install anything. Its gaps against the bar: no tray, no
  launch at login, and on macOS Chrome delivers web push only while Chrome is running.
- **Tauri.** Installers under 10 MB against Electron's ~100 MB, and a smaller memory footprint. But
  it renders with each OS's own engine (Safari's WebKit on macOS), so a web bug can appear on one
  desktop only, it adds Rust to the repo, and its updater has no channels or staged rollout of its
  own. Paul chose Electron on the card that listed these.
- **Bundling the web app into the shell.** Rejected for the reason in decision 3: the web app needs
  its server, and a bundled copy would ship UI fixes only with a shell update.
- **R2 for the update feeds,** as #2512 first planned. It needs a Cloudflare account, a bucket and
  keys that GitHub Releases does not. It stays the fallback if GitHub Releases can't do something
  the rollout needs.

**Consequences.**

- A new workspace, `apps/desktop`, with its own CI build. macOS and Windows runners are needed for
  signed builds, which are free for a public repo.
- The web app gains a few shell-only branches, keyed on `window.frappDesktop`: OAuth start, OS
  notifications, the badge, and hiding "Get the desktop app".
- Paul owns three provider setups: the Developer ID certificate, an App Store Connect API key for
  notarization, and the Azure Artifact Signing account. Each is walked one step at a time in the PR
  that needs it.
- Supabase's Auth redirect allow-list gains `frapp-desktop://auth/callback` on staging and
  production.
- The shell itself rarely changes, so most desktop releases are web deploys. A shell release is
  needed only for an Electron security update or a change to the bridge.

**What this record does not decide.**

- Linux. `electron-builder` can produce an AppImage cheaply, but it is unsigned and untested;
  ship it only if someone asks. *Updated 2026-11-13:* the `Desktop build` workflow does build an
  AppImage, to catch packaging breaks, but it isn't offered to members.
- The Mac App Store and Microsoft Store. Direct download first.
- Whether the desktop app counts as presence for phone push (decision 6, settled in #4842).
