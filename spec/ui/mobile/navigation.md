# Mobile Navigation

> The locked 4-tab information architecture, the More hub, the global entries that live outside the tab bar, deep links, and typed-route rules.

Visual truth: [`../design-system/reference/canvas-screens.dc.html`](../design-system/reference/canvas-screens.dc.html) — the tab bar is drawn on s04, s06, s08, and s09. Screen ids reference [`screens.md`](screens.md).

## Tab bar — 4 tabs, locked

| Position | Tab | Route | Notes |
| -------- | --- | ----- | ----- |
| 1 | **Chat** | `(app)/(tabs)/index.tsx` | Home. The app opens here — chat is home. |
| 2 | **Events** | `(app)/(tabs)/events.tsx` | |
| 3 | **Tasks** | `(app)/(tabs)/tasks.tsx` | Absorbs points (balance + rank at top of board). |
| 4 | **More** | `(app)/(tabs)/more.tsx` | Hub for everything else (below). |

- There is **no Home tab**. This is a locked decision; do not reintroduce one.
- Known stale reference: panel 4g ("Mobile chrome") of [`../design-system/reference/signet-design-system.dc.html`](../design-system/reference/signet-design-system.dc.html) draws a 5-tab bar. It is wrong — the Canvas header and all 23 screens lock 4 tabs, and Canvas wins per the precedence rules in [`../README.md`](../README.md).
- The bar previously showed six tabs — Home, Chat, Events, Points, Profile, More. It now shows these four; Home and Points are gone as screens, and Profile moved to the More hub per [`screens.md`](screens.md).
- Tab icons are duotone per [`../design-system/iconography.md`](../design-system/iconography.md); active/inactive treatment and colors per [`../design-system/foundations.md`](../design-system/foundations.md). They are `react-native-svg` components in `apps/mobile/components/tab-glyphs.tsx` drawing the shared nav set (`@repo/theme/nav-glyphs`, Phosphor duotone shapes; iconography §1.1), the same shapes as the web sidebar. Since 2026-11-05 they no longer copy the Canvas tab bar's geometry: its hand-drawn set read as plain outlines on charcoal.
- Every route outside these four is pushed on the stack above the tab bar and reached by navigation, never as a hidden tab ([§ Going back](#going-back)).
- **The bar floats, as glass** (owner pick 2026-11-05, "Floating bar, no glow"). It is a capsule 62pt tall and fully round, inset 14pt from each side and lifted off the bottom edge (`floatingTabBarBottom` in `apps/mobile/lib/floating-chrome.tsx`): over a home indicator or gesture bar it tucks 8pt into the inset, as iOS's own floating bar does (26pt off the edge on an iPhone), it keeps 12pt off an edge with no inset, and it sits 4pt above Android's taller three-button bar. It is drawn by `GlassSurface` over the content, per [`foundations.md` § 15. Glass](../design-system/foundations.md#15-glass), with no shadow and no glow. The content scrolls under it, so every screen it sits over ends its scroll the bar's height plus 14pt above the bar's top (`useTabBarClearance`, which `ScreenShell` and s13's list apply), and a screen pushed over the tabs gets none. The board draws a flat bar on the bottom edge; this is a recorded departure, made so the mobile chrome reads like web's. `lib/tab-layout.spec.tsx` pins the geometry, `lib/floating-chrome.spec.tsx` the offsets and the clearance, and `components/screen-shell.spec.tsx` that the shell pads by it.
- **Every pushed screen takes the whole window, over the tab bar** (2026-11-06, [§ Going back](#going-back)). The board draws s05, s07 and s10–s22 without a bar, and the app now does too. A conversation's composer is the last thing on screen, as in every messaging app, and an officer projecting s22's QR has no tabs under it to tap away mid-hosting. Each draws its own way out (a back capsule, s05's `‹`, the ✕ on s18 and s22), takes the bottom safe-area inset itself, and goes back by the platform's gesture. s05's image viewer covers the whole window with it ([#2889](https://github.com/pdcarlson/Frapp/issues/2889)). From 2026-11-05 to 2026-11-06 s07 and s10–s16 kept the bar, a recorded departure argued as "the four tabs stay one tap away rather than behind a back row". It was dropped because keeping it meant registering those screens as hidden tabs, and a tab switch has no back gesture: Paul, testing 0.9.2 on iOS, could not swipe back from a channel to the channel list ("give the users what they'd expect"). The tabs are now one swipe away. `apps/mobile/lib/tab-layout.spec.tsx` pins that the stack registers every pushed screen with no header and the gesture on, and that each takes the bottom inset.
- **No screen draws a navigator's header** (`headerShown: false` on the tabs and on the stack, [#2485](https://github.com/pdcarlson/Frapp/issues/2485)). The board draws none: each screen's top is its own, through `ScreenShell` or its own bar (s05's `‹ #name`, s22's `✕ End`), so the header only said the screen's title again above it. A pushed screen's drawn way back is its back capsule ([§ Back rows](#back-rows)), s05's `‹`, or the close control on s18 and s22. `apps/mobile/lib/tab-layout.spec.tsx` renders both layouts and fails if either turns the header back on, for the whole navigator or for any registration in it, whether its options are an object or a function. It renders no route, so an override a route sets for itself (a `<Stack.Screen options>` inside the route file, or `navigation.setOptions`) is outside what it can see; don't add one. (`useHoldSwipeBack`'s `setOptions` is the one exception, and it touches only the gesture.)
- **Chat home (s04) is the one title the board doesn't draw.** The board opens s04 on its UP NEXT row. The app titles it with the chapter's name and mark instead, because [`../../behavior/branding.md`](../../behavior/branding.md) § Chapter mark makes that row the mark's one mobile surface inside a chapter (chapter setup previews it before the chapter exists, #3351). That is a recorded departure, not drift to restore from the board. Before #2485 the screen drew two title rows there, the header's chapter name and the shell's "Chat".

## More hub (s09)

Row anatomy, as drawn: duotone glyph, label, trailing status, chevron. No row carries a description line. The screen opens on a profile card (avatar, name, points balance, chevron to s15) and groups its rows below it.

The app groups the rows differently from the board, by owner decision on 2026-11-04 (#1048): the board draws one group from Study hours to Settings, while the app splits it into chapter tools and then your own settings and chapter switcher, so the two rows the board never drew sit with their kind instead of trailing the list.

The board's Notifications row is not in the app's More: the inbox is the bell on Chat home ([§ Global entries outside the tab bar](#global-entries-outside-the-tab-bar), #3362).

| Group | Row | Destination | Trailing status |
| ----- | --- | ----------- | --------------- |
| — | Profile card (avatar, name, points) | `profile.tsx` (s15) | chevron |
| Chapter tools | Study hours | `study.tsx` (s10) | this week's total, e.g. "4.0 hrs" |
| | Service hours | `service-hours.tsx` (host of the s20 sheet) | — |
| | Dues | `dues.tsx` (s11) | the next bill's chip: warning hue for "Due Sept 15", destructive for "Past due Sept 15" |
| | Documents | `documents.tsx` (s12) | — |
| | Directory | `directory.tsx` (s13) | — |
| You | Settings | `preferences.tsx` (s16) | — |
| | Switch chapter | `(auth)/chapter-picker.tsx` | the current chapter's name. When `GET /v1/chapters` is empty the slot is **Create a chapter** instead, opening `(auth)/create-chapter.tsx` (#1084) |
| **Admin** (role-gated, captioned "Admin") | Host check-in | `host-check-in.tsx` (s22) | the next hostable event |
| | Adjust points | s23 sheet — **not rendered** until the sheet ships (#2300) | — |

The admin section renders only for members whose role grants the underlying permissions; ordinary members never see it. The board captions it with the viewer's role ("ADMIN · PRESIDENT") and draws a role chip on the profile card; neither is drawn, because no role name is readable on mobile (`/v1/users/me/permissions` returns permissions only).

Two rows above are not drawn in Canvas and exist for reachability:

- **Service hours** — `service-hours.tsx` is a live route hosting the s20 sheet, and without a row it would be unreachable.
- **Switch chapter** — the only in-app entry to `(auth)/chapter-picker.tsx` (a `frapp://chapter-picker` link also opens it). The picker is deliberately *not* forced on members whose token lacks an `active_chapter_id` claim (`apps/mobile/lib/auth-gate.ts` explains why claim-absence is not a destination), so it needs a door.

**Implementation status.** Every row above except Adjust points is routed, the admin section included — its gate landed with C4 of #937. The gate is `usePermissionList()` (a thin wrapper over `useMyPermissions()`) plus `can` from `@repo/validation` (`canAny` when a gate is composite), never a bare `permissions.includes(…)`: an owner's grant is the wildcard `*`, so a membership test would hide these rows from exactly the people they exist for. Today the section's gate is `events:update` alone — see Host check-in below.

Two things about that section are worth knowing before reading a device:

- **It renders for nobody until a token carries a chapter claim.** `useMyPermissions` is `enabled: !!chapterId`. The hook is on in both hosted projects; production still has no memberships, so issued tokens have no `active_chapter_id` and the permission set stays empty — Presidents included — until the first onboard. It fails closed, which is the right direction. Local (`supabase/config.toml`) and staging (seeded members) already show the section.
- **Host check-in resolves an event.** s22 reads an `eventId` param, so the row cannot be a bare link: it picks the next upcoming-or-still-checkable-in event and passes its id, and renders inert when there is none. **There is no Adjust points row.** The s23 sheet needs a member picker plus amount/category/reason and is unbuilt, and a row that renders disabled with nothing behind it is the "coming soon" shape App Review Guideline 2.1 rejects, so it was removed rather than drawn (#2300). It returns with the sheet; until then awarding and fining points is web-only. The section is gated on `events:update` alone for the same reason — gating it on `points:adjust` too would draw an empty Admin header for an officer who holds only that.

The drawn s16 also carries an inline `CHAPTER · ADMIN` group, gated on `chapter-config:view` and read-only except for its accent row (see [`screens.md`](screens.md) s16); its "Join code" row is omitted because chapters have no join code (joining runs through single-use, expiring invite tokens — see [`screens.md`](screens.md)).

## Global entries outside the tab bar

- **UP NEXT strip** (s04): the top of Chat home carries an UP NEXT section — the next event and the nearest due task as compact rows, each tapping through to its detail (event detail s07, task board s08). It is a pulse affordance: chat is home, so the one glanceable "what's next" surface rides above the channel list rather than living in a Home tab.
- **Notifications bell** (s04): a bell on Chat home's title row, beside the ✦ Ask pill when the build has Ask, opens the notification inbox (s14, `notifications.tsx`). It badges the unread count in fixed house gold, never the chapter accent, as the web bell does ([`../design-system/components.md`](../design-system/components.md) § App bar chips): it sits beside the channel rows' mention-red badges, and an accent-filled count could read as a mention. It counts unread rows whose target is not chat, because the channel rows below already badge those messages and reading a thread does not clear its inbox row (the same split as the app-icon badge, `lib/notifications/use-badge-sync.ts`). It reads the count in its accessibility value, and it is in every build. The board draws no bell; it draws Notifications as a row in More (s09). The bell replaced that row by owner decision on 2026-11-04 ([#3362](https://github.com/pdcarlson/Frapp/issues/3362)): Chat is the home tab, so the count belongs where the member lands, and that is where the web keeps it too (the top bar's bell). Because the bell now means "inbox", a channel's alert-level control draws a speaker instead (`components/chat/mute-glyph.tsx`, [`../design-system/iconography.md`](../design-system/iconography.md) §6.2.2). `components/chat/notifications-bell.tsx`; `lib/chat/chat-home.spec.tsx` and `lib/ask/entry-points.spec.tsx` (Ask on and off) pin it.
- **✦ Ask pill** (s04, s06): a sparkle pill in the top bar of Chat home and Events opens the Ask sheet (s17). Ask is a global entry, not a tab — it MUST NOT become a fifth tab. Answer behavior and corpus rules: [`../../behavior/ai.md`](../../behavior/ai.md). Both halves now exist: the s06 pill landed with C7 (#998), which is also when the pill stopped navigating and started **presenting** — s17 is a sheet its host screen owns, so the pill takes an `onPress` and the host holds the `BottomSheetModal` ref ([`patterns.md`](patterns.md) § Bottom sheets). **The pill exists only in a build that has Ask.** With `EXPO_PUBLIC_ASK_ENABLED` off (the default; `apps/mobile/lib/ask/flag.ts`) neither host draws it, the sheet renders nothing, and the `ask` route redirects to Chat home, so a build without Ask shows no Ask surface anywhere.

  > **Reversed 2026-09-22, owner decision ([#2259](https://github.com/pdcarlson/Frapp/issues/2259)).** This bullet used to require the opposite: the pill "presses through even when Ask is switched off … the sheet states the reason, because a control that silently does nothing is the dead end §5 bans". The sheet then read "Ask isn't switched on for this build yet". That argument holds for a member who knows Ask is coming, but App Review is the other reader: a prominent control on the first screen after sign-in whose only function is to announce that its feature is off is the placeholder Guideline 2.1 rejects. Nor is it the dead end the old rule was guarding against. That rule bans a control that is *present* and does nothing; a control that is not drawn has nothing to discover. The line between the two is [`../design-system/README.md`](../design-system/README.md) §5 rule 4, *disable, don't hide, for recoverable states*, which names this pill as one of the things to hide: no member can switch Ask on, and the pill has no function but Ask, so it is hidden, like a module the chapter has switched off. That is the Ask pill's case, not a rule for every build-time switch. The push primer, also gated at build time, was left open here and has since followed it: s03 omits the card when the build cannot push ([#2299](https://github.com/pdcarlson/Frapp/issues/2299), 2026-09-24; [`patterns.md`](patterns.md#push-notifications) § Push notifications). (The old text also cited `components.md` §5, which is Badges and chips; the rule was always in the design-system README.)
  >
  > **Why dues' Pay control does not follow.** `lib/payments/stripe.ts` gates on a build-time value too, and it still renders Pay disabled with its reason. The difference is what the control is for. Pay sits on an invoice the member really owes, so the disabled control is one route through a real task, and its caption names the other ("Ask your treasurer how to pay this invoice"). The ✦ pill has no function except Ask. Keep the two distinct, rather than "fixing" either to match the other.
  >
  > The board (`canvas-screens.dc.html`) draws s04 and s06 with the pill. That is the with-Ask state, so a build without Ask showing no pill is not drift from the board.
  >
  > `apps/mobile/lib/ask/entry-points.spec.tsx` pins the behaviour: no pill on s04 or s06 and a redirect from `ask` with the flag off, and the pill presenting the sheet with it on.

## Going back

Every screen outside the four tabs goes back by the platform's own gesture, as a member expects of any app (Paul, 2026-11-06: "On every screen, I should be able to swipe to the left to get back"). On iOS that is the edge swipe from the left; on Android it is the back button, or the back gesture from either edge.

- **The tabs sit in a stack** (`app/(app)/_layout.tsx`, a native stack). The four tabs are its bottom screen (`app/(app)/(tabs)/`), and every other screen is pushed over them. A pushed screen slides in, covers the tab bar, and the gesture pops it to whatever opened it: the channel list under a channel, Events under an event opened from Events, Chat home under the same event opened from Up next, the inbox under a screen a notification opened. Before 2026-11-06 the pushed screens were hidden tabs (`href: null`), and a tab switch has no back gesture at all, so none of them could be swiped away on iOS.
- **No route turns the gesture off.** A screen may hold it for a moment, where the swipe would lose something of its own (`useHoldSwipeBack` in `apps/mobile/lib/back-target.ts`): s05's photo viewer holds it while it is open, so a drag that pans a zoomed photo can't close the conversation, and create-chapter holds it on its confirm and colour steps, so the swipe can't pop the whole flow and drop what was entered. Android's back closes such an overlay first (`useBackToClose`, [`patterns.md`](patterns.md)). Bottom sheets need no hold: they draw over the stack, so a swipe on one never reaches the screen under it. `lib/routes.spec.ts` fails if the stack's layout sets `gestureEnabled`, and `lib/tab-layout.spec.tsx` if any registration does.
- **One exception: steps inside one sign-in route.** Sign-in's email form, join's later views and create-chapter's steps are states of one route, so on iOS the swipe can't step back through them (the bottom route has nothing to pop to, and create-chapter holds it, above), while the drawn ‹ and Android's back step back one step. Making each step a route of its own is [#3586](https://github.com/pdcarlson/Frapp/issues/3586).
- **Every drawn way back does what the gesture does.** The back capsule, s05's `‹`, s22's `✕ End` and s18's ✕ pop the stack too, and the capsule names the screen it pops to ([§ Back rows](#back-rows)). A drawn control that went somewhere other than the swipe would be two answers to one question. s18's ✕ and "Back to event" pop only when the event's detail is under them, and otherwise pop down to it, taking s18's place, so "Back to event" always lands on the event.
- **A link always has the tabs under it.** The stack anchors the tabs (`unstable_settings.anchor`), so a screen opened cold by a notification tap or a `frapp://` link has Chat home under it to go back to. Chat home under a linked screen doesn't make its launch jump to the last channel: that launch went where the link points.
- **Going to a tab pops down to it.** A notification whose target is a tab (Tasks, for a task or points notification), a drawn way back with nothing under it to pop, and the old `frapp://ask` link all pop the stack down to the tabs and switch to the tab (`dismissTo`, through `openHref` and `goBackTo` in `apps/mobile/lib/href.ts`). Pushing a tab, navigating to one, or replacing a pushed screen with one would each stack a second copy of the tab navigator, tab bar and all, over the screen: expo-router's stack reuses a route only when it is already on top.
- **On a tab, back goes to the tab the member came from**, not straight to Chat home (`backBehavior="history"` on the tab navigator, 2026-11-05). On Chat home with nothing behind it, Android's back leaves the app.
- **A screen closes when the member goes back.** A pushed screen unmounts when it is popped and starts fresh the next time it is opened, where a hidden tab used to stay mounted for the whole session. What must outlive a visit is kept outside the screen: a composer's typed text is a draft (`apps/mobile/lib/chat/draft-store.ts`), and Dues' captured payments, which hold an invoice until the server reads it PAID, are kept for the session (`apps/mobile/lib/dues/visit-memory.ts`), so a member who swipes out of Dues right after paying, or even while the payment sheet is still up, doesn't come back to a live Pay on the same invoice. Each Dues reads that memory again when it comes into view, so a second Dues opened over the first (from a notification) can't be undone by the first one's older list.
- **Android's predictive back animation is off** (`android.predictiveBackGestureEnabled: false` in `app.json`, Expo's default). The back gesture works; the preview of the screen underneath while dragging does not draw yet.

## Back rows

A screen reached from another one draws a back row above its title, as the board draws `‹ Events` on s07 and `‹ More` on s10–s16 ([#3022](https://github.com/pdcarlson/Frapp/issues/3022)). A tab's own screen draws none. The row is `BackRow` in `apps/mobile/components/back-row.tsx`, passed to `ScreenShell` as `back`; s13, which draws its own header, draws it itself through `PinnedBackRow`.

- **It is a glass capsule, pinned** (Paul, 2026-11-05: "like a bubble around ‹ Events"). The `‹` and the label sit in a `GlassSurface` 36pt tall and fully round, sized to its label, the same glass as the tab bar, centred in a 44pt touch target (the target is the row itself, since a hit slop outside the clipping glass takes no touches). It is pinned to the top of the screen's content (`PinnedBackRow`, inside the safe area rather than offset by the inset, so it moves down with the content when the offline banner takes the top), stays in reach while the page scrolls under it, and the page's title starts below it. The `‹` is a drawn chevron, not a typed character. A press lifts the capsule to `popover`, as a list row does. The board draws a bare text row; this follows the tab bar's departure.

The row names the screen it pops to, so these are the rows a member sees arriving the usual way. Arriving another way, the row says where that way leads: `‹ Chat` over an event opened from Chat home's Up next, `‹ Notifications` over Dues opened from the inbox.

| Screen | Usual way in | Row |
| ------ | ------------ | --- |
| s07 Event detail | Events | `‹ Events` |
| s10 Study hours, s11 Dues, s12 Documents, s13 Directory, s15 Profile, s16 Settings, Service hours | More | `‹ More` |
| s14 Notifications | The bell on Chat home | `‹ Chat` |

- **It pops the stack, as the swipe does, and names what it pops to** (2026-11-06, [§ Going back](#going-back)). The label is the title of the screen under it (`useScreenBelow` in `apps/mobile/lib/back-target.ts`, from `SCREEN_TITLES`), or the tab the tabs are showing. Each screen still passes a fixed label and destination (`BACK_TO_MORE`, `BACK_TO_EVENTS`, `BACK_TO_CHAT`), which the row uses only with nothing under it. Until 2026-11-06 the row always went to that fixed destination, because the screens were hidden tabs and `router.back()` could land somewhere the label didn't say; on the stack, going back always lands on what the label names.
- **s15 draws Edit at the row's far end**, as the board does (`‹ More` … `Edit`), through `ScreenShell`'s `backAction` ([#3387](https://github.com/pdcarlson/Frapp/issues/3387)). It appears only over a loaded profile.
- **s12's upload moved off the row** (2026-11-05). It is s12's floating create button, bottom right above the tab bar, for a viewer holding `chapter_docs:upload` only, opening s21 ([#3399](https://github.com/pdcarlson/Frapp/issues/3399), [`patterns.md` § Create actions](patterns.md#create-actions)).
- **Every state of a screen draws it**, the loading and error states included: a link to an event that's gone lands on s07's error state, and that state still needs a way out.
- **A screen's render-error fallback is the one exception** ([#3378](https://github.com/pdcarlson/Frapp/issues/3378)). It replaces the whole screen, its own back row included, and it is one component for every route, so it doesn't draw each screen's row. On a pushed screen, which covers the tab bar, it draws a back row (popping to the screen under it, or `‹ Chat` with nothing there), since otherwise only the swipe leads out; on a tab the tab bar is the way out and it draws none. The two navigators hand their screens different layouts (`stackScreenLayout` and `screenErrorLayout` in `apps/mobile/components/route-error.tsx`), and `components/route-error.spec.tsx` pins both cases. Copy: [`writing.md` § Mobile render errors](../design-system/writing.md#mobile-render-errors).
- **s14 draws `‹ Chat`, not the board's `‹ More`**, because its entry moved to the bell on Chat home ([§ Global entries outside the tab bar](#global-entries-outside-the-tab-bar), [#3362](https://github.com/pdcarlson/Frapp/issues/3362)). Service hours, which the board never drew, opens from a More row and draws `‹ More` like its neighbours.
- It is drawn in the chapter accent (`useChapterBranding().accent`), as s05's `‹` is. The board draws it gold because its chapter is gold; inside a chapter every back arrow and inline action takes the chapter's accent ([`branding.md` § Accent Color](../../behavior/branding.md#accent-color), owner rule 2026-11-04). It was fixed `gold.askText` until 2026-11-05, which read as a stray gold control beside a purple or red chapter.
- **`(auth)` draws the same row in house gold** (`BackRow house`, `gold.askText`), because nothing there is inside a chapter. Sign-in's email form, s02's invite and confirm steps and chapter setup draw `‹ Back`, which steps back one view inside their own route (`onPress`) and holds while a request is in flight (`disabled`). On setup's find step, its first, the row leaves the route instead: `router.back()` to what opened it, or `router.replace('/join')` when nothing is behind it. The chapter picker draws `‹ More` only when More's Switch chapter opened it, which passes `from: "more"` to say so, and goes back with `router.back()` rather than navigating, because `(tabs)` is already under it. Opened by a link it draws no row: `(auth)`'s anchor puts sign-in under a linked screen, so "something to go back to" (`router.canGoBack()`) can't tell the two apart. Like the `‹ Back` rows, it holds while a chapter switch is in flight.
- Pinned by `components/back-row.spec.tsx` and `components/screen-shell.spec.tsx`, and per screen by the screen specs (`lib/events/event-details-screen.spec.tsx`, `lib/more/back-rows.spec.tsx` and the other `lib/**/*-screen.spec.tsx` files, s07's and s15's loading and error states included), through `test/back-row.ts`.

## Launch

Launch opens the last channel the member was in, then back goes to chat home (s04), the way Discord does (owner, 2026-11-05). Once per app process and only at launch (a list that answers late, or a member who has already left chat home, gets no jump), and a notification tap that launched the app wins. The rule and its fallbacks: [`spec/behavior/chat/README.md` § Where Chat opens](../../behavior/chat/README.md#where-chat-opens). Implementation: [`apps/mobile/lib/chat/last-channel.ts`](../../../apps/mobile/lib/chat/last-channel.ts).

## Deep links

- Scheme: `frapp://` (`scheme` in `apps/mobile/app.json`). It is permanent, because every installed binary carries it (ADR-25). [`mobile-permanent-identifiers.test.mjs`](../../../scripts/ci/__tests__/mobile-permanent-identifiers.test.mjs) pins it, with the binary's other permanent identifiers.
- **`frapp://join?token=…` fills s02.** The same query keys web `/join` uses (`token`, then `invite`, then `code`) are accepted on the app scheme and as a pasted URL in the field.
- **`frapp://event-details` is a contract.** Exported `.ics` files carry it as their deep-link URL, `frapp://event-details?id=<event id>` (`apps/mobile/app/(app)/event-details.tsx`), and those files live on in members' device calendars indefinitely. The route filename, the URL and its `id` param MUST never change. The same lock pins the URL and the param, and `apps/mobile/lib/routes.spec.ts` pins the route.
- **First-officer creation is `(auth)/create-chapter`.** The route is exempt from the authenticated bounce into the tabs so a successful onboard does not yank the officer off the invite step (`spec/behavior/onboarding.md`).
- **Magic-link auth callback:** sign-in email links redirect to `Linking.createURL("/")` with a trailing `?` (`emailRedirectTo` in `apps/mobile/lib/auth-session.tsx`), which expo-linking resolves **at runtime to whichever scheme owns the running app** — `frapp:///?` in a build that owns the scheme, but `exp://<host>:8081/--/?` under Expo Go. The trailing `?` lets the hosted Magic Link template append `&token_hash={{ .TokenHash }}&type=magiclink` onto `{{ .RedirectTo }}` the same way web's `/auth/callback?next=…` does, so the emailed href never uses `*.supabase.co/auth/v1/verify`. Both forms must be allowlisted in Supabase Auth's redirect URLs for magic-link sign-in to complete. `frapp://**` **is** allowlisted on both hosted projects since 2026-09-06 (`docs/ops/deployment/supabase.md` § Auth settings), so a real build completes; the Expo Go form embeds a per-machine host, so it cannot be allowlisted once and reused across developers. Tracked as issue #765 — allowlisting `frapp://` does not unblock Expo Go. `AuthSessionProvider` accepts implicit tokens, PKCE `code`, and `token_hash` (`verifyOtp`) on that scheme.
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

A missing `active_chapter_id` claim is still not a destination — see `lib/auth-gate.ts`. `(app)/_layout.tsx` is frozen and still only redirects to sign-in; walking a member *out* of the tabs onto s02/s03 or the Terms prompt is `AppRuntime` (`lib/onboarding/use-onboarding-redirect.ts`) so that file does not have to thaw.

## Typed routes

- `typedRoutes` is enabled (`experiments.typedRoutes` in `apps/mobile/app.json`), so route strings are compile-checked against the file tree **during local development**.
- **They are not checked in CI.** The generated types live in `.expo/types` and `expo-env.d.ts`, both gitignored (`apps/mobile/.gitignore`) and written only by `expo start`. CI runs a bare `tsc`, and with those files absent `Href` widens back to `string` — a nonexistent path assigned to `Href` type-checks clean. Do not rely on the compiler to catch a bad route on a branch.
- **`apps/mobile/lib/routes.spec.ts` is the guard that actually runs.** It walks the real route tree and resolves route literals against it, and asserts the tab bar registers exactly the four locked tabs with a backing file behind every registration. A rename that misses a call site fails there.
- **Know what that guard does not cover.** It matches *double-quoted string literals* at `href="…"`, `href: "…"`, `asRoute("…")`, `router.replace|push|navigate("…")`, and `pathname: "…"` — the last added with C1 (#937), whose chat list is the first screen to navigate with a param and therefore the first to use the object form `router.push({ pathname: "/chat-thread", params: { channelId } })`, which every other pattern misses. A route built from a template literal, a variable, or a prop is still invisible to it, which is why the More hub's rows navigate with literal `router.push("…")` calls rather than passing a route through a prop. It also only checks that literals resolve, never that a route has an inbound link, so an orphaned route stays green. When you add a route, add its entry point in the same change; neither gate will remind you.
- All renames and removals in [`screens.md`](screens.md) MUST still land in **one PR** — a partial rename leaves half the app's links broken whether or not a compiler notices.
- `asRoute()` in `apps/mobile/lib/href.ts` is the sanctioned escape hatch for static paths that typed-route generation misses. It MUST NOT be used to paper over a route the type-checker correctly rejects. Note it takes a plain `string`, so it defeats the dev-time check entirely — `routes.spec.ts` is what keeps its call sites honest.

## Hotspot freeze

Eight files are **frozen** now that the nav restructure has landed:

`app/_layout.tsx` · `app/(app)/_layout.tsx` · `app/(app)/(tabs)/_layout.tsx` · `lib/theme.tsx` · `components/screen-shell.tsx` · `lib/href.ts` · `package.json` · `app.json`

- Slices that build screens **only add files**. They do not edit the eight.
- Every known future route is already registered in `app/(app)/_layout.tsx` as a `Stack.Screen` with a backing file, so adding a screen means filling in the file. A new route goes in `app/(app)/`, on the stack, never in `app/(app)/(tabs)/`, where expo-router's tab navigator would draw it as a fifth tab (`lib/routes.spec.ts` fails on one). Until 2026-11-06 the routes were hidden `Tabs.Screen`s in the tab layout, which left them with no back gesture ([§ Going back](#going-back)).
- Changes that genuinely need one of the eight — a new dependency, a config plugin, a new shared prop — go through a single integrator as a small standalone PR, not as part of a feature slice.
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
surfaces themselves were still unbuilt then and landed as their own slices.
*Corrected 2026-11-05 (this sentence used to call them still unbuilt):* all three have
since shipped as photo-library picks, s15's avatar photo (#2897), s21's upload (#3399)
and, last, s20's proof attachment (2026-11-05), each dated below. What is still unbuilt
is the file half of the last two: a PDF or Office file on s21 needs
`expo-document-picker`, which can only ship in a store build, and
[#3401](https://github.com/pdcarlson/Frapp/issues/3401) adds it there and decides
whether s20's proof takes a PDF from Files too.

**Both were removed again** (#2296) — the three surfaces were still unbuilt a month
later, and the declarations were not merely premature but actively harmful. The
`photosPermission` string shipped in the binary as a purpose string for a feature that
does not exist (Guideline 5.1.1(i)), and the `cameraPermission: false` above compiled
to `withBlockedPermissions(['android.permission.CAMERA'])`, which *removed* the
permission `expo-camera` contributes and wrote `tools:node="remove"` into the manifest —
silently breaking QR check-in (`app/(tabs)/check-in.tsx`) on every Android build. The
declining-a-permission half is the reusable lesson: a plugin option that declines a
permission is not inert, it overrides other plugins, so it can only be set for a
permission nothing in the app requests. `scripts/check-mobile-native-declarations.mjs`
pins both halves in `mobile-validate`. It reads the Info.plist and AndroidManifest that
`expo config --type introspect` resolves, rather than `app.json`: the exact iOS purpose
strings, and no `tools:node="remove"` on a permission a screen requests. So re-adding
this picker the same way fails CI rather than shipping. *Updated 2026-09-30 (#2343):*
the `app.json`-level assertions in `app.config.spec.ts` that this replaced weren't an
airtight fence. An option left *omitted* inherits its plugin's default purpose string,
and a vendor option spelled something other than `*Permission`/`*UsageDescription`
wasn't scanned. The introspected gate sees both, because it reads what the mods write.
Re-add the dependency and its plugin entry in the slice that actually builds a picker
surface — which is what #1045 should have been.

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

*2026-09-30:* the profile photo on s15 (#2897, `lib/more/profile-photo.ts`) is the
picker's second caller, through the same `pickAndUploadImage`. #2895 edited `app.json`
as an integrator change so `photosPermission` names both uses ("set your profile photo
and send photos in chapter chat"), with the privacy policy and the store records in the
same PR.

*2026-11-04:* chapter setup's live step (#3351,
`lib/onboarding/chapter-wizard/chapter-logo.ts`) is the third caller, adding the chapter's
logo. `photosPermission` names it too ("add your chapter's logo"), as do the store records
and the privacy policy's permissions clause. The owner ruled that policy edit non-material
([#3395](https://github.com/pdcarlson/Frapp/issues/3395)), so it moved only the page's pin
(`legal.md` § Acceptance record).

*2026-11-04:* s21's document upload (#3399, `lib/more/document-upload.ts`) is the fourth
caller, through `pickImage`, the pick half of the same pipeline. It needs no native
change, so it ships over the air, but the compiled `photosPermission` text can only
widen in a store build: #3401 does that with `expo-document-picker`, and the store
records with it *(superseded 2026-11-05: widened on its own, see below)*. The privacy policy is a web page, so it names the new use in the
same PR (ruled non-material by the owner, 2026-11-04).

*2026-11-05:* s20's photo proof (`lib/more/service-proof.ts`) is the fifth caller,
through `pickImage` and the PUT half of the same pipeline, attaching a photo to a
service entry. Like the fourth it needs no native change and ships over the air, and
`photosPermission` can only widen in a store build, so
[#3401](https://github.com/pdcarlson/Frapp/issues/3401) widens it to name service-hour
proof alongside document uploads, with the store records *(superseded 2026-11-05: widened
on its own, see below)*. The privacy policy's
permissions clause names it in the same change, moving only the page's pin on the
#3395 precedent; whether that edit is material, and what each ruling does, is
[`legal.md` § Acceptance record](../../behavior/legal.md#acceptance-record)'s.

*2026-11-05, later:* the purpose string was widened on its own, ahead of #3401's Files
picker, so the 0.9.1 store build carries it. `photosPermission` now names all five
callers ("send photos in chapter chat, add photos to your chapter's documents, and attach
photo proof to service hours"). #3401 keeps the picker and #2620.

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
  unread-pin note above. `scripts/check-mobile-native-declarations.mjs` pins its text
  in `IOS_PURPOSE_STRINGS` with the call that requests it, so declining it fails CI.
  *(Moved 2026-09-30, #2343, from `app.config.spec.ts`'s `REQUESTED_AT_RUNTIME` list.)*

*Corrected 2026-11-05:* "decline what nothing requests" is not the whole rule on iOS.
App Store Connect's upload scan flags some APIs a linked library references and rejects
the binary when their key is missing (ITMS-90683), whether or not the app ever asks.
`expo-location` links `CMMotionActivityManager` for its motion permission requester, so
its `motionUsagePermission: false` got iOS 0.9.1 (8) rejected. The option now carries a
string that says Frapp never asks, and `IOS_PURPOSE_STRINGS` pins it as a linked-only
entry: `requestedBy: null` and a `linkedBy` naming the pod, the symbol and the JS request.
The gate fails if the key is declined again, asks for its removal once that pod stops
linking the symbol, and fails if the app ever makes the request the text disowns. The
scan doesn't flag every linked API: the same upload named only the motion key, though
`expo-camera` links microphone access and `expo-secure-store` links Face ID, and both of
those stay declined as above. So a linked-only entry is added when Apple names its key,
and the declines above stand until it does.

The pairing is also pinned from the other side: `app.config.spec.ts` asserts a media
picker is depended on **only while a non-spec source file imports one**, which is the
check that would have caught #1045 shipping the dependency a month ahead of any
surface. `scripts/ci/__tests__/frapp-mobile-permissions.test.mjs` (then
`signet-mobile-permissions.test.mjs`; ADR-25 renamed it with the copy it locks) raised its
prompt floor from two to three with this slice, which is exactly what that file's block on
the floor going three to two (#2296) and back to three (#2464) said the raise was for.
*2026-09-30 (#2343):* the floor is gone. The introspected gate pins which prompts exist,
and the copy lock asserts only that they name Frapp. *2026-10-07 (#3225):* that copy lock is
now a row in `scripts/ci/__tests__/frapp-naming.test.mjs`, which replaced the thirteen per-surface
rename locks.

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

*Corrected 2026-09-24 (#2526):* "two required-reason categories" is now four, and two
bases above no longer hold. `CA92.1` rests on `expo-updates` as well as Stripe, so it is
not Stripe's alone. `C617.1` also covers the timestamp reads of pods whose own manifests
never ship: pod manifests reach the shipped file only through react-native's `pod install`
aggregation, which a static or precompiled pod skips. The same gap is why the manifest
gained `SystemBootTime`/`35F9.1` and `DiskSpace`/`E174.1`. `FileTimestamp`/`0A2A.1`, which
#2526 also listed, was left out: Apple reserves it for an SDK's own manifest. Which pods
fall through, and the basis for every row, are in `app.config.spec.ts`, which pins the
whole array; this note doesn't restate them.

**#2526 touched three of the seven, as an integrator change.** `package.json` gained
`expo-updates`, and `app.json` gained its `runtimeVersion` and `updates` keys (no plugin
entry: prebuild applies `expo-updates`' plugin by default) plus the two manifest rows
above. The first store binary is the only chance to ship an OTA client at all. `app/_layout.tsx`
gained `ClientPolicyGate` around `BottomSheetModalProvider`. That is a real edit to a
frozen file, and it can't live in `components/app-runtime.tsx`: the gate has to wrap the
sheet provider, or an open sheet draws over the update prompt. See
[`patterns.md`](patterns.md) § Minimum version.

**#2301 touched `app/(tabs)/_layout.tsx`, as an integrator change.** It removed the
`sheet-demo` registration along with its file, `app/(tabs)/sheet-demo.tsx`, the throwaway
#937 S1 smoke screen. Its `href: null` hid it from the tab bar but not from the router, so
`frapp://sheet-demo` would have opened developer scaffolding in the first store binary.
Its device checks now run on product screens
([`docs/mobile/testing.md`](../../../docs/mobile/testing.md#4-s1-foundation-smoke)).
The registration and the file went in one commit. A `Tabs.Screen` with no file throws at
runtime. A file with no registration is worse, because expo-router's `Tabs` renders every
child route and it would have become a fifth visible tab. `lib/routes.spec.ts` now fails on
either half-deletion (#2727).

**#2861 touched three of the seven, as an integrator change.** `package.json` gained
`react-markdown` and `remark-breaks`, at web's ranges, so chat renders markdown with web's
parser and plugins rather than a second parser that would disagree with web on edge cases.
Both were already hoisted for `apps/web`, so the lockfile changed only in `apps/mobile`'s
entry. The renderer that imports them is #2861's second PR, stacked on this change;
declaring them ahead of it is not the #1045 hazard above, since neither package carries
native code, a config plugin or a permission.
`app/_layout.tsx` now loads `FIGTREE_FACES` from `lib/theme.tsx`, which adds Figtree's
400 and 700 italic faces (`italicFontFamilyFor`); the three chat styles that set
`fontStyle: "italic"` moved to the face. Why an italic has to be a face of its own:
[`packages/theme/README.md` § Fonts](../../../packages/theme/README.md#fonts).

**#2485 touched `app/(tabs)/_layout.tsx` and `components/screen-shell.tsx`, as an
integrator change.** The layout turned the navigator's header off ([§ Tab bar](#tab-bar--4-tabs-locked) above) and
lost the header styling and Chat home's `headerTitle` with it. The shell took over what
the header had been doing: it takes the top safe-area inset, marks its title as the
screen's heading, and gained an optional `titleMark` slot before the title. Chat home
fills that slot with the chapter mark, which had been the header's title and is the mark's
one mobile surface inside a chapter (chapter setup previews it too, #3351) ([`../../behavior/branding.md`](../../behavior/branding.md) § Chapter
mark). Four screens opt out of the shell. s05 and s13 took the top inset themselves in
this change. s18 (`check-in.tsx`) and s22 (`host-check-in.tsx`) already took it, and
their own titles took the heading role the header's title used to carry.

**#3344 touched `app/(tabs)/_layout.tsx`, as an integrator change** (2026-11-04). The
first Play build drew the tab bar under Android's swipe bar: a fixed
`tabBarStyle.height` replaces the height React Navigation computes, so the bottom inset
it would have added was lost, and Android draws edge to edge. The layout now reads
`useSafeAreaInsets()` and adds the bottom inset to the bar's height and bottom padding,
so the 62pt row sits above the system bar. `lib/tab-layout.spec.tsx` pins the sum.

**Paul's Android pass touched `app/(tabs)/_layout.tsx`, as an integrator change** (2026-11-05). The chat thread, check-in and host check-in registrations hide the tab bar (`tabBarStyle`, through `FULL_WINDOW`), for the reason [§ Tab bar](#tab-bar--4-tabs-locked) gives, and the navigator takes `backBehavior="history"` so Android's back button returns to the screen a member came from ([§ Back rows](#back-rows)). No route or tab was added, removed or renamed, and no header option changed.

**#3023 touched `components/screen-shell.tsx`, as an integrator change.** `subtitle`
became optional and the shell draws no line when it is absent, and every caller was reviewed in
the same change. The lines that only said what a screen is for ("What you owe the
chapter, and what it has earned you.") were deleted (owner decision, 2026-11-04), and so
was the same kind of line in s13's own header, Directory's "Actives and alumni.". The board
draws neither. Event details is the one screen that still passes a subtitle, the event's
time (and its place, since 2026-11-05), because s07 is the one screen the board draws one on. Its loading, empty and error
states pass none. The rule itself lives in [`patterns.md` § Screen headers](patterns.md#screen-headers).

**#3022 touched `components/screen-shell.tsx`, as an integrator change.** The shell gained an optional `back` prop that draws `BackRow` above the title, and every screen the board draws a back row on passes one in the same change, each of their state screens included. It also edited `app/(tabs)/_layout.tsx`, comment only: the header comment that said the rows weren't drawn yet now points at the rule, which lives in [§ Back rows](#back-rows).

**#3450 touched `components/screen-shell.tsx`, as an integrator change** (2026-11-05, from Paul's 2026-11-04 Android notes). The title moved from the 18/600 title role to the 24/700 headline at -0.3 tracking, as the board draws s06, s08–s14 and s16, so a page title sits a level above the cards on it. s13's own header moved with it. No prop changed. The shell now exports `screenTitleStyle`, which s13 spreads instead of copying the values. The rule itself lives in [`patterns.md` § Screen headers](patterns.md#screen-headers).

**#3385 touched `components/screen-shell.tsx`, as an integrator change** (2026-11-05). The shell gained an optional `refresh` prop that puts a themed `RefreshControl` (`components/pull-to-refresh.tsx`) on its scroll view, and the nine list screens the issue names pass one in the same change: Directory, which draws its own `FlatList`, attaches the same control there. The issue asked for the prop on the shell rather than per screen, so the prop and its callers landed together. A screen that passes `refresh` passes it for its whole life, because adding or removing a scroll view's `refreshControl` remounts the list under it; a pull with nothing enabled to refetch does nothing.

**#3378 touched `app/_layout.tsx` and `app/(tabs)/_layout.tsx`, as an integrator change** (2026-11-05). Each exports expo-router's `ErrorBoundary`, which renders `AppErrorScreen` from `components/route-error.tsx` in place of the layout when it fails, and the tab navigator takes `screenLayout={screenErrorLayout}`, which puts every tab screen in its own boundary so one that fails leaves the tab bar working. No route, tab, header or screen option changed. The copy lives in [`writing.md` § Mobile render errors](../design-system/writing.md#mobile-render-errors); `components/route-error.spec.tsx` pins that both layouts still mount their boundaries.

**The glass change touched `app/(tabs)/_layout.tsx`, `components/screen-shell.tsx` and `package.json`, as an integrator change** (2026-11-05). `package.json` gained two native modules, `expo-blur` and `expo-glass-effect`, so the change ships in a store build, not over the air. The tab bar became the floating glass capsule [§ Tab bar](#tab-bar--4-tabs-locked) describes, through `tabBarStyle` and `tabBarBackground`, and `screenLayout` moved to `floatingScreenLayout` (`lib/floating-chrome.tsx`), which keeps #3378's boundary and tells each screen whether the bar sits over it. The shell pins the back row ([§ Back rows](#back-rows)), pads its scroll clear of the bar, and gained `createAction`, which draws the floating create button ([`patterns.md` § Create actions](patterns.md#create-actions)). No route or tab was added, removed or renamed.

**The swipe-back change touched `app/_layout.tsx`, `app/(app)/(tabs)/_layout.tsx` and `lib/href.ts`, and added `app/(app)/_layout.tsx`, as an integrator change** (2026-11-06). Every pushed route moved out of the tab group into `app/(app)/`, onto a native stack whose bottom screen is the tab group, so each can be swiped back ([§ Going back](#going-back)). The root stack's `(tabs)` became `(app)`, the auth gate moved from the tab layout to the new stack layout so it covers the pushed screens too, and the tab layout lost its hidden registrations and `FULL_WINDOW`. `lib/href.ts` gained `openHref`, which navigates to a tab and pushes anything else. Route paths didn't change (groups don't show in a path), so links, notification targets and `frapp://event-details` in exported calendar files still resolve; the redirects that named the group (`/(tabs)`) now name `/`.
