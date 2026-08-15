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
| **Admin section** (role-gated, labeled with the viewer's role, e.g. "ADMIN · PRESIDENT") | | |
| Host check-in | `host-check-in.tsx` (s22) | — |
| Adjust points | opens s23 sheet | — |

The admin section renders only for members whose role grants the underlying permissions; ordinary members never see it.

**Implementation status.** The rows above are all routed except the admin section, which is deliberately not wired yet: its links are role-gated and the gate lands with the cluster that owns those screens. Shipping ungated admin entries to every member would be worse than shipping them late. Destinations marked "New" in [`screens.md`](screens.md) are routed to stubs — navigation is complete, the screens are not.

## Global entries outside the tab bar

- **UP NEXT strip** (s04): the top of Chat home carries an UP NEXT section — the next event and the nearest due task as compact rows, each tapping through to its detail (event detail s07, task board s08). It is a pulse affordance: chat is home, so the one glanceable "what's next" surface rides above the channel list rather than living in a Home tab.
- **✦ Ask pill** (s04, s06): a sparkle pill in the top bar of Chat home and Events opens the Ask sheet (s17). Ask is a global entry, not a tab — it MUST NOT become a fifth tab. Answer behavior and corpus rules: [`../../behavior/ai.md`](../../behavior/ai.md).

## Deep links

- Scheme: `frapp://` (`scheme` in `apps/mobile/app.json`). It stays `frapp` until the deferred repo rename; new docs still say Signet in prose.
- **`frapp://event-details` is a contract.** Exported `.ics` files carry it as their deep-link URL (`apps/mobile/app/(tabs)/event-details.tsx`), and those files live on in members' device calendars indefinitely. The route filename and the URL MUST never change.
- **Magic-link auth callback:** sign-in email links redirect to `Linking.createURL("/")` (`emailRedirectTo` in `apps/mobile/lib/auth-session.tsx`), which expo-linking resolves **at runtime to whichever scheme owns the running app** — `frapp://` in a build that owns the scheme, but `exp://<host>:8081/--/` under Expo Go. Both forms must be allowlisted in Supabase Auth's redirect URLs for magic-link sign-in to complete, and the Expo Go form embeds a per-machine host, so it cannot be allowlisted once and reused across developers. Tracked as issue #765 — note that allowlisting only `frapp://` does not unblock Expo Go.

## Typed routes

- `typedRoutes` is enabled (`experiments.typedRoutes` in `apps/mobile/app.json`), so route strings are compile-checked against the file tree **during local development**.
- **They are not checked in CI.** The generated types live in `.expo/types` and `expo-env.d.ts`, both gitignored (`apps/mobile/.gitignore`) and written only by `expo start`. CI runs a bare `tsc`, and with those files absent `Href` widens back to `string` — a nonexistent path assigned to `Href` type-checks clean. Do not rely on the compiler to catch a bad route on a branch.
- **`apps/mobile/lib/routes.spec.ts` is the guard that actually runs.** It walks the real route tree, resolves every route literal in the app against it, and asserts the tab bar registers exactly the four locked tabs with a backing file behind every registration. A rename that misses a call site fails there.
- All renames and removals in [`screens.md`](screens.md) MUST still land in **one PR** — a partial rename leaves half the app's links broken whether or not a compiler notices.
- `asRoute()` in `apps/mobile/lib/href.ts` is the sanctioned escape hatch for static paths that typed-route generation misses. It MUST NOT be used to paper over a route the type-checker correctly rejects. Note it takes a plain `string`, so it defeats the dev-time check entirely — `routes.spec.ts` is what keeps its call sites honest.

## Hotspot freeze

Seven files are **frozen** now that the nav restructure has landed:

`app/_layout.tsx` · `app/(tabs)/_layout.tsx` · `lib/theme.tsx` · `components/screen-shell.tsx` · `lib/href.ts` · `package.json` · `app.json`

- Slices that build screens **only add files**. They do not edit the seven.
- Every known future route is already registered in `app/(tabs)/_layout.tsx` as a hidden `Tabs.Screen` (`href: null`) with a stub backing file, so adding a screen means filling in the stub, never touching the layout. A `Tabs.Screen` without a file throws at runtime, which is why the stubs exist rather than the registrations alone.
- Changes that genuinely need one of the seven — a new dependency, a config plugin, a new shared prop — go through a single integrator as a small standalone PR, not as part of a feature slice.

The point is contention: these files are the ones every parallel slice would otherwise edit at once, and a rename or a prop added in two branches at the same time is a merge conflict in the one place that breaks the whole app.
