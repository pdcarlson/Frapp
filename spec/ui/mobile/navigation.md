# Mobile Navigation

> The locked 4-tab information architecture, the More hub, the global entries that live outside the tab bar, deep links, and typed-route rules.

Visual truth: [`../design-system/reference/canvas-screens.dc.html`](../design-system/reference/canvas-screens.dc.html) — the tab bar is drawn on s04, s06, s08, and s09. Screen ids reference [`screens.md`](screens.md).

## Tab bar — 4 tabs, locked

| Position | Tab | Route | Notes |
| -------- | --- | ----- | ----- |
| 1 | **Chat** | `(tabs)/index.tsx` | Home. The app opens here — chat is home. |
| 2 | **Events** | `(tabs)/events.tsx` | |
| 3 | **Tasks** | `(tabs)/tasks.tsx` | Absorbs points (balance + rank at top of board). |
| 4 | **More** | `(tabs)/more.tsx` | Hub for everything else (below). |

- There is **no Home tab**. This is a locked decision; do not reintroduce one.
- Known stale reference: panel 4g ("Mobile chrome") of [`../design-system/reference/signet-design-system.dc.html`](../design-system/reference/signet-design-system.dc.html) draws a 5-tab bar. It is wrong — the Canvas header and all 23 screens lock 4 tabs, and Canvas wins per the precedence rules in [`../README.md`](../README.md).
- The bar previously showed six tabs — Home, Chat, Events, Points, Profile, More. It now shows these four; Home and Points are gone as screens, and Profile moved to the More hub per [`screens.md`](screens.md).
- Tab icons are duotone per [`../design-system/iconography.md`](../design-system/iconography.md); active/inactive treatment and colors per [`../design-system/foundations.md`](../design-system/foundations.md). They are custom `react-native-svg` components in `apps/mobile/components/tab-glyphs.tsx`, transcribed from the tab bar drawn in the Canvas reference — not an off-the-shelf icon pack.
- Every route outside these four is hidden from the bar (`href: null`) and reached by navigation.

## More hub (s09)

Rows as drawn, top to bottom. Row anatomy: duotone icon, label, trailing status, chevron.

| Row | Destination | Trailing status as drawn |
| --- | ----------- | ------------------------ |
| Profile card (avatar, name, role chip, points) | `profile.tsx` (s15) | chevron |
| Study hours | `study.tsx` (s10) | progress, e.g. "4.0 / 6.0" |
| Dues | `dues.tsx` (s11) | warning chip, e.g. "Due Sept 15" |
| Documents | `documents.tsx` (s12) | — |
| Directory | `directory.tsx` (s13) | — |
| Notifications | `notifications.tsx` (s14) | unread-count badge |
| Service hours | `service-hours.tsx` (host of the s20 sheet) | — |
| Settings | `preferences.tsx` (s16) | — |
| Chapter | `(auth)/chapter-picker.tsx` | — |
| **Admin section** (role-gated, labeled with the viewer's role, e.g. "ADMIN · PRESIDENT") | | |
| Host check-in | `host-check-in.tsx` (s22) | — |
| Adjust points | s23 sheet — **not rendered** until the sheet ships (#2300) | — |

The admin section renders only for members whose role grants the underlying permissions; ordinary members never see it.

Two rows above are not drawn in Canvas and exist for reachability:

- **Service hours** — `service-hours.tsx` is a live route hosting the s20 sheet, and without a row it would be unreachable.
- **Chapter** — the only entry to `(auth)/chapter-picker.tsx`. The picker is deliberately *not* forced on members whose token lacks an `active_chapter_id` claim (`apps/mobile/lib/auth-gate.ts` explains why claim-absence is not a destination), so it needs a door.

**Implementation status.** Every row above except Adjust points is routed, the admin section included — its gate landed with C4 of #937. The gate is `usePermissionList()` (a thin wrapper over `useMyPermissions()`) plus `can` from `@repo/validation` (`canAny` when a gate is composite), never a bare `permissions.includes(…)`: an owner's grant is the wildcard `*`, so a membership test would hide these rows from exactly the people they exist for. Today the section's gate is `events:update` alone — see Host check-in below.

Two things about that section are worth knowing before reading a device:

- **It renders for nobody until a token carries a chapter claim.** `useMyPermissions` is `enabled: !!chapterId`. The hook is on in both hosted projects; production still has no memberships, so issued tokens have no `active_chapter_id` and the permission set stays empty — Presidents included — until the first onboard. It fails closed, which is the right direction. Local (`supabase/config.toml`) and staging (seeded members) already show the section.
- **Host check-in resolves an event.** s22 reads an `eventId` param, so the row cannot be a bare link: it picks the next upcoming-or-still-checkable-in event and passes its id, and renders inert when there is none. **There is no Adjust points row.** The s23 sheet needs a member picker plus amount/category/reason and is unbuilt, and a row that renders disabled with nothing behind it is the "coming soon" shape App Review Guideline 2.1 rejects, so it was removed rather than drawn (#2300). It returns with the sheet; until then awarding and fining points is web-only. The section is gated on `events:update` alone for the same reason — gating it on `points:adjust` too would draw an empty Admin header for an officer who holds only that.

The drawn s16 also carries an inline `CHAPTER · ADMIN` group, gated on `chapter-config:view` and read-only; its "Join code" row is omitted because chapters have no join code (joining runs through single-use, expiring invite tokens — see [`screens.md`](screens.md)).

## Global entries outside the tab bar

- **UP NEXT strip** (s04): the top of Chat home carries an UP NEXT section — the next event and the nearest due task as compact rows, each tapping through to its detail (event detail s07, task board s08). It is a pulse affordance: chat is home, so the one glanceable "what's next" surface rides above the channel list rather than living in a Home tab.
- **✦ Ask pill** (s04, s06): a sparkle pill in the top bar of Chat home and Events opens the Ask sheet (s17). Ask is a global entry, not a tab — it MUST NOT become a fifth tab. Answer behavior and corpus rules: [`../../behavior/ai.md`](../../behavior/ai.md). Both halves now exist: the s06 pill landed with C7 (#998), which is also when the pill stopped navigating and started **presenting** — s17 is a sheet its host screen owns, so the pill takes an `onPress` and the host holds the `BottomSheetModal` ref ([`patterns.md`](patterns.md) § Bottom sheets). **The pill exists only in a build that has Ask.** With `EXPO_PUBLIC_ASK_ENABLED` off (the default; `apps/mobile/lib/ask/flag.ts`) neither host draws it, the sheet renders nothing, and the `ask` route redirects to Chat home, so a build without Ask shows no Ask surface anywhere.

  > **Reversed 2026-09-22, owner decision ([#2259](https://github.com/pdcarlson/Frapp/issues/2259)).** This bullet used to require the opposite: the pill "presses through even when Ask is switched off … the sheet states the reason, because a control that silently does nothing is the dead end §5 bans". The sheet then read "Ask isn't switched on for this build yet". That argument holds for a member who knows Ask is coming, but App Review is the other reader: a prominent control on the first screen after sign-in whose only function is to announce that its feature is off is the placeholder Guideline 2.1 rejects. Nor is it the dead end the old rule was guarding against. That rule bans a control that is *present* and does nothing; a control that is not drawn has nothing to discover. The line between the two is [`../design-system/README.md`](../design-system/README.md) §5 rule 4, *disable, don't hide, for recoverable states*, which names this pill as one of the things to hide: no member can switch Ask on, and the pill has no function but Ask, so it is hidden, like a module the chapter has switched off. That is the Ask pill's case, not a rule for every build-time switch. The push primer, also gated at build time, was left open here and has since followed it: s03 omits the card when the build cannot push ([#2299](https://github.com/pdcarlson/Frapp/issues/2299), 2026-09-24; [`patterns.md`](patterns.md#push-notifications) § Push notifications). (The old text also cited `components.md` §5, which is Badges and chips; the rule was always in the design-system README.)
  >
  > **Why dues' Pay control does not follow.** `lib/payments/stripe.ts` gates on a build-time value too, and it still renders Pay disabled with its reason. The difference is what the control is for. Pay sits on an invoice the member really owes, so the disabled control is one route through a real task, and its caption names the other ("Ask your treasurer how to pay this invoice"). The ✦ pill has no function except Ask. Keep the two distinct, rather than "fixing" either to match the other.
  >
  > The board (`canvas-screens.dc.html`) draws s04 and s06 with the pill. That is the with-Ask state, so a build without Ask showing no pill is not drift from the board.
  >
  > `apps/mobile/lib/ask/entry-points.spec.tsx` pins the behaviour: no pill on s04 or s06 and a redirect from `ask` with the flag off, and the pill presenting the sheet with it on.

## Deep links

- Scheme: `frapp://` (`scheme` in `apps/mobile/app.json`). It is permanent, because every installed binary carries it (ADR-25).
- **`frapp://join?token=…` fills s02.** The same query keys web `/join` uses (`token`, then `invite`, then `code`) are accepted on the app scheme and as a pasted URL in the field.
- **`frapp://event-details` is a contract.** Exported `.ics` files carry it as their deep-link URL (`apps/mobile/app/(tabs)/event-details.tsx`), and those files live on in members' device calendars indefinitely. The route filename and the URL MUST never change.
- **First-officer creation is `(auth)/create-chapter`.** The route is exempt from the authenticated bounce into the tabs so a successful onboard does not yank the officer off the invite step (`spec/behavior/onboarding.md`).
- **Magic-link auth callback:** sign-in email links redirect to `Linking.createURL("/")` with a trailing `?` (`emailRedirectTo` in `apps/mobile/lib/auth-session.tsx`), which expo-linking resolves **at runtime to whichever scheme owns the running app** — `frapp:///?` in a build that owns the scheme, but `exp://<host>:8081/--/?` under Expo Go. The trailing `?` lets the hosted Magic Link template append `&token_hash={{ .TokenHash }}&type=magiclink` onto `{{ .RedirectTo }}` the same way web's `/auth/callback?next=…` does, so the emailed href never uses `*.supabase.co/auth/v1/verify`. Both forms must be allowlisted in Supabase Auth's redirect URLs for magic-link sign-in to complete. `frapp://**` **is** allowlisted on both hosted projects since 2026-09-06 (`docs/internal/ops/deployment/supabase.md` § Auth settings), so a real build completes; the Expo Go form embeds a per-machine host, so it cannot be allowlisted once and reused across developers. Tracked as issue #765 — allowlisting `frapp://` does not unblock Expo Go. `AuthSessionProvider` accepts implicit tokens, PKCE `code`, and `token_hash` (`verifyOtp`) on that scheme.
- **OAuth auth callback:** Google, and Apple when native SIWA is unavailable, reuse that same `Linking.createURL("/")` + trailing `?` as `signInWithOAuth` `redirectTo` (`skipBrowserRedirect`, then `WebBrowser.openAuthSessionAsync`). Native Sign in with Apple on iOS uses `signInWithIdToken` and never opens a browser. Expo Go's OAuth return has the same per-machine allow-list gap as magic-link (#765).

## Pre-chapter routing (s02 / s03)

`apps/mobile/lib/auth-gate.ts` is still the single decision both layouts read. It now also consumes `GET /v1/chapters`:

The first matching row wins.

| Authenticated state | Destination |
| --- | --- |
| No chapter yet, and the `active_chapter_id` claim is still being read | `hold` |
| Chapters list still loading (first read, its retry included, even paused offline) | `hold` |
| **Chapters read succeeded:** zero memberships | `join` (s02) |
| A member (in the last chapters list, even if a refetch since failed), the first Terms read still loading (its retry included) | `hold` |
| A member (likewise) who hasn't accepted the current Terms (#2302) | `terms` (`(auth)/terms.tsx`) |
| **Chapters read succeeded:** active membership has `has_completed_onboarding === false` | `welcome` (s03) |
| Otherwise: onboarded, or the chapters read failed in any other case (fail open), or the first Terms read failed. A read that failed (retries spent) with no answer keeps reading as failed while it refetches, so it doesn't hold again; a failed Terms refetch keeps its cached answer | `tabs` |

`terms` comes before `welcome` so a new member agrees before they can post. The server decides it (`GET /v1/users/me/legal-acceptance`), never a version compiled into the binary ([`../../behavior/legal.md`](../../behavior/legal.md#acceptance-record) § Acceptance record). While the gate reads `terms`, `/create-chapter` is also permitted, since the wizard carries the same checkbox.

A missing `active_chapter_id` claim is still not a destination — see `lib/auth-gate.ts`. `(tabs)/_layout.tsx` is frozen and still only redirects to sign-in; walking a member *out* of the tabs onto s02/s03 or the Terms prompt is `AppRuntime` (`lib/onboarding/use-onboarding-redirect.ts`) so that file does not have to thaw.

## Typed routes

- `typedRoutes` is enabled (`experiments.typedRoutes` in `apps/mobile/app.json`), so route strings are compile-checked against the file tree **during local development**.
- **They are not checked in CI.** The generated types live in `.expo/types` and `expo-env.d.ts`, both gitignored (`apps/mobile/.gitignore`) and written only by `expo start`. CI runs a bare `tsc`, and with those files absent `Href` widens back to `string` — a nonexistent path assigned to `Href` type-checks clean. Do not rely on the compiler to catch a bad route on a branch.
- **`apps/mobile/lib/routes.spec.ts` is the guard that actually runs.** It walks the real route tree and resolves route literals against it, and asserts the tab bar registers exactly the four locked tabs with a backing file behind every registration. A rename that misses a call site fails there.
- **Know what that guard does not cover.** It matches *double-quoted string literals* at `href="…"`, `href: "…"`, `asRoute("…")`, `router.replace|push|navigate("…")`, and `pathname: "…"` — the last added with C1 (#937), whose chat list is the first screen to navigate with a param and therefore the first to use the object form `router.push({ pathname: "/chat-thread", params: { channelId } })`, which every other pattern misses. A route built from a template literal, a variable, or a prop is still invisible to it — `components/nav-tile.tsx` takes `href` as a prop, so only its call sites are checked, not the component. It also only checks that literals resolve, never that a route has an inbound link, so an orphaned route stays green. When you add a route, add its entry point in the same change; neither gate will remind you.
- All renames and removals in [`screens.md`](screens.md) MUST still land in **one PR** — a partial rename leaves half the app's links broken whether or not a compiler notices.
- `asRoute()` in `apps/mobile/lib/href.ts` is the sanctioned escape hatch for static paths that typed-route generation misses. It MUST NOT be used to paper over a route the type-checker correctly rejects. Note it takes a plain `string`, so it defeats the dev-time check entirely — `routes.spec.ts` is what keeps its call sites honest.

## Hotspot freeze

Seven files are **frozen** now that the nav restructure has landed:

`app/_layout.tsx` · `app/(tabs)/_layout.tsx` · `lib/theme.tsx` · `components/screen-shell.tsx` · `lib/href.ts` · `package.json` · `app.json`

- Slices that build screens **only add files**. They do not edit the seven.
- Every known future route is already registered in `app/(tabs)/_layout.tsx` as a hidden `Tabs.Screen` (`href: null`) with a stub backing file, so adding a screen means filling in the stub, never touching the layout. A `Tabs.Screen` without a file throws at runtime, which is why the stubs exist rather than the registrations alone.
- Changes that genuinely need one of the seven — a new dependency, a config plugin, a new shared prop — go through a single integrator as a small standalone PR, not as part of a feature slice.
- **"A new dependency" includes internal `@repo/*` workspace packages**, not just external npm ones. npm workspace hoisting means an undeclared `@repo/*` import usually resolves anyway, so the missing entry produces no error and is easy to skip — but the dependency is real, and it breaks under isolated installs or a hoisting change. Declare it in `package.json` through the integrator like any other. `@repo/chat-core` reached `apps/mobile` this way for C1 (#937); `@repo/org-archetypes` reached it the same way for the first-officer wizard (the #1102 screen slice shipped a slim local catalog rather than edit this file). `apps/web/package.json` had declared both packages from the start.

The point is contention: these files are the ones every parallel slice would otherwise edit at once, and a rename or a prop added in two branches at the same time is a merge conflict in the one place that breaks the whole app.

**Three of the seven were touched by C7/C8 (#998), recorded rather than glossed:**
`package.json` gained `expo-notifications`, `app.json` gained its config plugin, and
`app/_layout.tsx` swapped `<NetworkBanner isOnline… isInternetReachable… />` for a
props-less `<NetworkBanner />` beside a new one-line `<AppRuntime />`. The first two
are the integrator carve-out above working as intended (a dependency and its config
plugin cannot be added any other way). The third is a real edit to a frozen file, and
the smallest one available: the banner's props *were* the second, independent reading
of `expo-network` that [`../resilience/connection-state.md`](../resilience/connection-state.md) now forbids, so they
had to go, and every future app-wide runtime hangs off `components/app-runtime.tsx`
instead of adding another hook call here — which is the whole reason that component
exists.

**`package.json` later gained `@repo/org-archetypes`** so the first-officer wizard
can import the shared catalog instead of the slim local copy #1102 shipped while
this file was frozen. That is the same integrator carve-out as `@repo/chat-core`
and `expo-notifications`. The other six hotspots stay frozen.

**`package.json` and `app.json` gained `expo-document-picker` and `expo-image-picker`**
(#1045) — the dependency-declaration half of the fix for three drawn-but-unbuildable
affordances (s21 upload, s15 avatar photo, s20 proof attachment), none of which had a way
to pick a file off the device. `expo-image-picker` needed a config-plugin entry (a
`photosPermission` string, camera and microphone permissions declined since this app
already asks for camera access separately for check-in scanning and image-picker's own
camera capture is not used); `expo-document-picker`'s plugin only touches iCloud
entitlements behind `ios.usesIcloudStorage`, which this app does not set, so it needs no
`plugins` entry. Same integrator carve-out as the rest of this section — the three
surfaces themselves are still unbuilt and land as their own slices.

**Both were removed again** (#2296) — the three surfaces were still unbuilt a month
later, and the declarations were not merely premature but actively harmful. The
`photosPermission` string shipped in the binary as a purpose string for a feature that
does not exist (Guideline 5.1.1(i)), and the `cameraPermission: false` above compiled
to `withBlockedPermissions(['android.permission.CAMERA'])`, which *removed* the
permission `expo-camera` contributes and wrote `tools:node="remove"` into the manifest —
silently breaking QR check-in (`app/(tabs)/check-in.tsx`) on every Android build. The
declining-a-permission half is the reusable lesson: a plugin option that declines a
permission is not inert, it overrides other plugins, so it can only be set for a
permission nothing in the app requests. `app.config.spec.ts` pins both halves against
the resolved config — the Android permission set at the effect level, the declined
options and iOS purpose strings at the cause level — so re-adding this picker the same
way fails a test rather than shipping. It is not an airtight fence: an option left
*omitted* still inherits its plugin's default purpose string, and a vendor option
spelled something other than `*Permission`/`*UsageDescription` is not scanned. Closing
those needs the introspected config in CI, filed as #2343. Re-add the
dependency and its plugin entry in the slice that actually builds a picker surface —
which is what #1045 should have been.

**`expo-image-picker` came back (#2464), with the surface this time** — chat photo
upload, `apps/mobile/lib/chat/attachment-upload.ts`, which is the importer #1045 never
had. `expo-image-manipulator` came with it, and earns its place rather than riding
along: iOS hands HEIC back from the photo library, `image/heic` is on neither the
`document` allowlist nor the chat bucket, and the bucket gates the *declared*
`Content-Type` and never the bytes — so declaring `image/jpeg` over HEIC would be
accepted, stored, and then render broken. The transcode is what makes the declared
type true. It is deliberately **conditional**: an already-allowlisted pick uploads
untouched, because re-encoding everything would flatten a transparent PNG and reduce
an animated GIF to one frame, and a GIF sent as a file is a feature that already works
through the `document` kind.

Both #2296 defects stay fixed, and the plugin entry is the place that proves it. It
sets `photosPermission` and `microphonePermission: false`, and **no `cameraPermission`
key at all**. Each of those three is load-bearing:

- `cameraPermission` is omitted rather than declined because declining is what
  compiled to `withBlockedPermissions(['android.permission.CAMERA'])` and broke QR
  check-in. Omitting is safe — and *not* an instance of the omitted-option hazard
  above — because `IOSConfig.Permissions.applyPermissions` resolves each key as
  `permissions[key] || infoPlist[key] || default`, so an undefined option falls
  through to whatever a plugin already wrote before it ever reaches the vendor
  default, and `expo-camera` writes NSCameraUsageDescription explicitly in either
  plugin order.
- `microphonePermission` **is** declined, and must stay declined. Omitting it is not
  inert: `withAndroidImagePickerPermissions` adds `android.permission.RECORD_AUDIO`
  whenever the option is anything other than `false`, and the iOS half would write a
  default microphone purpose string for a capability this app does not have — the same
  Guideline 5.1.1(i) shape `photosPermission` used to be. Declining strips nothing
  another plugin contributes, because `expo-camera` sets `recordAudioAndroid: false`
  and so never adds RECORD_AUDIO either.
- `photosPermission` is set explicitly rather than left to the plugin default, per the
  unread-pin note above, and is now in `app.config.spec.ts`'s `REQUESTED_AT_RUNTIME`
  list so a future decline of it fails a test.

The pairing is also pinned from the other side: `app.config.spec.ts` asserts a media
picker is depended on **only while a non-spec source file imports one**, which is the
check that would have caught #1045 shipping the dependency a month ahead of any
surface. `scripts/ci/__tests__/signet-mobile-permissions.test.mjs` raised its prompt
floor from two to three with this slice, which is exactly what that file's WHY block
said the raise was for.

**`app.json` also gained `ios.privacyManifests`** (#2294, same PR as the removal above) —
the iOS privacy manifest, without which App Store Connect returns an automated
ITMS-91053/91061 on the first upload. It declares `NSPrivacyTracking: false`, an empty
`NSPrivacyTrackingDomains`, and two required-reason categories. `UserDefaults`/`CA92.1`
is the load-bearing one, and its basis is `@stripe/stripe-react-native` alone — it reads
`UserDefaults.standard` and ships no manifest of its own. `expo-sharing` also uses
`UserDefaults`, but through `UserDefaults(suiteName:)`, the app-group case, whose reason
is `1C8F.1`; that path is unreachable while this app configures no app group, and a share
extension would have to declare `1C8F.1` rather than assume this row covers it.
`FileTimestamp`/`C617.1` stands for the app target's own container reads and is required
by #2296's criteria — it is not what averts ITMS-91053, since react-native, cxxreact,
`expo-application` and `async-storage` already declare that category themselves. It is a **static** key by
necessity: `@expo/config-plugins`' `withPrivacyInfo` no-ops unless `ios.privacyManifests`
is present, and the app commits no `ios/` directory, so prebuild is the only thing that
writes the file. That makes it load-bearing that `app.config.js`'s `applyMobileConfig`
keeps spreading `config` and overriding only `extra` and `android` — `app.config.spec.ts`
asserts the resolved config to pin exactly that. Recorded here rather than glossed,
per this section's practice; the nutrition-label half stays owner work on #2196 §4.
