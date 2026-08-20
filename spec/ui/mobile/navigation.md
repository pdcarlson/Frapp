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
| Adjust points | opens s23 sheet | — |

The admin section renders only for members whose role grants the underlying permissions; ordinary members never see it.

Two rows above are not drawn in Canvas and exist for reachability:

- **Service hours** — `service-hours.tsx` is a live route hosting the s20 sheet, and without a row it would be unreachable.
- **Chapter** — the only entry to `(auth)/chapter-picker.tsx`. The picker is deliberately *not* forced on members whose token lacks an `active_chapter_id` claim (`apps/mobile/lib/auth-gate.ts` explains why that would be an outage while #805 is open), so it needs a door.

**Implementation status.** Every row above is routed, the admin section included — its gate landed with C4 of #937. The gate is `useMyPermissions()` plus `can` / `canAny` from `@repo/validation`, never a bare `permissions.includes(…)`: an owner's grant is the wildcard `*`, so a membership test would hide these rows from exactly the people they exist for.

Two things about that section are worth knowing before reading a device:

- **It renders for nobody in the current production configuration.** `useMyPermissions` is `enabled: !!chapterId`, and no production token carries an `active_chapter_id` claim while #805 is open (`apps/mobile/lib/auth-session.tsx`), so the permission set is empty and both rows stay hidden — Presidents included. It fails closed, which is the right direction, but it means the section only appears on a local stack (where `supabase/config.toml` enables the hook) until #805 lands.
- **Host check-in resolves an event.** s22 reads an `eventId` param, so the row cannot be a bare link: it picks the next upcoming-or-still-checkable-in event and passes its id, and renders inert when there is none. **Adjust points renders disabled** — the s23 sheet needs a member picker plus amount/category/reason and is tracked separately.

The drawn s16 also carries an inline `CHAPTER · ADMIN` group, gated on `chapter-config:view` and read-only; its "Join code" row is omitted because chapters have no join code (joining runs through single-use, expiring invite tokens — see [`screens.md`](screens.md)).

## Global entries outside the tab bar

- **UP NEXT strip** (s04): the top of Chat home carries an UP NEXT section — the next event and the nearest due task as compact rows, each tapping through to its detail (event detail s07, task board s08). It is a pulse affordance: chat is home, so the one glanceable "what's next" surface rides above the channel list rather than living in a Home tab.
- **✦ Ask pill** (s04, s06): a sparkle pill in the top bar of Chat home and Events opens the Ask sheet (s17). Ask is a global entry, not a tab — it MUST NOT become a fifth tab. Answer behavior and corpus rules: [`../../behavior/ai.md`](../../behavior/ai.md). Both halves now exist: the s06 pill landed with C7 (#998), which is also when the pill stopped navigating and started **presenting** — s17 is a sheet its host screen owns, so the pill takes an `onPress` and the host holds the `BottomSheetModal` ref ([`patterns.md`](patterns.md) § Bottom sheets). It presses through even when Ask is switched off for the build (`EXPO_PUBLIC_ASK_ENABLED`, default off): the sheet states the reason, because a control that silently does nothing is the dead end [`../design-system/components.md`](../design-system/components.md) §5 bans.

## Deep links

- Scheme: `frapp://` (`scheme` in `apps/mobile/app.json`). It stays `frapp` until the deferred repo rename; new docs still say Signet in prose.
- **`frapp://join?token=…` fills s02.** The same `token` query web uses (`/join?token=`) is accepted on the app scheme and as a pasted URL in the field.
- **`frapp://event-details` is a contract.** Exported `.ics` files carry it as their deep-link URL (`apps/mobile/app/(tabs)/event-details.tsx`), and those files live on in members' device calendars indefinitely. The route filename and the URL MUST never change.
- **First-officer creation is `(auth)/create-chapter`.** The route is exempt from the authenticated bounce into the tabs so a successful onboard does not yank the officer off the invite step (`spec/behavior/onboarding.md`).
- **Magic-link auth callback:** sign-in email links redirect to `Linking.createURL("/")` (`emailRedirectTo` in `apps/mobile/lib/auth-session.tsx`), which expo-linking resolves **at runtime to whichever scheme owns the running app** — `frapp://` in a build that owns the scheme, but `exp://<host>:8081/--/` under Expo Go. Both forms must be allowlisted in Supabase Auth's redirect URLs for magic-link sign-in to complete, and the Expo Go form embeds a per-machine host, so it cannot be allowlisted once and reused across developers. Tracked as issue #765 — note that allowlisting only `frapp://` does not unblock Expo Go.

## Pre-chapter routing (s02 / s03)

`apps/mobile/lib/auth-gate.ts` is still the single decision both layouts read. It now also consumes `GET /v1/chapters`:

| Authenticated state | Destination |
| --- | --- |
| Chapters list still loading | `hold` |
| Zero memberships | `join` (s02) |
| Active membership has `has_completed_onboarding === false` | `welcome` (s03) |
| Otherwise (or the chapters read failed) | `tabs` |

A missing `active_chapter_id` claim is still not a destination — see `lib/auth-gate.ts`. `(tabs)/_layout.tsx` is frozen and still only redirects to sign-in; walking a member *out* of the tabs onto s02/s03 is `AppRuntime` (`lib/onboarding/use-onboarding-redirect.ts`) so that file does not have to thaw.

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
of `expo-network` that [`../resilience.md`](../resilience.md) § 2 now forbids, so they
had to go, and every future app-wide runtime hangs off `components/app-runtime.tsx`
instead of adding another hook call here — which is the whole reason that component
exists.

**`package.json` later gained `@repo/org-archetypes`** so the first-officer wizard
can import the shared catalog instead of the slim local copy #1102 shipped while
this file was frozen. That is the same integrator carve-out as `@repo/chat-core`
and `expo-notifications`. The other six hotspots stay frozen.
