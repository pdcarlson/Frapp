# Mobile Navigation

> The locked 4-tab information architecture, the You tab, the global entries that live outside the tab bar, deep links, and typed-route rules.

Visual truth: [`../design-system/reference/canvas-screens.dc.html`](../design-system/reference/canvas-screens.dc.html) — the tab bar is drawn on s04, s06, s08, and s09. Screen ids reference [`screens.md`](screens.md).

## Tab bar — 4 tabs, locked

| Position | Tab          | Route                       | Notes                                                                                                                                                                                                                                                   |
| -------- | ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | **Chat**     | `(app)/(tabs)/index.tsx`    | Home. The app opens here — chat is home.                                                                                                                                                                                                                |
| 2        | **Activity** | `(app)/(tabs)/activity.tsx` | What is waiting on the member, what they made, and This semester. The tab carries the count of things waiting on them (`needs_you_count`) as a house-gold badge, drawn only when there is one. Its title row's **Task board** control pushes the board. |
| 3        | **Messages** | `(app)/(tabs)/messages.tsx` | The member's direct and group messages ([`screens.md` § Messages](screens.md#messages)). The tab carries the count of conversations with anything unread as a mention-red badge, since a direct message addresses the member. It was a door on Chat home until #5310. |
| 4        | **You**      | `(app)/(tabs)/you.tsx`      | The member's own profile and everything else that is theirs ([§ You](#you-s09-and-s15)). Its glyph is the member's avatar.                                                                                                                              |

Owner pick 2026-11-12 (#4610, option A of the [proposal page](https://claude.ai/artifact/XfGctNGTLSbg2XdKk2jaip)), from the team's Discussion: Activity one tap away instead of a row in More (Evan), Paul's "chat, activity, calendar and the action menu", and Shawn's "chat, activity, events". Comparable apps: Slack and Microsoft Teams keep an Activity tab beside chat, Teams a Calendar tab, and TeamSnap opens on what needs you. Until then the bar was Chat, Events, Tasks and More, and Activity was More's first row (#3897).

Changed in #5310 by pdcarlson, 2026-11-17: the third tab is Messages; Calendar is a pushed month opened from Activity's Calendar row (Paul's direction B).

- **Messages is the third tab** since #5310 (Paul, 2026-11-17: "I hate the calendar page", and open to "a paradigm shift"). Instagram, LinkedIn and Facebook give the inbox its own place in the bar, and Activity's To do already lists the member's days, so the slot went to the conversations a member opens most. The tab's badge is the count of conversations (DMs and group DMs) with anything unread, a group DM whose thread has new replies included, in fixed mention red with "99+" past 99, the count Chat home's Messages door showed (`useUnreadConversationCount`, `apps/mobile/lib/chat/unread-conversations.ts`), and the tab's spoken name carries it ("Messages, 2 unread conversations"). Its glyph is the shared nav set's `direct` paper plane, the one web's sidebar draws beside Direct messages. Calendar (the `events` route) is a pushed screen, opened from the Calendar row at the foot of Activity's To do ([§ Global entries](#global-entries-outside-the-tab-bar)).

- **The task board (`(app)/tasks.tsx`) is a pushed screen** since #4610, not a tab. It absorbs points (balance + rank at top of board) as before. Its doors are Activity's Task board control and its This semester points gauge, a task on the calendar, Chat home's Up next, and a task notification. It goes back to Activity (`‹ Activity` when nothing is under it), and since a pushed screen covers the tab bar's +, it draws its own floating + for New task, for a role that can assign one ([`patterns.md` § Create actions](patterns.md#create-actions)).
- **The tab badge stays current** by re-reading Activity on every change of tab (`useActivityRereadOnTab`), on every visit to Activity, and on every return to the app, as More's row did on every return to More.
- **The fourth tab is You** since #3839, the fourth slot of option A. It was More until then: a hub whose first row was a profile card pushing a separate Profile screen, while Chat home's avatar opened the same Profile from its menu. Instagram, Slack, Discord and WhatsApp each draw the member as their last tab and open one screen there, so the two doors became one. The route is `/you`; `/more` and `/profile` are gone.
- **The You tab's glyph is the member's avatar** (`components/you-tab-avatar.tsx`), 24pt like the other glyphs: their photo, else their initials in their member tint, on `surface.popover` with a hairline, never filled with the chapter accent ([`foundations.md` § 6](../design-system/foundations.md)). A photo can't take the accent, so when the tab is active the avatar wears a 1.5pt ring in the accent with a 1.5pt gap, under the same bold accent label and capsule every active tab has. The member's picked status sits bottom-right, none while Online, and the tab's label names it ("You, Do Not Disturb").

- There is **no Home tab**. This is a locked decision; do not reintroduce one.
- Known stale reference: panel 4g ("Mobile chrome") of [`../design-system/reference/signet-design-system.dc.html`](../design-system/reference/signet-design-system.dc.html) draws a 5-tab bar. It is wrong — the Canvas header and all 23 screens lock 4 tabs, and Canvas wins per the precedence rules in [`../README.md`](../README.md).
- The bar previously showed six tabs — Home, Chat, Events, Points, Profile, More. It now shows these four; Home and Points are gone as screens, and Profile moved to the More hub per [`screens.md`](screens.md), then became the You tab (#3839).
- The first three tab icons are duotone per [`../design-system/iconography.md`](../design-system/iconography.md); active/inactive treatment and colors per [`../design-system/foundations.md`](../design-system/foundations.md). They are `react-native-svg` components in `apps/mobile/components/tab-glyphs.tsx` drawing the shared nav set (`@repo/theme/nav-glyphs`, Phosphor duotone shapes; iconography §1.1), the same shapes as the web sidebar. Since 2026-11-05 they no longer copy the Canvas tab bar's geometry: its hand-drawn set read as plain outlines on charcoal.
- Every route outside these four is pushed on the stack above the tab bar and reached by navigation, never as a hidden tab ([§ Going back](#going-back)). `GlassTabBar` draws its own fixed list of the four (`TAB_ROUTES`), and `lib/tab-layout.spec.tsx` fails if it and the tab navigator's four disagree.
- **The bar floats, as glass** (owner pick 2026-11-05, "Floating bar, no glow"; drawn by `GlassTabBar` in `apps/mobile/components/glass-tab-bar.tsx` since 2026-11-06, as the navigator's whole `tabBar`). It is a capsule 62pt tall and fully round, inset 14pt from each side (86pt from the right, leaving room for the quick-actions + beside it, [§ Quick actions](#quick-actions)) and lifted off the bottom edge (`floatingTabBarBottom` in `apps/mobile/lib/floating-chrome.tsx`): over a home indicator or gesture bar it tucks 8pt into the inset, as iOS's own floating bar does (26pt off the edge on an iPhone), it keeps 12pt off an edge with no inset, and it sits 4pt above Android's taller three-button bar. It is drawn by `GlassSurface` over the content, per [`foundations.md` § 15. Glass](../design-system/foundations.md#15-glass), with no shadow and no glow. The content scrolls under it, so every screen it sits over ends its scroll the bar's height plus 14pt above the bar's top (`useTabBarClearance`, which `ScreenShell` and s13's list apply), and a screen pushed over the tabs gets none. The active tab sits on a soft capsule (white at 8%, as iOS 26's own bars draw it) under its accent glyph and bold label. The board draws a flat bar on the bottom edge; this is a recorded departure, made so the mobile chrome reads like web's. `components/glass-tab-bar.spec.tsx` pins the geometry, `lib/floating-chrome.spec.tsx` the offsets and the clearance, and `components/screen-shell.spec.tsx` that the shell pads by it.
- **It folds while the member reads down** (#4904, Paul's pick of direction A on the [design page](https://claude.ai/artifact/NCtLdmLop59itrbC6Uku5d), 2026-11-17: "If you scroll down ... [it] gets shorter ... If you scroll back up ... it comes back ... to full"). Reading down a tab screen folds the pill to the current tab alone, a 62pt round the size of the +, and brings the Ask Frapp bar down into the same row between them at the row's height, its arrow dropped so the words keep the room: three pieces of glass, as Bevel's bar and iOS 26's own minimised tab bar draw it, and one row where there were two. Any move back up, the list's top or end, a tab change, or a tap on the folded round opens it again. When it folds and opens is `barFoldAfterScroll` in `lib/floating-chrome.tsx` (thresholds in `BAR_FOLD`), fed by every screen `ScreenShell` hosts (`useBarScroll`); a tab screen with its own list opts in the same way, and one that doesn't never folds. It folds only for a member who has the Ask bar, never while the + panel is open, and never under VoiceOver or TalkBack, so every tab stays a labelled control; the folded round reads "Messages, show all tabs". The pieces move together in 320ms; with Reduce Motion on (read live, so a change mid-session counts) they change at once. The tabs take touches again only once they are back in place, so a quick second tap on the round never lands on a tab. While folded, Activity's count stays in sight: the number on the round when Activity is the current tab, a house-gold dot on any other, and said in the round's spoken name. The first-run tour opens the bar before it measures its stops. The + never moves or resizes, so what it opens can change without the bar moving. If the tabs change, the folded row holds: it shows the current tab whatever their number, and with the tabs moved to a side menu (#4047) the folded row would be the bar at rest. `components/glass-tab-bar.spec.tsx` pins the folded geometry and when it doesn't fold.
- **Every pushed screen takes the whole window, over the tab bar** (2026-11-06, [§ Going back](#going-back)). The board draws s05, s07 and s10–s22 without a bar, and the app now does too. A conversation's composer is the last thing on screen, as in every messaging app, and an officer projecting s22's QR has no tabs under it to tap away mid-hosting. Each draws its own way out (a back capsule, s05's `‹`, the ✕ on s18 and s22), takes the bottom safe-area inset itself, and goes back by the platform's gesture. s05's image viewer covers the whole window with it ([#2889](https://github.com/pdcarlson/Frapp/issues/2889)). From 2026-11-05 to 2026-11-06 s07 and s10–s16 kept the bar, a recorded departure argued as "the four tabs stay one tap away rather than behind a back row". It was dropped because keeping it meant registering those screens as hidden tabs, and a tab switch has no back gesture: Paul, testing 0.9.2 on iOS, could not swipe back from a channel to the channel list ("give the users what they'd expect"). The tabs are now one swipe away. `apps/mobile/lib/tab-layout.spec.tsx` pins that the stack registers every pushed screen with no header and the gesture on, and that each takes the bottom inset.
- **No screen draws a navigator's header** (`headerShown: false` on the tabs and on the stack, [#2485](https://github.com/pdcarlson/Frapp/issues/2485)). The board draws none: each screen's top is its own, through `ScreenShell` or its own bar (s05's `‹ #name`, s22's glass ✕), so the header only said the screen's title again above it. A pushed screen's drawn way back is its back capsule ([§ Back rows](#back-rows)), s05's `‹`, or the close control on s18 and s22. `apps/mobile/lib/tab-layout.spec.tsx` renders both layouts and fails if either turns the header back on, for the whole navigator or for any registration in it, whether its options are an object or a function. It renders no route, so an override a route sets for itself (a `<Stack.Screen options>` inside the route file, or `navigation.setOptions`) is outside what it can see; don't add one. (`useHoldSwipeBack`'s `setOptions` is the one exception, and it touches only the gesture.)
- **Chat home (s04) is the one title the board doesn't draw.** The board opens s04 on its UP NEXT row. The app titles it with the chapter's name and mark instead, because [`../../behavior/branding.md`](../../behavior/branding.md) § Chapter mark makes that row the mark's one mobile surface inside a chapter (chapter setup previews it before the chapter exists, #3351). That is a recorded departure, not drift to restore from the board. Before #2485 the screen drew two title rows there, the header's chapter name and the shell's "Chat".

## Quick actions

Owner pick 2026-11-06, after the Bevel app's bar (its glass only, none of its look). Mockup: [quick-actions artifact](https://claude.ai/artifact/2PNJSvPHe5hdWyBcr1LTV3).

- **A round glass + sits beside the pill on every tab screen** (`GlassTabBar`): 62pt, the pill's height, 14pt in from the right, 10pt from the pill. It is drawn only on the four tabs: a pushed screen covers the bar, + and all ([§ Going back](#going-back)), and keeps its own create button where it has one ([`patterns.md` § Create actions](patterns.md#create-actions)).
- **Tapping it opens the panel above the bar and turns the + into an X** (a 45° turn). The panel is glass, the bar's width, and grows out of the + at its bottom right (a fade under Reduce Motion) over a 40% black scrim. The scrim, the X, Android's back, running an action, or moving to another screen closes it, and coming back to that screen leaves it closed. It holds the member's actions as a grid of 58pt round buttons with a label under each, always three to a row, filling from the left, at rest and while editing alike, so holding the panel moves nothing (`QUICK_ACTION_COLUMNS`). Six make two rows and nine make three (Paul, 2026-11-13: "they should be able to fit 3 sideways"). Each cell is a third of the row inside the glass's border, floored (`quickActionCellWidth`): until 2026-11-13 the cells were thirds of the panel's outer width, a hairline wider than the row, so the third wrapped and six drew as three rows of two. A label longer than its cell ends in an ellipsis inside it. Four or five leave the last row short; the 2026-11-06 rule that drew four two by two is retired with the two-column layout.
- **Recording starts from New minutes** (#5287). Paul picked a red Record meeting row above the actions on the morning of 2026-11-17, then took it out the same day: "I don't need a full red record meeting minutes option in the plus menu. Just let it be the normal new minutes option. Why have 2 options?" So the + has one meeting entry, New minutes, and its sheet leads with Record, with "Type notes instead" under it (Changed 2026-11-17 by pdcarlson, #5381: Record had sat beside Start minutes as a second full button), wherever the minutes screen's own Record would be offered: the member holds `meetings:record`, the module is on, the chapter drafts minutes, the server can write a recording out (`GET /v1/meeting-recorder`) and the build has a microphone. Record closes the sheet, asks the AI question if the member hasn't answered it, then opens the [Recording notice](../../behavior/meetings.md#recording-notice) with the same meeting on a row under its heading and Change, so +, New minutes, Record and Start recording are the whole way in. While the phone holds a recording, Record isn't offered and the sheet offers Start minutes; the recording pill opens it. Recording where nothing can be written out is #5289.
  - Changed by pdcarlson, 2026-11-17: the Record meeting row above the grid was removed and folded into New minutes.
- **The actions** (`apps/mobile/lib/quick-actions.ts`): New minutes, Search, New event, New task, Invite, Message, Host check-in, Log hours, Study and Upload. New minutes (#5287) opens a sheet with the meeting already picked and Record where the phone can record (typed notes under it), else Start minutes; it needs `meetings:record` and the module (since #5288 the minutes open as a note to type in whether or not the chapter drafts minutes, so it no longer waits on drafting). Search (#5287) pushes [§ Search](#search) for a member holding `members:view`, which `GET /v1/search` checks. The rest are offered only when the server would let the member through: the module is on and their role holds the permission the endpoint behind it checks (`availableQuickActions`, each gate naming its endpoint). There is no Check in: a member points the phone's camera at the code, which opens the app checking in (Paul, 2026-11-13: "we can get rid of the check-in option entirely and just rely on the phone's camera to take you there"; [`patterns.md` § QR check-in](patterns.md#qr-check-in-s18-member-check-in-s22-host-display)). A saved arrangement that still lists it drops it. Host check-in needs `events:update`, Invite `members:invite` (every invite route's; invites have no module switch), New task `tasks:manage` and `members:view`, Upload `chapter_docs:upload`, Log hours `service:log` (which the seeded New Member and Alumni roles don't hold), and Message and Study `members:view`. New event needs `events:create` and `members:view`, the New event sheet's own gate (`useCanCreateEvents`).
  - Changed in #5287 by pdcarlson, 2026-11-17: the list began at New event and had eight actions; Record meeting, New minutes and Search were added at Paul's ask.
- **What each opens** (`components/quick-actions/quick-actions-host.tsx`): New event, New task, Log hours and Upload present their sheets (the New event sheet, s19, s20, s21) over the screen the member is on, mounted the first time each is asked for and kept, so a closed sheet keeps its draft, one set per chapter. Each sheet sits in its own boundary: one that throws while rendering is reported (`error_boundary: sheet`) and dropped, so the tab bar keeps working, and the next tap mounts it fresh. The sheet may file into something not on screen (a task assigned to someone else is on no board here), so each create confirms in a glass capsule above the bar for four seconds, also announced to a screen reader: "Event added.", "Assigned to Sam." or "Added to your tasks.", "Hours logged.", and "“title” is in the library." Upload closes its sheet the moment it is tapped, so its capsule first reads "Uploading “title”…", and "“title” didn't upload. Tap + then Upload to try again." if it fails, which reopens this host's sheet on the kept draft (2026-11-07). These hosts are separate from Service hours' and Documents' own, so a draft started from the + isn't the one those screens open. Invite opens Invite members ([§ Inviting members](#inviting-members)). Message goes to the Directory, where the member's card has Message. Host check-in opens s22 for the soonest event still open to check-in, as You's row picks it, otherwise Events. Study opens the study screen.
- **At most nine, starting on six.** The cap is nine, three rows of three (Paul, 2026-11-13: "we should cap it at 9"; it was six from 2026-11-06), and stays nine, so an officer who can use all ten actions, places nine and leaves one in the Add row (`QUICK_ACTION_LIMIT`). A first open shows two rows: an officer starts on the first six they can use (`QUICK_ACTION_START`), a member whose role logs hours on the four they can (Search, Message, Log hours, Study). A President starts on New minutes, Search, New event, New task, Invite and Message; Invite stays in the first six (Paul, 2026-11-06: "I couldn't find a way to invite new members"). A saved arrangement keeps what the member placed, up to nine, and finds New minutes and Search in its Add row.
  - Changed in #5287 by pdcarlson, 2026-11-17: the nine held every action, a President started on New event, New task, Invite, Message, Host check-in and Log hours, and a member on Message, Log hours and Study.
- **Press and hold anywhere on the panel to edit it in place** (Paul, 2026-11-06: no settings page). Holding the + opens it already editing, and a screen reader gets "Edit quick actions" as a named action on each button; in editing each placed action offers Remove, Move earlier and Move later as named actions, and the escape gesture leaves editing, then closes the panel. Editing waits until the member's role and the chapter's modules have loaded, since an arrangement built from a short list would be wrong. The buttons jiggle (still under Reduce Motion) and each takes a remove badge, a drag moves one to where it is dropped and the others close up around it, and an Add row under them offers what isn't placed; with every action placed it is empty and not drawn. Done, or Android's back, leaves editing. The arrangement is kept on the phone, per member and chapter (`frapp:quick-actions:v1:<user>:<chapter>`), and an emptied panel stays empty and says to press and hold to add. An action hidden for now (its module off, its permission gone) stays in the saved arrangement through other edits and comes back when it is allowed again (`mergeSavedQuickActions`).

## Inviting members

Paul, 2026-11-06: "I couldn't find a way to invite new members or get my invite link from mobile." Setup's last step was the phone's only invite surface, and Chat home's checklist line sent the officer to the web.

- **One screen, `invite.tsx`, titled Invite members**, web's Members → Invite panel on the phone (Paul, 2026-11-09: "that's the way it should be for mobile as well", #3828). Top to bottom:
  - **Invite by email** (`components/more/invite-by-email.tsx`): one field takes one or more addresses, split on spaces, commas and semicolons as web's chip field splits a paste (`splitAddresses`), and Send (Send _n_ invites for several) emails each a single-use join link through `POST /v1/invites/email`, the route web sends through, so the recipient gets web's email. An address that isn't one holds the whole send, as web's red chip does. Addresses the server couldn't email stay in the field to send again. The button and the field's focus border take the chapter accent.
  - **Or share a link**: setup's share-first step ([`onboarding.md`](../../behavior/onboarding.md), `useInviteShares`) as the secondary button. Share invite, with the platform share mark, mints a fresh link (`POST /v1/invites`) and opens the share sheet with "Join <chapter> on Frapp" (Share waits until the chapter's name has loaded) and the link, with the same line as an iOS mail target's subject, so Mail and Gmail are the mail handoff. A link kept from a backed-out iOS sheet is dropped when the member leaves the screen or switches chapter, so one chapter's link never goes out under another's name (the screen's body is keyed on the chapter and the visit). The link tile takes the chapter accent, where setup's takes house gold ([`branding.md`](../../behavior/branding.md)).
  - **Invited** (`components/more/invited-list.tsx`): the chapter's invites from `GET /v1/invites`, listed and offering the same actions as web's panel ([`members.md`](../../behavior/members.md), which owns which rows show and what each offers), re-read every 15 seconds while the screen is in front. A row names the address, or Invite link for a shared one, says when it was sent, and shows its status. Tapping it opens the platform's menu (the action sheet on iOS; on Android a dialog, which draws at most three buttons, so it has no Cancel and closes on back): Share link where web copies one, Send again, and Revoke invite. Share link waits for the chapter's name, as Share invite does. One send or revoke runs at a time (Share link stays outside that lock, since iOS doesn't always report its sheet closing). A link Share invite kept from a backed-out sheet is dropped once its row shares it, or once the list shows it revoked (from either app) or expired, so the next press mints a fresh one. A row with nothing to offer isn't a button, and a failed read says so with Try again.

  No token is drawn. Neither path names a role, so the server grants the chapter's default invite role (#422), as web's dialog does without a pick. Unlike web, the phone has no role picker or subscription notice: a grace-blocked chapter's send comes back refused, and the screen shows the app's subscription-lapsed copy (`errorCopy`).

- **Four doors, each drawn only for a role that holds `members:invite`** (by default the President alone): the You tab's **Invite members** row, first in Admin; the Directory's floating + ([`patterns.md` § Create actions](patterns.md#create-actions)), labelled "Invite members", because the roster is where Discord and web put Invite; the tab bar's **Invite** quick action; and Chat home's setup checklist line. The back capsule names the screen it pops to, as every pushed screen's does ([§ Back rows](#back-rows)): `‹ You` from the row, `‹ Directory` from the +, `‹ Chat` from the checklist, and from the quick action whichever tab the + was opened over. The `from` param the doors pass only picks where the capsule leads when nothing is under the screen, as on a cold link.
- **A role without the permission** that reaches the screen by a link sees "Your role can't send invites. Ask an officer to send each person their own link." and no button. The screen waits for the role to load before deciding, and a failed read offers a retry rather than that sentence.

## You (s09 and s15)

One screen, the You tab (`(app)/(tabs)/you.tsx`, #3839), holds what were the More hub (s09) and Profile (s15). From the top:

1. **The profile's head**, s15's: the photo (it edits in place, #732), the name, and a line of major, company and class year (`components/you/profile-sections.tsx`). The member's points sit at the top right beside the You title, a quiet `60 pts` drawn only when it isn't zero and the chapter has Points on; the points and service-hours cards that sat under the name were removed on 2026-11-17 (#5281, Paul: "a lot of space just to say 0 points"), and service hours moved onto their row. While the profile loads the head is its skeleton; if it fails with nothing cached, an error with Retry stands in its place. The rows below never wait on it.
2. **Status** (#3845), one row labelled Status with the picked status's dot and its name as the trailing value, and its end time or custom line as a second line when there is one, opening the status sheet ([§ Status](#status)). It moved here from the avatar menu Chat home had, as Discord and Slack keep status on the member's own screen.
3. **The hub's rows**, in the groups below.
4. **Details and Bio**, s15's, drawn once the profile has loaded. They close the screen because they are set once and read rarely; the rows above are what a member opens the tab for most days.

**Editing is a tap on what you want to change** (#3711, Paul 2026-11-07: "The pencil button isn't obvious; drop it"): the name, the bio and every Details row that is the member's to set open the edit sheet. #3839's text asked for a pencil; Paul's later rule wins, so there is none.

Row anatomy, as drawn: duotone glyph, label, trailing status, chevron. No row carries a description line, except Status's end time or custom line.

The app groups the rows differently from the board, by owner decision on 2026-11-04 (#1048): the board draws one group from Study hours to Settings, while the app splits it into chapter tools and then your own settings and chapter switcher, so the two rows the board never drew sit with their kind instead of trailing the list.

The board's Notifications row is not here: the inbox opens from the bell on Chat home ([§ Global entries outside the tab bar](#global-entries-outside-the-tab-bar), #3362).

| Group                                     | Row              | Destination                                                      | Trailing status                                                                                                                                                  |
| ----------------------------------------- | ---------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| —                                         | Status           | the status sheet                                                 | the picked status's name, with its end time or custom line under the label                                                                                       |
| Chapter tools                             | Study hours      | `study.tsx` (s10)                                                | this week's total, e.g. "4.0 hrs", or "4.0 / 6.0 hrs" against the member's weekly goal when the chapter sets one (#1062); nothing at zero without a goal (#5281) |
|                                           | Service hours    | `service-hours.tsx` (host of the s20 sheet)                      | approved hours, e.g. "2.5 hrs", nothing at zero (#5281). The row is drawn only while the chapter has Service hours (`hours`) on                                  |
|                                           | Dues             | `dues.tsx` (s11)                                                 | the next bill's chip: warning hue for "Due Sept 15", destructive for "Past due Sept 15"                                                                          |
|                                           | Documents        | `documents.tsx` (s12)                                            | —                                                                                                                                                                |
|                                           | Directory        | `directory.tsx` (s13)                                            | —                                                                                                                                                                |
| You                                       | Settings         | `preferences.tsx` (s16)                                          | —                                                                                                                                                                |
|                                           | Switch chapter   | `(auth)/chapter-picker.tsx`                                      | the current chapter's name. When `GET /v1/chapters` is empty the slot is **Create a chapter** instead, opening `(auth)/create-chapter.tsx` (#1084)               |
| **Admin** (role-gated, captioned "Admin") | Invite members   | `invite.tsx` ([§ Inviting members](#inviting-members))           | —                                                                                                                                                                |
|                                           | Host check-in    | `host-check-in.tsx` (s22)                                        | the next hostable event                                                                                                                                          |
|                                           | Chapter settings | `chapter-settings.tsx` ([§ Chapter settings](#chapter-settings)) | —                                                                                                                                                                |
|                                           | Adjust points    | s23 sheet — **not rendered** until the sheet ships (#2300)       | —                                                                                                                                                                |

Activity led the chapter tools from 2026-11-11 ([#3897](https://github.com/pdcarlson/Frapp/issues/3897)) until it became tab 2 on 2026-11-12 ([#4610](https://github.com/pdcarlson/Frapp/issues/4610)), and its count moved to the tab with it.

Study hours leaves the list while the chapter has no active study zone, and Documents leaves it for a viewer who can't upload while there are no documents; each comes back once the first one exists ([`modules.md` § Not-set-up features](../../product/modules.md#not-set-up-features)).

The admin section renders only for members whose role grants the underlying permissions; ordinary members never see it. The board captions it with the viewer's role ("ADMIN · PRESIDENT") and draws a role chip on the profile; neither is drawn, because no role name is readable on mobile (`/v1/users/me/permissions` returns permissions only).

Two rows above are not drawn in Canvas and exist for reachability:

- **Service hours** — `service-hours.tsx` is a live route hosting the s20 sheet, and without a row it would be unreachable.
- **Switch chapter** — the only in-app entry to `(auth)/chapter-picker.tsx` (a `frapp://chapter-picker` link also opens it). The picker is deliberately _not_ forced on members whose token lacks an `active_chapter_id` claim (`apps/mobile/lib/auth-gate.ts` explains why claim-absence is not a destination), so it needs a door.

**Implementation status.** Every row above except Adjust points is routed, the admin section included — its gate landed with C4 of #937. The gate is `usePermissionList()` (a thin wrapper over `useMyPermissions()`) plus `can` from `@repo/validation` (`canAny` when a gate is composite), never a bare `permissions.includes(…)`: an owner's grant is the wildcard `*`, so a membership test would hide these rows from exactly the people they exist for. Each row carries its own gate, Invite members `members:invite` and Host check-in `events:update`, and the section renders when either does (since 2026-11-06; before then the gate was `events:update` alone) — see Host check-in below.

Two things about that section are worth knowing before reading a device:

- **It renders for nobody until a token carries a chapter claim.** `useMyPermissions` is `enabled: !!chapterId`. The hook is on in both hosted projects; production still has no memberships, so issued tokens have no `active_chapter_id` and the permission set stays empty — Presidents included — until the first onboard. It fails closed, which is the right direction. Local (`supabase/config.toml`) and staging (seeded members) already show the section.
- **Host check-in resolves an event.** s22 reads an `eventId` param, so the row cannot be a bare link: it picks the next upcoming-or-still-checkable-in event and passes its id, and renders inert when there is none. **There is no Adjust points row.** The s23 sheet needs a member picker plus amount/category/reason and is unbuilt, and a row that renders disabled with nothing behind it is the "coming soon" shape App Review Guideline 2.1 rejects, so it was removed rather than drawn (#2300). It returns with the sheet; until then awarding and fining points is web-only. The section is not gated on `points:adjust` for the same reason: that would draw an empty Admin header for an officer who holds only that.

The drawn s16 also carries an inline `CHAPTER · ADMIN` group. It moved whole to Chapter settings on 2026-11-12 (#4074), so Settings is the member's own, as web keeps the two apart; its "Join code" row is omitted because chapters have no join code (joining runs through single-use, expiring invite tokens — see [`screens.md`](screens.md)).

## Chapter settings

Paul, 2026-11-10 (#4074): mobile had personal settings but almost no chapter side, and "the roles matrix never fit a phone; a toggle list does". Web's Chapter settings in the iOS Settings shape: grouped lists, a chevron per row, a pushed screen per page, swipe back on each. Discord mobile's Server Settings → Roles is the comparison an officer arrives with.

- **The door is You → Admin → Chapter settings**, drawn for `chapter-config:view` or `roles:manage` (`lib/more/chapter-settings.ts`). Web's nav row also opens for a treasurer who holds only `billing:view`; the phone has no Plan and billing, so it draws no row that would open onto nothing. While the role loads the permission list is empty, so the row fails closed.
- **`chapter-settings.tsx`** holds **Chapter** (Chapter accent and Chat background, each a sheet for `CHAPTER_PROFILE_PERMISSIONS` and read-only, saying who sets it, for anyone else; Study zones, read-only, "Managed on the web dashboard.") for `chapter-config:view`, **AI** (the president's three switches, inline, from `AI_SWITCHES`, only where the server has AI, for `chapter-config:view` as web's AI tab is: every officer here reads them, only the president changes them, and Include channel messages sits nested under Ask Frapp, muted while Ask is off, and can't be turned on until Ask is (`aiSwitchState`, shared with web); [`ai.md` § Consent](../../behavior/ai.md#consent), [#4789](https://github.com/pdcarlson/Frapp/issues/4789), 2026-11-17), and **People** (Roles, with the count) for either permission. A member's own Settings links here from its AI section's Chapter AI row (s16).
- **`chapter-roles.tsx`, Roles**: a section per tier in rank order, headed by the tier's name and its role count, holding a Permissions row (how many are on) and then each role (its color dot and how many hold it), then Outside the tiers, then **Non-chapter business**: the roles members pick themselves, apart from the rest outside the tiers as on web, with a line saying how to fill it for an officer who manages roles while it is empty ([`rbac.md` § Self-assignable roles](../../behavior/rbac.md#self-assignable-roles), #4958). A search field finds a role by name once there are more than eight, so a chapter with a hundred roles stays one search away. Tier names and the word for a tier are the chapter's (`tierWords(vocab("tier"))`).
- **`role-tier.tsx`**: the tier's switches, one grouped list per module, saved on tap, then the roles in it.
- **`role.tsx`**: the role's tier (a tap opens it) and member count, then, on a role with no `system_key`, the **Non-chapter business** switch (#4958), then its permissions. In a tier each row shows its answer, a row set apart from the tier says so under it, and a tap opens Same as tier, On and Off ([`components.md` § Segmented control](../design-system/components.md#segmented-control)). Outside the tiers each is a plain switch. The President's role shows every switch on and still.
- **Rows carry labels only.** The registry's one-line descriptions are web's; a screen reader hears each as the row's hint. A row's second line says only what its control can't: why it can't change, or that its save failed (the phone has no toast, so a failed save leaves its line on its own row, and the switch snaps back). The Non-chapter business switch is an exception: its name doesn't say what it does, so it explains itself under its label as web's does (#4958). So are the AI switches, whose names don't say what a chapter shares by turning one on: each carries a short line (`AI_SWITCHES`' `short`, web's `description` cut to a row) and, on a failed save, that line becomes the failure (#4789).
- **The rank rules are web's, from one copy** (`@repo/hooks/role-tiers`, with the optimistic save in `@repo/hooks/permission-overlay`): a tier or role at or above the officer's rank is read-only and says so once at the top, and a permission their role lacks can't be switched on and says why on its row. The API stays the authority.
- **Web only, for now**: adding, renaming, reordering and deleting tiers and roles; a role's name, color, position and @mention switch; View as a role; presidency transfer; Plan and billing, the module pages, vocabulary and member fields. Roles says so in a line under the list. Giving a member a role stays the Directory's member sheet (#3676).

## Global entries outside the tab bar

- **UP NEXT strip** (s04): the top of Chat home carries an UP NEXT section (under the "While you were away" card when it shows, #5464) — the next event and the nearest due task as rows in one raised card, each tapping through to its detail (event detail s07, task board s08). A row leads with a neutral tile (the calendar or the checklist glyph), gives the title a line of its own, puts when and where under it, and ends in a chevron: the Activity row's shape ([`patterns.md`](patterns.md#rows) § Rows). Until #4610 step 3 (2026-11-12) the two were bare one-line rows that cut a title mid word and showed nothing that said they open; Google Calendar's schedule and Slack's Activity give a title its own line for the same reason. It is a pulse affordance: chat is home, so the one glanceable "what's next" surface rides above the channel list rather than living in a Home tab. Its days are words, never abbreviations (owner, 2026-11-07): `Today 6:45 PM`, `Tomorrow 6:45 PM`, the weekday inside the coming week (`Sunday 6:45 PM`), else the date (`November 14`, with the year outside this one: `January 5, 2027`), the same words the Calendar heads its days with (`formatDayHeading`, #3823); a task reads `Due today`, `Due tomorrow`, `Due Sunday`, `Due November 14` or `Overdue` (`formatEventTime`, `formatDueDate` in `components/chat/up-next-strip.tsx`). It used to say `tmrw` and `Sun`.
- **Calendar** (s06, #5310): the chapter's month opens from the Calendar row at the foot of Activity's To do, as a pushed screen (`events.tsx`, `‹ Activity`). It was the third tab from #4610 until #5310 gave the slot to Messages. The route stays `events`, so a link, a notification target or the + panel's Host check-in with nothing to host still reaches it, and now pushes it.

- **The swipe to Messages and its hint are gone** (#5310). From 2026-11-12 a slide left on Chat home opened Messages, and a one-time hint taught it ([#3774](https://github.com/pdcarlson/Frapp/issues/3774), [#4448](https://github.com/pdcarlson/Frapp/issues/4448)); they stood in for a tab Messages didn't have. With Messages a tab, one tap reaches it from anywhere, so the gesture, the hint and the touch claim that kept the swipe from also pressing a row (`messages-swipe-area.tsx`, `messages-swipe.ts`, `messages-hint.ts`, `swipe-claim.ts`, `overlay-presence.ts`) went in the same change.

- **The bell** (s04; back with #3839). Chat home's title row ends in Search and the **bell**, which opens the inbox (s14, `‹ Chat`) and badges its unread count in fixed house gold, never the chapter accent ([`../design-system/components.md`](../design-system/components.md) § App bar chips). The count leaves out rows whose target is chat, which the channel rows and the Messages tab already count (`selectUnreadNonChatCount`, the app-icon badge's split). Instagram keeps its activity heart at the top of its home, and Slack its Activity beside the conversations. Chat home itself lists channels only. `components/chat/home-header.tsx`; `lib/chat/chat-home.spec.tsx` pins it.

  > **Changed in #5310 by `pdcarlson`, 2026-11-17.** Between Search and the bell sat a paper-plane **Messages** door (owner decision 2026-11-07, option B of the round-two Chat home redesign), which pushed Messages with a mention-red count of unread conversations. The Messages tab replaced it, badge and all.

  > Changed in #4960 by shawnatomklein-eng, 2026-11-14: a third round, **Threads**, now comes first in the title row, before Messages and the bell. It opens a sheet of every thread the member follows across channels (All threads, [`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Message threads) and badges, in house gold like the bell, how many have new replies. Slack keeps Threads at the top of its home for the same reason.

  > Changed in #5139 by pdcarlson, 2026-11-16 (Paul's pick of option A on the [proposal page](https://claude.ai/artifact/BJHD8pewPWNQzpEzTt8KFW)): the first round is now **Search**, and Threads is the first row of the channel list instead of a round. The Search round pushes the Search screen ([§ Search](#search)). The **Threads row** sits above the first section heading with the threads glyph in the `#`'s slot, reads as an unread channel row does (bold title, leading pip) while any thread has new replies, and badges that count in house gold; it opens the same All threads sheet. The row is always drawn, even before the member follows any thread, so its place in the list never shifts. Slack's Home lists Threads as its first row the same way, and the title row keeps three rounds beside a long chapter name.

  > Changed in #5277 by pdcarlson, 2026-11-17 (Paul: "Threads will just ... appear underneath their channel, same as they kind of do in Discord, if you actually have something"): the Threads row and its All threads sheet are gone. Each channel lists its active threads indented under its own row, and Messages under each group DM's ([`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Message threads → All threads).

- <a id="search"></a>**Search** (#5139; Paul, 2026-11-16: take search out of Ask Frapp, "maybe a system wide search somewhere else (instead of the threads button?)"). Chat home's first title-row round, a magnifier, pushes `search.tsx` (`‹ Chat`, `components/search/search-screen.tsx`). Every member has it: until then the phone's only search was the list inside the Ask field, so a member without Ask had none. It opens with the field focused and the keyboard up. Before anything is typed it lists the member's last six searches on this phone and in this chapter, newest first, with Clear (`lib/search/recent-searches.ts`; kept on the phone, never sent). From three characters it lists web's Find rows (`@repo/hooks` `find-results.ts`): channels the member can read, members, messages and events, five a group under All and all of them under a chip (All, Channels, Members, Messages, Events; Events only while the module is on; no DMs, and no Backwork, which has no phone screen), with web's words for searching, nothing found, a timeout and a failure; when a group that is shown timed out under rows that did come back, a line above the rows names it, and a member with no chapter selected is told search is unavailable rather than that nothing matched. A tap opens the channel, the message in its channel, the directory or the event, and keeps the words as a recent search. For a member who has Ask the list ends in one row, the crest and "Ask Frapp about “…”", which opens the Ask sheet with those words in its field to send or change; Ask itself no longer searches ([`screens.md` s17](screens.md#s17-ask-sheet)). Slack's and iOS's search screens open the same way.

- <a id="status"></a>**Status** (#3845) is the first row under the profile on the You tab. It shows the member's picked status with its end time or custom line, and opens a sheet (`components/account/status-sheet.tsx`), as Discord's and Slack's phone apps do: Online, Idle, Do Not Disturb (its durations open under it, "Until I turn it off" first) and Invisible, then the custom line, a one-line form with "Clear after" (Today by default). The rules and wording are web's, shared in `@repo/hooks/member-status` ([`../../behavior/chat/README.md`](../../behavior/chat/README.md) § Online/offline presence). The You tab's avatar carries the picked status's dot bottom-right, none while Online (the shapes in [`../design-system/components.md`](../design-system/components.md) § Chat member list).

  > **Replaced in #3839, 2026-11-12 (Paul's pick of option A on #4610).** From 2026-11-07 the second control was the member's own avatar, opening a menu of Status, Profile, Notifications and Settings, with the inbox's count as a gold dot on the avatar and a number on the menu row. The avatar became the You tab, which holds Status, the profile and Settings, so the menu had nothing left of its own but Notifications, and a count shown only as a dot was one nobody could read. The bell came back beside Messages.

  > Changed for #3845 by shawnatomklein-eng, 2026-11-09: the menu gained Status as its first row, and the avatar a status dot bottom-right.

  > **Replaced 2026-11-07** (and reversed by #3839, above). From 2026-11-04 ([#3362](https://github.com/pdcarlson/Frapp/issues/3362)) the inbox was a bell on this row, which had replaced the board's Notifications row in More (s09). The bell folded into the avatar menu when the Messages door arrived, so the header holds two controls beside a long chapter name rather than three. The reason it left More still holds: the count belongs where the member lands. A channel's alert level stays behind the thread header's `⋯` (`notification-level-control.tsx`).

- **Ask Frapp** (s17) is a glass bar above the tab bar, on all four tabs (changed in #4702 by pdcarlson, 2026-11-13; Paul: it should "show up with the logo", have "a little bit more character" than the words, and sit "in a bar above the normal liquid glass bottom, not only when you open the plus menu"). It is a capsule 48pt tall across the width of the tab bar and its + together, 8pt above them, drawn by `GlassSurface` like the tab bar (`components/ask/ask-bar.tsx`, placed by `GlassTabBar`). While the member reads down a tab screen it folds into the tab bar's row instead ([§ Tab bar](#tab-bar--4-tabs-locked), #4904). It is drawn as the field it opens: the crest in the chapter accent, the conversation's own placeholder "Ask Frapp anything" ("Search or ask Frapp" from #4904 until #5139), and the field's send arrow in the accent at its end, with the capsule's edge in the accent at 30%. ChatGPT's and Perplexity's home screens and the Google app open their assistant from a bar shaped like its field. One tap opens the conversation at full height. The field only asks ([`screens.md` s17](screens.md#s17-ask-sheet)); search is Chat home's Search round ([§ Search](#search)). The tab screens make room for it: a screen's last row, the floating create button, the undo bar and the tab bar's confirmation all sit above it (`useAskBarLift`, `useTabBarClearance` in `lib/floating-chrome.tsx`), and a screen pushed over the tabs has no bar and leaves no room. The open + panel covers it. Until #4702 it was a bar across the top of the + panel ([§ Quick actions](#quick-actions)), above the actions: "Ask Frapp" and the field's own hint, in Ask's fixed house gold ([`components.md` §11](../design-system/components.md)), which a member only saw after tapping +. Ask is a global entry, not a tab — it MUST NOT become a fifth tab. Answer behavior and corpus rules: [`../../behavior/ai.md`](../../behavior/ai.md). **The bar exists only for a member who has Ask**, and that is the server's answer, not the build's (`useAiSurfaces` in `apps/mobile/lib/ai/availability.ts`): the server has AI on (`AI_ENABLED`), the president has Ask on for the chapter, and the member's role holds `ai:use`. When any of those is no, the tab bar is exactly as it was, the tab screens leave no room, no sheet is mounted, and the `ask` route goes to Chat home, so a member without Ask sees no Ask surface anywhere. The bar is not one of the six actions and can't be removed or moved.

  > Changed in #5139 by pdcarlson, 2026-11-16: the field only asks again. Search is its own screen, every member's, pushed from Chat home ([§ Search](#search)), and it can hand its words to Ask. From #4904 (pdcarlson, 2026-11-13; Paul's pick, one field for search and Ask, as on web) until then, the field searched too: while the member typed, the channels, members, messages and events that matched were listed just above it, a tap opened the thing, and Send still asked. It was the phone's only search, so a member without Ask had none.

  > **Changed in #4415, 2026-11-12 (the AI build's mobile slice, built without Paul in the loop; his review of the build's final PR is the check).** Until then Ask was a ✦ sparkle pill in the top bar of Chat home (s04) and Events (s06), drawn only in a build with `EXPO_PUBLIC_ASK_ENABLED` set, over a hand-written keyword table. Three things changed. The build flag and the table are gone: Ask answers from the chapter's own sources through the API (ADR-28), and one switch, the server's, decides whether it exists, so web and mobile can't disagree. The entry moved into the + panel, the direction Paul set for the mobile chrome on 2026-11-06 ("the direction I want to take our entire mobile UI"): Chat home's title row already holds Messages and the account avatar (the bell since #3839) beside a long chapter name, and the panel reaches Ask from all four tabs where the pill reached it from two. And the ✦ glyph is gone with the pill, since the entry is now words. ChatGPT, Perplexity and Notion put their ask field one tap from anywhere in the same way. The notes below are the pill's history and still give the reason Ask is hidden, not disabled, for a member without it.

  > **Reversed 2026-09-22, owner decision ([#2259](https://github.com/pdcarlson/Frapp/issues/2259)).** This bullet used to require the opposite: the pill "presses through even when Ask is switched off … the sheet states the reason, because a control that silently does nothing is the dead end §5 bans". The sheet then read "Ask isn't switched on for this build yet". That argument holds for a member who knows Ask is coming, but App Review is the other reader: a prominent control on the first screen after sign-in whose only function is to announce that its feature is off is the placeholder Guideline 2.1 rejects. Nor is it the dead end the old rule was guarding against. That rule bans a control that is _present_ and does nothing; a control that is not drawn has nothing to discover. The line between the two is [`../design-system/README.md`](../design-system/README.md) §5 rule 4, _disable, don't hide, for recoverable states_, which names this pill as one of the things to hide: no member can switch Ask on, and the pill has no function but Ask, so it is hidden, like a module the chapter has switched off. That is the Ask pill's case, not a rule for every build-time switch. The push primer, also gated at build time, was left open here and has since followed it: onboarding skips its notifications step when the build cannot push ([#2299](https://github.com/pdcarlson/Frapp/issues/2299), 2026-09-24; [`patterns.md`](patterns.md#push-notifications) § Push notifications). (The old text also cited `components.md` §5, which is Badges and chips; the rule was always in the design-system README.)
  >
  > **Why dues' Pay control does not follow.** `lib/payments/stripe.ts` gates on a build-time value too, and it still renders Pay disabled with its reason. The difference is what the control is for. Pay sits on an invoice the member really owes, so the disabled control is one route through a real task, and its caption names the other ("Ask your treasurer how to pay this invoice"). The ✦ pill has no function except Ask. Keep the two distinct, rather than "fixing" either to match the other.
  >
  > The board (`canvas-screens.dc.html`) draws s04 and s06 with the pill. Since 2026-11-12 that is a recorded departure: the entry was the + panel's bar, and since #4702 it is the bar above the tab bar.
  >
  > `apps/mobile/components/ask/ask-bar.spec.tsx` pins the bar, `components/glass-tab-bar.spec.tsx` where it sits and who gets one, `lib/floating-chrome.spec.tsx` the room the screens leave, `components/quick-actions/quick-actions-panel.spec.tsx` that the panel holds no Ask row, and `apps/mobile/lib/ask/ask-route.spec.tsx` the route: to Chat home without Ask, the sheet with it.

## Going back

Every screen outside the four tabs goes back by the platform's own gesture, as a member expects of any app (Paul, 2026-11-06: "On every screen, I should be able to swipe to the left to get back"). On iOS that is the edge swipe from the left; on Android it is the back button, or the back gesture from either edge.

- **The tabs sit in a stack** (`app/(app)/_layout.tsx`, a native stack). The four tabs are its bottom screen (`app/(app)/(tabs)/`), and every other screen is pushed over them. A pushed screen slides in, covers the tab bar, and the gesture pops it to whatever opened it: the channel list under a channel, the Calendar under an event opened from the Calendar, Chat home under the same event opened from Up next, the inbox under a screen a notification opened. Before 2026-11-06 the pushed screens were hidden tabs (`href: null`), and a tab switch has no back gesture at all, so none of them could be swiped away on iOS.
- **No route turns the gesture off.** A screen may hold it for a moment, where the swipe would lose something of its own (`useHoldSwipeBack` in `apps/mobile/lib/back-target.ts`): s05's photo viewer holds it while it is open, so a drag that pans a zoomed photo can't close the conversation, and create-chapter holds it on its confirm and colour steps, so the swipe can't pop the whole flow and drop what was entered. Android's back closes such an overlay first (`useBackToClose`, [`patterns.md`](patterns.md)). Bottom sheets need no hold: they draw over the stack, so a swipe on one never reaches the screen under it. `lib/routes.spec.ts` fails if the stack's layout sets `gestureEnabled`, and `lib/tab-layout.spec.tsx` if any registration does.
- **One exception: steps inside one sign-in route.** Sign-in's email form, join's later views and create-chapter's steps are states of one route, so on iOS the swipe can't step back through them (the bottom route has nothing to pop to, and create-chapter holds it, above), while the drawn ‹ and Android's back step back one step. Making each step a route of its own is [#3586](https://github.com/pdcarlson/Frapp/issues/3586).
- **Every drawn way back does what the gesture does.** The back capsule, s05's `‹`, and the glass ✕ on s22 and s18 (`components/glass-close-button.tsx`) pop the stack too, and the capsule names the screen it pops to ([§ Back rows](#back-rows)). A drawn control that went somewhere other than the swipe would be two answers to one question. s18's ✕ and "Back to event" pop only when the event's detail is under them, and otherwise pop down to it, taking s18's place, so "Back to event" always lands on the event.
- **A link always has the tabs under it.** The stack anchors the tabs (`unstable_settings.anchor`), so a screen opened cold by a notification tap or a `frapp://` link has Chat home under it to go back to. Chat home under a linked screen doesn't make its launch jump to the last channel: that launch went where the link points.
- **Going to a tab pops down to it.** A notification whose target is a tab (none is since the task board left the bar, #4610: a task or points notification now pushes it), a drawn way back with nothing under it to pop, and the old `frapp://ask` link all pop the stack down to the tabs and switch to the tab (`dismissTo`, through `openHref` and `goBackTo` in `apps/mobile/lib/href.ts`). Pushing a tab, navigating to one, or replacing a pushed screen with one would each stack a second copy of the tab navigator, tab bar and all, over the screen: expo-router's stack reuses a route only when it is already on top.
- **On a tab, back goes to the tab the member came from**, not straight to Chat home (`backBehavior="history"` on the tab navigator, 2026-11-05). On Chat home with nothing behind it, Android's back leaves the app.
- **A screen closes when the member goes back.** A pushed screen unmounts when it is popped and starts fresh the next time it is opened, where a hidden tab used to stay mounted for the whole session. What must outlive a visit is kept outside the screen: a composer's typed text is a draft (`apps/mobile/lib/chat/draft-store.ts`), and Dues' captured payments, which hold an invoice until the server reads it PAID, are kept for the session (`apps/mobile/lib/dues/visit-memory.ts`), so a member who swipes out of Dues right after paying, or even while the payment sheet is still up, doesn't come back to a live Pay on the same invoice. Each Dues reads that memory again when it comes into view, so a second Dues opened over the first (from a notification) can't be undone by the first one's older list.
- **Android's predictive back animation is off** (`android.predictiveBackGestureEnabled: false` in `app.json`, Expo's default). The back gesture works; the preview of the screen underneath while dragging does not draw yet.

## Back rows

A screen reached from another one draws a back row above its title, as the board draws `‹ Events` on s07 and `‹ More` on s10–s16, which reads `‹ You` since #3839 ([#3022](https://github.com/pdcarlson/Frapp/issues/3022)). A tab's own screen draws none. The row is `BackRow` in `apps/mobile/components/back-row.tsx`, passed to `ScreenShell` as `back`; s13, which draws its own header, draws it itself through `PinnedBackRow`.

- **It is a glass capsule, pinned** (Paul, 2026-11-05: "like a bubble around ‹ Events"). The `‹` and the label sit in a `GlassSurface` 36pt tall and fully round, sized to its label, the same glass as the tab bar, centred in a 44pt touch target (the target is the row itself, since a hit slop outside the clipping glass takes no touches). It is pinned to the top of the screen's content (`PinnedBackRow`, inside the safe area rather than offset by the inset; the connection pill floats over the top of the screen and takes no layout, so nothing moves when it shows, [connection-state.md](../resilience/connection-state.md)), stays in reach while the page scrolls under it, and the page's title starts below it. The `‹` is a drawn chevron, not a typed character. A press lifts the capsule one step, to `card`, as the floating create button lifts (it was `popover` until 2026-11-13, when a row on a card stopped lifting that far, [#4682](https://github.com/pdcarlson/Frapp/issues/4682)). The board draws a bare text row; this follows the tab bar's departure.

The row names the screen it pops to, so these are the rows a member sees arriving the usual way. Arriving another way, the row says where that way leads: `‹ Chat` over an event opened from Chat home's Up next, `‹ Notifications` over Dues opened from the inbox.

| Screen                                                                               | Usual way in                   | Row                                   |
| ------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------- |
| s07 Event detail                                                                     | Calendar                       | `‹ Calendar` (`‹ Events` until #4610) |
| s08 Task board                                                                       | Activity's Task board control  | `‹ Activity` (#4610)                  |
| s10 Study hours, s11 Dues, s12 Documents, s13 Directory, s16 Settings, Service hours | You                            | `‹ You` (`‹ More` until #3839)        |
| s14 Notifications                                                                    | The bell on Chat home          | `‹ Chat`                              |
| s06 Calendar                                                                         | Activity's Calendar row        | `‹ Activity` (#5310)                  |
| Day (one day's hour grid)                                                            | The Calendar's day heading     | `‹ Calendar` (#5310)                  |

- **It pops the stack, as the swipe does, and names what it pops to** (2026-11-06, [§ Going back](#going-back)). The label is the title of the screen under it (`useScreenBelow` in `apps/mobile/lib/back-target.ts`, from `SCREEN_TITLES`), or the tab the tabs are showing. Each screen still passes a fixed label and destination (`BACK_TO_YOU`, `BACK_TO_EVENTS`, `BACK_TO_ACTIVITY`, `BACK_TO_CHAT`), which the row uses only with nothing under it. Until 2026-11-06 the row always went to that fixed destination, because the screens were hidden tabs and `router.back()` could land somewhere the label didn't say; on the stack, going back always lands on what the label names.
- **s15 has no back row any more**: it is the You tab ([§ You](#you-s09-and-s15)). The board's `‹ More` … `Edit` row went first to tap-to-edit (#3711) and then to the tab.
- **s12's upload moved off the row** (2026-11-05). It is s12's floating create button, bottom right above the tab bar, for a viewer holding `chapter_docs:upload` only, opening s21 ([#3399](https://github.com/pdcarlson/Frapp/issues/3399), [`patterns.md` § Create actions](patterns.md#create-actions)).
- **Every state of a screen draws it**, the loading and error states included: a link to an event that's gone lands on s07's error state, and that state still needs a way out.
- **A screen's render-error fallback is the one exception** ([#3378](https://github.com/pdcarlson/Frapp/issues/3378)). It replaces the whole screen, its own back row included, and it is one component for every route, so it doesn't draw each screen's row. On a pushed screen, which covers the tab bar, it draws a back row (popping to the screen under it, or `‹ Chat` with nothing there), since otherwise only the swipe leads out; on a tab the tab bar is the way out and it draws none. The two navigators hand their screens different layouts (`stackScreenLayout` and `screenErrorLayout` in `apps/mobile/components/route-error.tsx`), and `components/route-error.spec.tsx` pins both cases. Copy: [`writing.md` § Mobile render errors](../design-system/writing.md#mobile-render-errors).
- **s14 draws `‹ Chat`, not the board's `‹ More`**, because its entry moved to Chat home (the bell, the avatar menu from 2026-11-07, the bell again since #3839) ([§ Global entries outside the tab bar](#global-entries-outside-the-tab-bar), [#3362](https://github.com/pdcarlson/Frapp/issues/3362)). Service hours, which the board never drew, opens from a You row and draws `‹ You` like its neighbours.
- It is drawn in the chapter accent (`useChapterBranding().accent`), as s05's `‹` is. The board draws it gold because its chapter is gold; inside a chapter every back arrow and inline action takes the chapter's accent ([`branding.md` § Accent Color](../../behavior/branding.md#accent-color), owner rule 2026-11-04). It was fixed `gold.askText` until 2026-11-05, which read as a stray gold control beside a purple or red chapter.
- **`(auth)` draws the same row in house gold** (`BackRow house`, `gold.askText`), because nothing there is inside a chapter. Sign-in's email form, s02's invite and confirm steps and chapter setup draw `‹ Back`, which steps back one view inside their own route (`onPress`) and holds while a request is in flight (`disabled`). On setup's find step, its first, the row leaves the route instead: `router.back()` to what opened it, or `router.replace('/join')` when nothing is behind it. The chapter picker draws `‹ You` only when You's Switch chapter opened it, which passes `from: "you"` to say so, and goes back with `router.back()` rather than navigating, because `(tabs)` is already under it. Opened by a link it draws no row: `(auth)`'s anchor puts sign-in under a linked screen, so "something to go back to" (`router.canGoBack()`) can't tell the two apart. Like the `‹ Back` rows, it holds while a chapter switch is in flight.
- Pinned by `components/back-row.spec.tsx` and `components/screen-shell.spec.tsx`, and per screen by the screen specs (`lib/events/event-details-screen.spec.tsx`, `lib/more/back-rows.spec.tsx` and the other `lib/**/*-screen.spec.tsx` files, s07's loading and error states included), through `test/back-row.ts`.

## Launch

Launch opens the last channel the member was in, then back goes to chat home (s04), the way Discord does (owner, 2026-11-05). Once per app process and only at launch (a list that answers late, or a member who has already left chat home, gets no jump), and a notification tap that launched the app wins. The rule and its fallbacks: [`spec/behavior/chat/README.md` § Where Chat opens](../../behavior/chat/README.md#where-chat-opens). It lands rather than slides: while the jump may still happen chat home holds its list behind the skeleton, and the channel opens with no push animation, so the list never flashes first (owner, 2026-11-07). A notification for a channel while a channel is open replaces it instead of stacking a second, so back still reaches chat home (2026-11-07, `openHref` in `apps/mobile/lib/href.ts`). Implementation: [`apps/mobile/lib/chat/last-channel.ts`](../../../apps/mobile/lib/chat/last-channel.ts).

### The launch logo

Launch shows the Frapp logo until the screen the member lands on can show its real content, then fades straight into it, so a cold launch never shows skeleton rows first (Paul, 2026-11-17, [#5449](https://github.com/frapplive/Frapp/issues/5449); his picks: an animated logo, and about 4 seconds at most). The native splash hands off to the same emblem, drawn at the same size, place and colour (`apps/mobile/lib/launch/launch-look.ts`, held to `app.json` by its spec), so the hand-off can't be seen. While it waits the emblem breathes, 4% larger and a fifth dimmer at the peak, 1.4 s a breath; it then fades out over `motion.duration.context` on `motion.easing.exit`, easing 8% larger as it goes. With Reduce Motion on the emblem holds still and the cover only fades. This is a loading indicator, not a signature moment ([`design-system/README.md`](../design-system/README.md) §7), which is why it may loop.

- **When it lifts.** When the focused screen reports its content is here, through the same flag that times its full display for Sentry (`ScreenReady`, `lib/sentry/screen-ready.tsx`). Chat home holds that flag while its launch jump may still happen, so a launch into the last channel waits for the channel's rows. A screen that reports nothing yet (sign-in, a linked screen, most notification targets until [#5453](https://github.com/frapplive/Frapp/issues/5453)) lifts once it's drawn and shows its own loading state. A notification tap that launched the app holds it until the tapped screen is open. The update-required prompt lifts it at once.
- **The cap.** About 4 s after the app's code starts, it lifts whatever is still loading, onto the screen's normal loading states: offline or on bad signal nobody waits on the logo. The phone keeps no saved copy of most reads ([`resilience/caching.md`](../resilience/caching.md)), so what shows then is the unread memory, a channel's cached first messages, and skeletons for the rest.
- **When it shows.** Only when the app's code starts afresh: a cold launch, or the reload that applies an over-the-air update, whose reload screen draws the same emblem natively before the logo takes over (`lib/updates/use-resume-updates.ts`; on Android only where the emblem resolves to a file the reload screen can load, since an APK-embedded asset would make it show a spinner instead). The logo also stays until the app under it has mounted, so even the cap never lifts it onto nothing. A return from the background keeps the process, so it never shows the logo. Phones only: the web build has no native splash to continue.

Implementation: [`apps/mobile/lib/launch/launch-gate.ts`](../../../apps/mobile/lib/launch/launch-gate.ts) (the rule) and [`apps/mobile/components/launch-cover.tsx`](../../../apps/mobile/components/launch-cover.tsx) (the drawing).

## Deep links

- Scheme: `frapp://` (`scheme` in `apps/mobile/app.json`). It is permanent, because every installed binary carries it (ADR-25). [`mobile-permanent-identifiers.test.mjs`](../../../scripts/ci/__tests__/mobile-permanent-identifiers.test.mjs) pins it, with the binary's other permanent identifiers.
- **`frapp://join?token=…` fills s02.** The same query keys web `/join` uses (`token`, then `invite`, then `code`) are accepted on the app scheme and as a pasted URL in the field.
- **`https://app.frapp.live/join?token=…` opens the app too, from 0.11.0** (#4002): `associatedDomains` (`applinks:app.frapp.live`) and an `autoVerify` intent filter on the path `/join`, in `apps/mobile/app.json`, pinned by `app.config.spec.ts`. The staging variant (Frapp Staging, `staging` profile) claims the same paths on its own dashboard's host instead (`app.staging.frapp.live`, from the profile's `EXPO_PUBLIC_APP_URL`, 2026-11-17), whose `.well-known` files name the staging app; `app.frapp.live` vouches only for the production app. It needs the web's two `.well-known` files for the same path, and a build installed from the store or TestFlight (Apple and Google check the files at install). Expo Router routes the link to `/join` with its params, so it lands where `frapp://join` does. An account with a chapter can't use s02, so when the chapter list says it has one and the gate says tabs, Terms or s03, the app opens that invite on web `/join` (marked `web=1`) in an in-app browser and leaves the member where the gate put them (`useMemberInviteHandoff`, mounted in `AppRuntime`). It takes the invite from the opening link, marking it handled so s02 never replays it, or from the invite s02 remembered across sign-in. The in-app browser has no app session, so the member signs in there again (always on iOS); joining a second chapter in the app is not built. Every EAS profile carries the claim, so an internal `preview` build installed on iOS opens production invite links too, against the staging API, where they are dead. `/check-in` (the check-in code, 2026-11-13) is claimed on iOS by the web's file alone, since its paths live there; Android claims it in its intent filter from 0.13.0 (#4763); on an older Android build its web page hands off with Open in Frapp. No other https path opens the app.
- **`frapp://chat?channel=…&message=…` opens the channel on the message** (#3723), through `apps/mobile/app/(app)/chat.tsx`; a link with only `channel` opens the channel. The same `/chat` link on `https://app.frapp.live` (Copy message link's, `packages/validation/src/message-link.ts`) opens in-app when tapped inside a message (`apps/mobile/lib/chat/open-link.ts`), but the app doesn't claim the https path yet, so opened from another app it goes to the web: iOS reads claimed paths from the web, and installed builds have no `/chat` route (#4869).
- **`frapp://event-details` is a contract.** `.ics` files exported before the calendar export was withdrawn (2026-11-08, #3708) carry it as their deep-link URL, `frapp://event-details?id=<event id>` (`apps/mobile/app/(app)/event-details.tsx`), and those files live on in members' device calendars indefinitely. Nothing writes the URL any more, but the route filename, the URL and its `id` param MUST never change. The same lock pins the `id` param, and `apps/mobile/lib/routes.spec.ts` pins the route.
- **First-officer creation is `(auth)/create-chapter`.** The route is exempt from the authenticated bounce into the tabs so a successful onboard does not yank the officer off the invite step (`spec/behavior/onboarding.md`).
- **Magic-link auth callback:** sign-in email links redirect to `Linking.createURL("/")` with a trailing `?` (`emailRedirectTo` in `apps/mobile/lib/auth-session.tsx`), which expo-linking resolves **at runtime to whichever scheme owns the running app** — `frapp:///?` in a build that owns the scheme, but `exp://<host>:8081/--/?` under Expo Go. The trailing `?` lets the hosted Magic Link template append `&token_hash={{ .TokenHash }}&type=magiclink` onto `{{ .RedirectTo }}` the same way web's `/auth/callback?next=…` does, so the emailed href never uses `*.supabase.co/auth/v1/verify`. Both forms must be allowlisted in Supabase Auth's redirect URLs for magic-link sign-in to complete. `frapp://**` **is** allowlisted on both hosted projects since 2026-09-06 (`docs/ops/deployment/supabase.md` § Auth settings), so a real build completes; the Expo Go form embeds a per-machine host, so it cannot be allowlisted once and reused across developers. Tracked as issue #765 — allowlisting `frapp://` does not unblock Expo Go. `AuthSessionProvider` accepts implicit tokens, PKCE `code`, and `token_hash` (`verifyOtp`) on that scheme. The sign-in screen's magic link and the Confirm-signup resend (#3833) both use that bare `?` URL. (The sign-in link carried `intent=sign-in-link` for the retired "New account created" card, #4769, until 2026-11-15.)
- **OAuth auth callback:** Google and Apple, when their native sign-in is unavailable, reuse that same `Linking.createURL("/")` + trailing `?` as `signInWithOAuth` `redirectTo` (`skipBrowserRedirect`, then `WebBrowser.openAuthSessionAsync`). Native Sign in with Apple on iOS uses `signInWithIdToken` and never opens a browser. Native Google sign-in (`lib/google-auth.ts`, #2126) also ends in `signInWithIdToken`, through Google's SDK, once the platform's client ID is recorded ([`supabase.md` § Native Google Sign-In](../../../docs/ops/deployment/supabase.md#native-google-sign-in-2126)); until then, and on any configuration refusal, Google takes the browser path. Expo Go's OAuth return has the same per-machine allow-list gap as magic-link (#765).

## Pre-chapter routing (s02 / s03)

`apps/mobile/lib/auth-gate.ts` is still the single decision both layouts read. It now also consumes `GET /v1/chapters`:

The first matching row wins.

| Authenticated state                                                                                                                                                                                                                                                                     | Destination                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| No chapter yet, and the `active_chapter_id` claim is still being read                                                                                                                                                                                                                   | `hold`                       |
| Chapters list still loading (first read, its retry included, even paused offline)                                                                                                                                                                                                       | `hold`                       |
| **Chapters read succeeded:** zero memberships                                                                                                                                                                                                                                           | `join` (s02)                 |
| A member (in the last chapters list, even if a refetch since failed), the first Terms read still loading (its retry included)                                                                                                                                                           | `hold`                       |
| A member (likewise) who hasn't accepted the current Terms (#2302)                                                                                                                                                                                                                       | `terms` (`(auth)/terms.tsx`) |
| **Chapters read succeeded:** active membership has `has_completed_onboarding === false`                                                                                                                                                                                                 | `welcome` (s03)              |
| Otherwise: onboarded, or the chapters read failed in any other case (fail open), or the first Terms read failed. A read that failed (retries spent) with no answer keeps reading as failed while it refetches, so it doesn't hold again; a failed Terms refetch keeps its cached answer | `tabs`                       |

`terms` comes before `welcome` so a new member agrees before they can post. The server decides it (`GET /v1/users/me/legal-acceptance`), never a version compiled into the binary ([`../../behavior/legal.md`](../../behavior/legal.md#acceptance-record) § Acceptance record). While the gate reads `terms`, `/create-chapter` is also permitted, since the wizard carries the same checkbox.

A missing `active_chapter_id` claim is still not a destination — see `lib/auth-gate.ts`. `(app)/_layout.tsx` is frozen and still only redirects to sign-in; walking a member _out_ of the tabs onto s02/s03 or the Terms prompt is `AppRuntime` (`lib/onboarding/use-onboarding-redirect.ts`) so that file does not have to thaw.

## Typed routes

- `typedRoutes` is enabled (`experiments.typedRoutes` in `apps/mobile/app.json`), so route strings are compile-checked against the file tree **during local development**.
- **They are not checked in CI.** The generated types live in `.expo/types` and `expo-env.d.ts`, both gitignored (`apps/mobile/.gitignore`) and written only by `expo start`. CI runs a bare `tsc`, and with those files absent `Href` widens back to `string` — a nonexistent path assigned to `Href` type-checks clean. Do not rely on the compiler to catch a bad route on a branch.
- **`apps/mobile/lib/routes.spec.ts` is the guard that actually runs.** It walks the real route tree and resolves route literals against it, and asserts the tab bar registers exactly the four locked tabs with a backing file behind every registration. A rename that misses a call site fails there.
- **Know what that guard does not cover.** It matches _double-quoted string literals_ at `href="…"`, `href: "…"`, `asRoute("…")`, `router.replace|push|navigate("…")`, and `pathname: "…"` — the last added with C1 (#937), whose chat list is the first screen to navigate with a param and therefore the first to use the object form `router.push({ pathname: "/chat-thread", params: { channelId } })`, which every other pattern misses. A route built from a template literal, a variable, or a prop is still invisible to it, which is why the You tab's rows navigate with literal `router.push("…")` calls rather than passing a route through a prop. It also only checks that literals resolve, never that a route has an inbound link, so an orphaned route stays green. When you add a route, add its entry point in the same change; neither gate will remind you.
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
the smallest one available: the banner's props _were_ the second, independent reading
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
_Corrected 2026-11-05 (this sentence used to call them still unbuilt):_ all three have
since shipped as photo-library picks, s15's avatar photo (#2897), s21's upload (#3399)
and, last, s20's proof attachment (2026-11-05), each dated below. What is still unbuilt
is the file half of the last two: a PDF or Office file on s21 needs
`expo-document-picker`, which can only ship in a store build, and
[#3401](https://github.com/pdcarlson/Frapp/issues/3401) adds it there and decides
whether s20's proof takes a PDF from Files too.
_2026-11-16:_ #3401 added `expo-document-picker` back to `package.json` for s21's
Files pick (`lib/more/document-upload.ts`), in 0.13.0 before its first store build. It
needs no `plugins` entry (its plugin only touches iCloud entitlements, still unset) and
no purpose string. It reads a picked file's modification date and ships no privacy
manifest, so `ios.privacyManifests` declares FileTimestamp reason 3B52.1 (files the
user picked) beside C617.1. s20's proof stays photos only until
[#5149](https://github.com/frapplive/Frapp/issues/5149) decides.

**`package.json` and `app.json` gained `expo-audio`** (2026-11-12, the meeting
recorder). The dependency, its `plugins` entry (`microphonePermission`,
`enableBackgroundRecording: true`, `enableBackgroundPlayback: false`), the microphone
text on the camera and picker entries, and the native version (0.11.0 to 0.12.0) are a
dependency and its config, which the carve-out above covers, but they did not go
through it: they shipped inside the recorder's feature slice rather than as a small
standalone PR, because the AI build's brief assigned the recorder, its native module
and its version bump to one slice on the `ai-integration` branch. Two more frozen-file
edits ride with it. `app/_layout.tsx` gained one
line, `<RecordingBar />` beside `<NetworkBanner />`: the recorder runs for two hours
across every screen, so its always-visible state has to draw above them all, sheets
included, which only the root can do. `components/app-runtime.tsx` gained
`useMeetingRecorderRuntime()`, which is what that component exists for.

**Both were removed again** (#2296) — the three surfaces were still unbuilt a month
later, and the declarations were not merely premature but actively harmful. The
`photosPermission` string shipped in the binary as a purpose string for a feature that
does not exist (Guideline 5.1.1(i)), and the `cameraPermission: false` above compiled
to `withBlockedPermissions(['android.permission.CAMERA'])`, which _removed_ the
permission `expo-camera` contributes and wrote `tools:node="remove"` into the manifest —
silently breaking QR check-in (`app/(tabs)/check-in.tsx`) on every Android build. The
declining-a-permission half is the reusable lesson: a plugin option that declines a
permission is not inert, it overrides other plugins, so it can only be set for a
permission nothing in the app requests. `scripts/check-mobile-native-declarations.mjs`
pins both halves in `mobile-validate`. It reads the Info.plist and AndroidManifest that
`expo config --type introspect` resolves, rather than `app.json`: the exact iOS purpose
strings, and no `tools:node="remove"` on a permission a screen requests. So re-adding
this picker the same way fails CI rather than shipping. _Updated 2026-09-30 (#2343):_
the `app.json`-level assertions in `app.config.spec.ts` that this replaced weren't an
airtight fence. An option left _omitted_ inherits its plugin's default purpose string,
and a vendor option spelled something other than `*Permission`/`*UsageDescription`
wasn't scanned. The introspected gate sees both, because it reads what the mods write.
Re-add the dependency and its plugin entry in the slice that actually builds a picker
surface — which is what #1045 should have been.

**`expo-image-picker` came back (#2464), with the surface this time** — chat photo
upload, `apps/mobile/lib/chat/attachment-upload.ts`, which is the importer #1045 never
had. `expo-image-manipulator` came with it, and earns its place rather than riding
along: iOS hands HEIC back from the photo library, `image/heic` is on neither the
`document` allowlist nor the chat bucket, and the bucket gates the _declared_
`Content-Type` and never the bytes — so declaring `image/jpeg` over HEIC would be
accepted, stored, and then render broken. The transcode is what makes the declared
type true. It is deliberately **conditional**: an already-allowlisted pick uploads
untouched, because re-encoding everything would flatten a transparent PNG and reduce
an animated GIF to one frame, and a GIF sent as a file is a feature that already works
through the `document` kind.

_2026-11-07:_ one re-encode is not about the type. A camera photo (a JPEG, or the HEIC
transcode) longer than 2560 px on its long edge, or a JPEG over 1.5 MB, is shrunk to
2560 px at JPEG quality 0.8 (`PHOTO_MAX_EDGE`, `PHOTO_JPEG_QUALITY`). A full-size phone
photo was 4 MB and up, and a 4.1 MB document photo took about 30 seconds to file. The
PUT also runs in a foreground `URLSession` now: `uploadAsync`'s default background
session hands the request to iOS's transfer daemon, which is built to outlive the app,
not to be quick. The trade is that a PUT stops if the app is suspended mid-upload, which
the caller reports as a failure to retry; a shrunk photo takes a second or two. PNG, GIF
and WebP still upload untouched.

_2026-09-30:_ the profile photo on s15 (#2897, `lib/more/profile-photo.ts`) is the
picker's second caller, through the same `pickAndUploadImage`. #2895 edited `app.json`
as an integrator change so `photosPermission` names both uses ("set your profile photo
and send photos in chapter chat"), with the privacy policy and the store records in the
same PR.

_2026-11-04:_ chapter setup's live step (#3351,
`lib/onboarding/chapter-wizard/chapter-logo.ts`) is the third caller, adding the chapter's
logo. `photosPermission` names it too ("add your chapter's logo"), as do the store records
and the privacy policy's permissions clause. The owner ruled that policy edit non-material
([#3395](https://github.com/pdcarlson/Frapp/issues/3395)), so it moved only the page's pin
(`legal.md` § Acceptance record).

_2026-11-04:_ s21's document upload (#3399, `lib/more/document-upload.ts`) is the fourth
caller, through `pickImage`, the pick half of the same pipeline. It needs no native
change, so it ships over the air, but the compiled `photosPermission` text can only
widen in a store build: #3401 does that with `expo-document-picker`, and the store
records with it _(superseded 2026-11-05: widened on its own, see below)_. The privacy policy is a web page, so it names the new use in the
same PR (ruled non-material by the owner, 2026-11-04).

_2026-11-05:_ s20's photo proof (`lib/more/service-proof.ts`) is the fifth caller,
through `pickImage` and the PUT half of the same pipeline, attaching a photo to a
service entry. Like the fourth it needs no native change and ships over the air, and
`photosPermission` can only widen in a store build, so
[#3401](https://github.com/pdcarlson/Frapp/issues/3401) widens it to name service-hour
proof alongside document uploads, with the store records _(superseded 2026-11-05: widened
on its own, see below)_. The privacy policy's
permissions clause names it in the same change, moving only the page's pin on the
#3395 precedent; whether that edit is material, and what each ruling does, is
[`legal.md` § Acceptance record](../../behavior/legal.md#acceptance-record)'s.

_2026-11-05, later:_ the purpose string was widened on its own, ahead of #3401's Files
picker, so the 0.9.1 store build carries it. `photosPermission` now names all five
callers ("send photos in chapter chat, add photos to your chapter's documents, and attach
photo proof to service hours"). #3401 keeps the picker and #2620.

_2026-11-16:_ a sixth caller, a task's photos (`lib/tasks/task-photos.ts`, #4565, #4635),
is named: "add photos to your chapter's documents and to tasks" (#4611). The privacy
policy's permissions clause names it in the same change, moving only the page's pin.

Both #2296 defects stay fixed, and the plugin entry is the place that proves it. It
sets `photosPermission` and `microphonePermission: false`, and **no `cameraPermission`
key at all**. Each of those three is load-bearing _(as of 2026-09-30; the microphone
changed 2026-11-12 and the camera 2026-11-13, both below)_:

- `cameraPermission` is omitted rather than declined because declining is what
  compiled to `withBlockedPermissions(['android.permission.CAMERA'])` and broke QR
  check-in. Omitting is safe — and _not_ an instance of the omitted-option hazard
  above — because `IOSConfig.Permissions.applyPermissions` resolves each key as
  `permissions[key] || infoPlist[key] || default`, so an undefined option falls
  through to whatever a plugin already wrote before it ever reaches the vendor
  default, and `expo-camera` writes NSCameraUsageDescription explicitly in either
  plugin order. _(Changed 2026-11-13; see below.)_
- `microphonePermission` **is** declined, and must stay declined. Omitting it is not
  inert: `withAndroidImagePickerPermissions` adds `android.permission.RECORD_AUDIO`
  whenever the option is anything other than `false`, and the iOS half would write a
  default microphone purpose string for a capability this app does not have — the same
  Guideline 5.1.1(i) shape `photosPermission` used to be. Declining strips nothing
  another plugin contributes, because `expo-camera` sets `recordAudioAndroid: false`
  and so never adds RECORD_AUDIO either.
  _Changed 2026-11-12 (the meeting recorder, [`meetings.md` § Recording in the app](../../behavior/meetings.md#recording-in-the-app)):_
  the app now has a microphone surface, so this decline is gone. A `false` here
  blocks RECORD_AUDIO for every plugin, the recorder's included, and a `false` on
  `expo-camera`'s option deletes the purpose string the recorder needs. So
  `expo-image-picker`, `expo-camera` and `expo-audio` all carry the same
  `microphonePermission` text, which `IOS_PURPOSE_STRINGS` pins with the recorder's
  request as its caller; `expo-camera` keeps `recordAudioAndroid: false`, since the
  recorder's own plugin declares the permission.
- `photosPermission` is set explicitly rather than left to the plugin default, per the
  unread-pin note above. `scripts/check-mobile-native-declarations.mjs` pins its text
  in `IOS_PURPOSE_STRINGS` with the call that requests it, so declining it fails CI.
  _(Moved 2026-09-30, #2343, from `app.config.spec.ts`'s `REQUESTED_AT_RUNTIME` list.)_

_Corrected 2026-11-05:_ "decline what nothing requests" is not the whole rule on iOS.
App Store Connect's upload scan flags some APIs a linked library references and rejects
the binary when their key is missing (ITMS-90683), whether or not the app ever asks.
`expo-location` links `CMMotionActivityManager` for its motion permission requester, so
its `motionUsagePermission: false` got iOS 0.9.1 (8) rejected. The option now carries a
string that says Frapp never asks, and `IOS_PURPOSE_STRINGS` pins it as a linked-only
entry: `requestedBy: null` and a `linkedBy` naming the pod, the symbol and the JS request.
The gate fails if the key is declined again, asks for its removal once that pod stops
linking the symbol, and fails if the app ever makes the request the text disowns. The
scan doesn't flag every linked API: the same upload named only the motion key, though
`expo-camera` links microphone access and `expo-secure-store` links Face ID, both
declined at the time. So a linked-only entry is added when Apple names its key, and a
decline stands until it does. _(Changed 2026-11-12: the microphone key is no longer
declined, because the meeting recorder requests it; Face ID's decline stands.)_

_Changed 2026-11-13 (0.13.0, [#4763](https://github.com/pdcarlson/Frapp/issues/4763)):_
the in-app QR scanner went with [#4762](https://github.com/pdcarlson/Frapp/issues/4762),
when the check-in code became a link the phone's own camera app opens, and the first
0.13.0 change (#4926) removed `expo-camera` with a linked-only camera note and a blocked
Android CAMERA in its place. Before any 0.13.0 build, Paul kept an in-app Scan code beside
the camera path ("why not?"), so 0.13.0 ships `expo-camera` again, for s18's Scan code
(`components/check-in/check-in-scanner.tsx`):

- **The camera key on iOS** is requested again, by the scanner's `useCameraPermissions`,
  with the text "Frapp uses the camera to scan an event's check-in code when you tap Scan
  code." `expo-image-picker`'s `cameraPermission` now carries the same text rather than
  being omitted, so the key is the scanner's whichever plugin runs last. `false` there is
  still the #2296 defect.
- **`android.permission.CAMERA`** is declared by `expo-camera` and requested by the
  scanner, as before #4762; nothing removes it.

`microphonePermission` is carried by `expo-image-picker`, `expo-camera` and `expo-audio`
again, the three plugins that write the key.

_2026-11-17 ([#5276](https://github.com/frapplive/Frapp/issues/5276)):_ **`package.json`
and `app.json` gained `expo-speech-recognition`** for dictating into Ask Frapp (Paul picked
the phone's own recogniser over sending audio to a provider), through the integrator
carve-out as a standalone PR, with the native version 0.13.0 to 0.14.0. Its plugin is a
fourth writer of `microphonePermission`, with the same text as the other three, and the
only writer of `speechRecognitionPermission`. Paul approved both texts that day, and the
microphone text now names dictation as well as the recorder. Dictation's isolation module
is `lib/dictation/speech.ts`, behind `speech-module.ts` / `speech-module.native.ts`, and
its `requestPermissionsAsync(` is the speech key's requester in `IOS_PURPOSE_STRINGS`.
The plugin adds no Android permission the recorder hadn't (RECORD_AUDIO), plus a
`<queries>` entry so the app can see the Google app's recognition service.

The pairing is also pinned from the other side: `app.config.spec.ts` asserts a media
picker is depended on **only while a non-spec source file imports one**, which is the
check that would have caught #1045 shipping the dependency a month ahead of any
surface. `scripts/ci/__tests__/frapp-mobile-permissions.test.mjs` (then
`signet-mobile-permissions.test.mjs`; ADR-25 renamed it with the copy it locks) raised its
prompt floor from two to three with this slice, which is exactly what that file's block on
the floor going three to two (#2296) and back to three (#2464) said the raise was for.
_2026-09-30 (#2343):_ the floor is gone. The introspected gate pins which prompts exist,
and the copy lock asserts only that they name Frapp. _2026-10-07 (#3225):_ that copy lock is
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

_Corrected 2026-09-24 (#2526):_ "two required-reason categories" is now four, and two
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
so the 62pt row sits above the system bar. `lib/tab-layout.spec.tsx` pins the sum. (Corrected 2026-11-06: the bar has floated since 2026-11-05 and is drawn by `GlassTabBar` since 2026-11-06, so `components/glass-tab-bar.spec.tsx` pins its offset over the inset now.)

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

**The quick-actions change touched `app/(tabs)/_layout.tsx` and `components/screen-shell.tsx`, as an integrator change** (2026-11-06, owner pick). The navigator's own bar, and with it `tabBarStyle`, `tabBarBackground` and `tabBarLabel` on the navigator, gave way to `tabBar={GlassTabBar}`, which draws the pill and the quick-actions + ([§ Quick actions](#quick-actions)); the glass note above describes the bar as it was drawn until then. FULL_WINDOW's `tabBarStyle: { display: "none" }` is still how a registration hides the bar, read by `hidesTabBar`. No route, tab, header or screen option changed. `screen-shell.tsx` changed in a comment only: `createAction` no longer lists Tasks. JS only, so it ships over the air on 0.10.0.

**The AI build's mobile slice touched `app/(app)/_layout.tsx`, as an integrator change** (2026-11-12, #4415). It registers three new routes on the stack, `minutes`, `minutes-details` and `suggested-tasks`, each a `Stack.Screen` with a backing file, which is the only way a route can be added ([`lib/routes.spec.ts`](../../../apps/mobile/lib/routes.spec.ts) fails without the registration). No option of any existing screen changed. `components/screen-shell.tsx` changed in a comment only: `headerAction` no longer names the Ask pill. JS only.

**The swipe-back change touched `app/_layout.tsx`, `app/(app)/(tabs)/_layout.tsx` and `lib/href.ts`, and added `app/(app)/_layout.tsx`, as an integrator change** (2026-11-06). Every pushed route moved out of the tab group into `app/(app)/`, onto a native stack whose bottom screen is the tab group, so each can be swiped back ([§ Going back](#going-back)). The root stack's `(tabs)` became `(app)`, the auth gate moved from the tab layout to the new stack layout so it covers the pushed screens too, and the tab layout lost its hidden registrations and `FULL_WINDOW`. `lib/href.ts` gained `openHref` and `goBackTo`, which pop down to a tab already in the stack (`router.dismissTo`) rather than stacking a second one. With nothing left in the tab navigator but the four tabs, `GlassTabBar` lost `hidesTabBar` and its branch for a pushed screen over the tabs: a pushed screen now covers the bar, + and all. Route paths didn't change (groups don't show in a path), so links, notification targets and `frapp://event-details` in exported calendar files still resolve; the redirects that named the group (`/(tabs)`) now name `/`.

**The tabs change touched `app/(app)/_layout.tsx`, `app/(app)/(tabs)/_layout.tsx` and `lib/href.ts`, as an integrator change** (2026-11-12, owner pick, [#4610](https://github.com/pdcarlson/Frapp/issues/4610)). `activity.tsx` moved into the tab group and `tasks.tsx` out of it onto the stack, so the stack layout swapped its `activity` registration for `tasks`, the tab layout registers Chat, Activity, Calendar (the `events` route) and More, and `lib/href.ts`'s tab list (`TAB_PATHS`) follows, so a link to `/activity` pops down to the tab and a link to `/tasks` pushes the board. Route paths didn't change, so every link and notification target still resolves. JS only, so it ships over the air.

**The You tab touched `app/(app)/_layout.tsx`, `app/(app)/(tabs)/_layout.tsx` and `lib/href.ts`, as an integrator change** (2026-11-12, #3839, the second step of the owner's pick on [#4610](https://github.com/pdcarlson/Frapp/issues/4610)). The tab route `more` became `you`, so the tab layout registers `you` with the member's avatar as its glyph (`components/you-tab-avatar.tsx`), and `TAB_PATHS` swaps `/more` for `/you`. The pushed `profile` route is gone, since the profile is the tab, so the stack layout drops its registration. Every link the app wrote to `/more` (the back rows, the minutes and dues redirects, host check-in's way out) now writes `/you`; no notification target or push ever named `/more` or `/profile`, so nothing sent before the change dangles. JS only, so it ships over the air.

**The Messages slide touched `app/(app)/_layout.tsx`, as an integrator change** (2026-11-13, Shawn's ask, [#4447](https://github.com/pdcarlson/Frapp/issues/4447)). The `messages` registration sets `animation: "ios_from_right"` (react-native-screens 4.26.2: iOS's push on Android, the default transition on iOS), so Messages comes in from the right on Android as it already did on iOS, matching the swipe left on Chat home ([§ Global entries](#global-entries-outside-the-tab-bar)). No route was added or removed, and no other screen's option changed. Swipe-back is untouched: the gesture isn't an option of the animation, and `gestureEnabled` stays unset. JS only, so it ships over the air.

**The Messages tab touched `app/(app)/_layout.tsx`, `app/(app)/(tabs)/_layout.tsx` and `lib/href.ts`, as an integrator change** (2026-11-17, [#5310](https://github.com/frapplive/Frapp/issues/5310) step 2, Paul's direction B). `messages.tsx` moved into the tab group and `events.tsx` out of it onto the stack, so the tab layout registers Chat, Activity, Messages and You, and the stack swaps its `messages` registration (and #4447's `ios_from_right`, which only matched the retired swipe) for `events`, plus a new `calendar-day` route for one day's hour grid. `lib/href.ts`'s `TAB_PATHS` follows, so a link to `/messages` pops down to the tab and a link to `/events` pushes the month. Route paths didn't change, so every link and notification target still resolves. JS only, so it ships over the air.

**The bar's fold touched `components/screen-shell.tsx`, as an integrator change** (2026-11-17, #4904, Paul's pick of direction A on the [design page](https://claude.ai/artifact/NCtLdmLop59itrbC6Uku5d)). The shell's scroll view spreads `useBarScroll()` from `lib/floating-chrome.tsx` (its scroll, content-size and layout handlers) on a tab screen only; a pushed screen gets none. The floating chrome keeps whether the bar is folded (`useBarFolded`) by the rule in `barFoldAfterScroll`, whose thresholds are `BAR_FOLD`, and a tab screen unfolds it as it gains or loses focus. No prop changed and nothing is drawn differently yet: the tab bar reading the fold is its own change. A screen with its own list opts in the same way. JS only.

**The launch logo touched `app/_layout.tsx`, as an integrator change** (2026-11-18, [#5449](https://github.com/frapplive/Frapp/issues/5449), Paul's pick on the [proposal page](https://claude.ai/artifact/XUfPohiqQviPXxtLVu7mCR)). The layout no longer hides the native splash once Figtree registers: it mounts the app under `LaunchCover` (`components/launch-cover.tsx`), which hides the splash under the same emblem and covers the app until its first screen is ready ([§ The launch logo](#the-launch-logo)). The provider tree moved, unchanged, into a `RootProviders` component beside it. No route, provider order or screen option changed. JS only, so it ships over the air.

**The task screen touched `app/(app)/_layout.tsx`, as an integrator change** (2026-11-18, [#5492](https://github.com/frapplive/Frapp/issues/5492) step 2, Paul's pick on its design page). The stack registers `task-details`, one task as a pushed screen that replaces the task sheets, titled "Task" on a back capsule (`SCREEN_TITLES`). Its backing file redirects to `/tasks` until the screen's own PR fills it, and nothing links to it before then. No other route or screen option changed. JS only, so it ships over the air.
