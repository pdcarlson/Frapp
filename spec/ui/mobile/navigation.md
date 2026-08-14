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
- Today's implementation (`apps/mobile/app/(tabs)/_layout.tsx`) shows six tabs — Home, Chat, Events, Points, Profile, More. It collapses to the 4-tab bar when the app is rebuilt against this spec; Points and Profile leave the bar per [`screens.md`](screens.md).
- Tab icons are duotone per [`../design-system/iconography.md`](../design-system/iconography.md); active/inactive treatment and colors per [`../design-system/foundations.md`](../design-system/foundations.md).
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
| Settings | `preferences.tsx` (s16) | — |
| **Admin section** (role-gated, labeled with the viewer's role, e.g. "ADMIN · PRESIDENT") | | |
| Host check-in | `host-check-in.tsx` (s22) | — |
| Adjust points | opens s23 sheet | — |

The admin section renders only for members whose role grants the underlying permissions; ordinary members never see it.

## Global entries outside the tab bar

- **UP NEXT strip** (s04): the top of Chat home carries an UP NEXT section — the next event and the nearest due task as compact rows, each tapping through to its detail (event detail s07, task board s08). It is a pulse affordance: chat is home, so the one glanceable "what's next" surface rides above the channel list rather than living in a Home tab.
- **✦ Ask pill** (s04, s06): a sparkle pill in the top bar of Chat home and Events opens the Ask sheet (s17). Ask is a global entry, not a tab — it MUST NOT become a fifth tab. Answer behavior and corpus rules: [`../../behavior/ai.md`](../../behavior/ai.md).

## Deep links

- Scheme: `frapp://` (`scheme` in `apps/mobile/app.json`). It stays `frapp` until the deferred repo rename; new docs still say Signet in prose.
- **`frapp://event-details` is a contract.** Exported `.ics` files carry it as their deep-link URL (`apps/mobile/app/(tabs)/event-details.tsx`), and those files live on in members' device calendars indefinitely. The route filename and the URL MUST never change.
- **Magic-link auth callback:** sign-in email links redirect to `Linking.createURL("/")` (`emailRedirectTo` in `apps/mobile/lib/auth-session.tsx`), which expo-linking resolves **at runtime to whichever scheme owns the running app** — `frapp://` in a build that owns the scheme, but `exp://<host>:8081/--/` under Expo Go. Both forms must be allowlisted in Supabase Auth's redirect URLs for magic-link sign-in to complete, and the Expo Go form embeds a per-machine host, so it cannot be allowlisted once and reused across developers. Tracked as issue #765 — note that allowlisting only `frapp://` does not unblock Expo Go.

## Typed routes

- `typedRoutes` is enabled (`experiments.typedRoutes` in `apps/mobile/app.json`): route strings are compile-checked against the file tree.
- Because of that, all renames and removals in [`screens.md`](screens.md) MUST land in **one PR** — typed routes reject a partial rename, leaving half the app's links broken.
- `asRoute()` in `apps/mobile/lib/href.ts` is the sanctioned escape hatch for static paths that typed-route generation misses. It MUST NOT be used to paper over a route the type-checker correctly rejects.
