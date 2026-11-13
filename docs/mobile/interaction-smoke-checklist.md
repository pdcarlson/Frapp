# Mobile interaction smoke checklist

> Scope: `apps/mobile` Expo workflows

This checklist prevents dead-end controls in mobile UX.  
Rule: **if a control looks interactive, it must do something** (navigate, mutate, open, or show explicit disabled reason).

## 1) Auth flow

Auth is real Supabase auth (#698) — these rows need a build carrying
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` and a real member
account. Without them sign-in is unavailable and every row below is expected
to fail; [`testing.md` § 1](testing.md#1-provide-the-environment) quotes what
the sign-in screen says. The Terms rows, and the Terms checkbox in the Join rows,
came with #2302 (PR #2611).

| Screen | Control | Expected outcome |
|---|---|---|
| Sign in (`/(auth)/sign-in`) | First view | The phone's own account leads as the one filled button: Continue with Apple then Continue with Google on iOS; Continue with Google on Android, then Continue with email, then Other ways to sign in. No Apple button on Android until Other ways to sign in is tapped |
| Sign in (`/(auth)/sign-in`) | Other ways to sign in (Android) | Reveals Continue with Apple and the Hide My Email hint; an account made with Apple on an iPhone signs in through Apple's web page |
| Sign in (`/(auth)/sign-in`) | Continue with email, then back | Opens the email form titled "Sign in with email"; the gold ‹ Back row, and on Android the system back button, return to the first view without leaving the app |
| Sign in (`/(auth)/sign-in`) | Password / Magic link mode chips (after Continue with email) | Toggles the gold selected-mode styling; password field shows in Password mode only |
| Sign in (`/(auth)/sign-in`) | Sign in (Password mode) | Authenticates against Supabase; the auth gate then routes to join (zero memberships), the Terms prompt (a member who hasn't accepted the current Terms, which every seeded account is after a reseed), welcome (`has_completed_onboarding === false`), or `/` |
| Sign in (`/(auth)/sign-in`) | Sign in, wrong password | Shows the Supabase error inline; stays on the screen |
| Sign in (`/(auth)/sign-in`) | Email me a link (Magic link mode) | Confirms "Link sent to …"; tapping the emailed link on this device signs in and the auth gate picks join / Terms / welcome / tabs |
| Sign in (`/(auth)/sign-in`) | Tap an already-used or expired magic link | Opens the app and shows the reason inline — never a silent return to a blank sign-in form |
| Settings (`/(app)/preferences`) | Sign out | Clears the session + routes to sign-in; relaunching the app does not restore it |
| Join (`/(auth)/join`) | First view | Asks "How are you getting in?" with I have an invite and I'm starting our chapter; no invite field; `Signed in as <email> · Sign out` under the header, and no Delete account until Account is tapped |
| Join (`/(auth)/join`) | Open an invite link while signed in with no chapter | Skips the question and the field: "Join <chapter>?" opens with the chapter's mark, name and school, who invited you and the role |
| Join (`/(auth)/join`) | Account (top corner) | Shows the signed-in email and Delete account (Sign out is on the screen's face); tapping outside, or Android back, closes it |
| Join (`/(auth)/join`) | I have an invite, then back | Opens "Join with an invite"; the gold ‹ Back row and Android back return to the question without leaving the app |
| Join (`/(auth)/join`) | Paste an invite, Continue, then back | Continue opens the "Join <chapter>?" card without using the invite; back returns to the field with the invite still in it |
| Join (`/(auth)/join`) | Join chapter with a valid invite, box unticked | For a user who hasn't accepted the current Terms, shows the checkbox and `Agree to the Terms of Service and Privacy Policy to join.`; redeems nothing |
| Join (`/(auth)/join`) | Join chapter with a valid invite, box ticked (or already accepted, no box shown) | Redeems `POST /v1/invites/redeem`, selects the chapter, lands on welcome (s03) |
| Join (`/(auth)/join`) | Expired / already-used invite | The confirm step shows the 410 sentence and Join chapter is disabled; back leads to the field |
| Join (`/(auth)/join`) | I'm starting our chapter | Opens `(auth)/create-chapter` |
| Terms (`/(auth)/terms`) | Agree and continue, box unticked | Shows `Agree to the Terms of Service and Privacy Policy to continue.`; records nothing |
| Terms (`/(auth)/terms`) | Tick the box, Agree and continue | `POST /v1/users/me/legal-acceptance`; the gate moves on to welcome or `/` |
| Terms (`/(auth)/terms`) | Sign out / Delete account | Sign out routes to sign-in; Delete account confirms, deletes, and signs out (Settings is unreachable from here) |
| Welcome (`/(auth)/welcome`) | Go to chat (the one button, pinned at the bottom) | PATCHes `has_completed_onboarding: true` and replaces into `/` |
| Chapter picker (empty) | Join or start a chapter | Opens join (s02), which asks invite or start |
| Create chapter (`/(auth)/create-chapter`) | Directory row → Continue → color + Terms → Create; or Not in our directory? → fields + archetype → Continue | `POST /v1/chapters/onboard`; the later steps stay on this route. A FIJI row shows no letters anywhere |
| Create chapter (`/(auth)/create-chapter`) | The gold ‹ Back row (find, confirm and color) / Android back (confirm and color) | Steps back one; on find, the row leaves for join |
| Create chapter (`/(auth)/create-chapter`) | Live: Add your chapter's logo / Continue | Optional picker → `POST /v1/chapters/current/logo-url`, PUT, `POST /v1/chapters/current/logo`; the mark becomes the logo. A success haptic plays on arrival |
| Create chapter (`/(auth)/create-chapter`) | Pick your chat display: a card / Continue | The phone's current display is checked on arrival; a tap checks and saves that card; Continue keeps it and moves on (#4056) |
| Create chapter (`/(auth)/create-chapter`) | Primer, only when the build can push: Turn on / Not now | OS prompt on Turn on; either answer opens the invite step, or chat when the new chapter couldn't be made active |
| Create chapter (`/(auth)/create-chapter`) | Share invite (the gold primary), Skip for now / Go to chat (the quiet line under it) | Each Share invite press mints a link (`POST /v1/invites`) and opens the share sheet with it; once sent it lists under Shared as Link n. On iOS a sheet closed without sending keeps its link for the next press and lists nothing; Android's chooser can't report that, so a backed-out chooser lists its link too (expected). The quiet line replaces into `/` |
| Invite members (`/invite`) | As a President: You › Invite members, Directory's +, the tab bar's + › Invite, Chat home's Invite members line | Each opens Invite members (back capsule reads You, Directory, the tab the + was opened over, Chat; the edge swipe and Android back pop to the same screen). Invite by email: typing an address and pressing Send invite (chapter accent) emails it web's invite and lists it under Invited as Pending. Share invite opens the share sheet with "Join <chapter> on Frapp" and a fresh link (a Mail target gets that line as its subject); the link lists under Invited as Invite link and turns Joined after it is redeemed. Tapping a pending row offers Share link, Send again (emailed only) and Revoke invite. As a Member none of the four doors is drawn |

Magic-link rows additionally need `frapp://` allowlisted in Supabase Auth →
URL Configuration (#765), or the link opens the web app instead.

## 2) Primary tab routes

The bar carries four tabs. Home and Points were removed and Profile left the bar
in the S2 nav restructure (#957) — see
[`spec/ui/mobile/navigation.md`](../../spec/ui/mobile/navigation.md).

| Screen | Control | Expected outcome |
|---|---|---|
| Chat (`/`) | Open #general thread preview | Opens `chat-thread` route |
| Chat (`/`) | The bell beside Messages | Opens Notifications, with `‹ Chat`; its count is house gold and leaves out chat |
| Events (`/(app)/(tabs)/events`) | Open event details | Opens `event-details` route |
| Any tab | The + beside the tab bar | Opens the quick-actions panel; New task (shown only with `tasks:manage` and `members:view`) and New event (shown only with `events:create` and `members:view`) open their sheets over the current tab, and a create confirms above the bar. Events draws no + of its own. Press and hold the panel to edit it |
| You (`/(app)/(tabs)/you`) | Your name, a Details row that is yours to set, and Status | The name and the row open the edit sheet; Status opens the status sheet |
| You (`/(app)/(tabs)/you`) | Each row | Opens selected route. The exception is Host check-in (shown with `events:update`): with no upcoming event it reads "No upcoming event" and is disabled |

## 3) Detail routes with action controls

| Screen | Control | Expected outcome |
|---|---|---|
| Event details | `‹ Calendar` above the title, opened from Calendar | Slides back to the Calendar tab. Opened from Chat home's Up next the row reads `‹ Chat` and lands there; opened cold from a notification or a `frapp://` link it reads `‹ Chat` and lands on Chat home |
| Study hours, Service hours, Dues, Documents, Directory, Settings | `‹ You` above the title | Slides back to the You tab |
| Every screen past the four tabs (a channel, event details, each You page, Notifications, Check in, Host check-in) | iOS: swipe right from the left edge. Android: back button, or the back gesture | Goes back to the screen that opened it (a channel to the channel list), the same place its drawn `‹`, back capsule or ✕ goes. No screen ignores the swipe |
| Chat thread | Open a photo, zoom in, drag it from near the left edge; then close the viewer and swipe from the edge | The drag pans the photo and the thread stays; once the viewer is closed the swipe goes back to the channel list. Android back with the viewer open closes the viewer only |
| Dues | Pay, finish the Stripe sheet, swipe back at once, open Dues again | The invoice still reads Pending with "Payment received, confirmation pending", and Pay doesn't offer to pay it as new |
| Notifications | Tap a task notification | Opens the task board over the screen you were on (a pushed screen since #4610), and back returns to that screen |
| Profile (the top of the You tab) | Tap your name or a Details row, change a field, Save | The sheet opens on your current details; Save stays off until something changes; saving closes the sheet onto the new value; a changed name also shows in Directory and on your chat messages, and a changed city or company in Directory, without a restart |
| Profile (the top of the You tab) | Tap your name, clear it, or enter a graduation year like 1850 | Refused inline under the field, Save stays off, nothing is sent |
| Profile (the top of the You tab) | Tap your name, Save with no connection | "That didn't save" under the fields; what you typed is still there |
| Documents (`/(app)/documents`) | Open as the President, then as a plain member | The President sees an upload arrow at the right end of `‹ You`; a member sees none |
| Documents (`/(app)/documents`) | Upload arrow, choose a photo, type a title, tap a folder, Upload | The sheet shows the photo's name and size; nothing uploads until Upload; Upload closes the sheet at once, a row with the title and a gray "Uploading…" heads the list, and within a few seconds the document takes that row's place and opens. With the network off, the row reads "Didn't upload. Tap to try again." and a tap reopens the sheet on the draft |
| Documents (`/(app)/documents`) | Upload with no connection | The sheet closes and the pending row reads "Didn't upload. Tap to try again."; tapping it reopens the sheet with "Couldn't upload that photo" and the photo, title and folder still there; if the photo had already gone up, the title and folder stop taking edits; Upload works once you're back online and files one document |
| Documents (`/(app)/documents`) | After a failed upload, swipe the sheet down, reopen it from the row, Upload | The reason, photo, title and folder are still there, and one document is filed; Cancel instead removes the row |
| Notifications (`/(app)/notifications`) | `‹ Chat` above the title | Slides back to Chat home |
| Chat thread | Retry failed upload | Requeues retry state + feedback |
| Chat thread | Queue message | Queues message + feedback |
| Chapter picker | Chapter row, the one marked Current included (multi-chapter account only) | Activates, refreshes the session, lands in the tabs. When it fails, whether it stays with the error or still lands in the tabs is the rule in [`screens.md`'s supporting-routes paragraph](../../spec/ui/mobile/screens.md) |
| Chapter picker (You → Switch chapter) | `‹ You` above the title, and again while a switch is running | Lands on the You tab; while a switch runs it is dimmed and does nothing. Opened from a `frapp://chapter-picker` link, the picker draws no row |
| Study hours | Study zone row (2+ zones) | Opens the zone picker sheet; picking one closes it and updates the card |
| Study hours | Start session (location not yet granted) | Opens the **primer sheet first**, never the OS prompt — "Not now" dismisses quietly |
| Study hours | Start session (location granted) | Session card replaces the start card; the timer ticks |
| Study hours | Background the app for under the grace window, then return | Card shows paused on leave, resumes on return, and credited time does not jump |
| Study hours | Background the app for longer than the grace window | Returning surfaces the closed-session notice; the row lands in RECENT SESSIONS |
| Study hours | End session | Native destructive `Alert` confirm; cancelling leaves the session running |
| Dues | Pay now (Expo Go) | CTA is **disabled with the reason stated**; balance and history still render |
| Dues | Pay now (installed build, key configured) | Stripe PaymentSheet opens; dismissing it says nothing |
| Dues | Complete a payment | Shows "payment received, confirmation pending", then flips to Paid only once the webhook lands |
| Any tab | On a server with AI off (`AI_ENABLED` unset, the default) or for a member without Ask | **No Ask Frapp bar** above the tab bar, and the + panel shows the member's actions with no Ask row. Chat home's header holds only Messages and the bell; Events shows nothing beside its title. No ✦ pill anywhere (removed 2026-11-12) |
| Chat home (`/`) | Notifications bell, with unread notifications | Shows a house-gold badge counting unread notifications that are not chat messages (those are badged on the channel rows); tapping opens Notifications. With none unread, the bell shows no badge |
| `frapp://ask` | Open the link, without Ask | Lands on Chat home. No "Ask" screen, no sheet |
| Any tab | The **Ask Frapp** bar above the tab bar (server AI on, Ask on for the chapter, a role with `ai:use`) | A glass capsule with the crest in the chapter's colour and "Ask Frapp anything" sits just above the tab bar on all four tabs, is hidden while the + panel is open and on every pushed screen, and each list's last row scrolls clear of it. Tapping it presents the s17 Ask sheet at full height on the app's dark background; its X or the grabber dismisses it (there is **no** Cancel word, by design). The member's bubble and the send button are the chapter's colour. Under an answer: a "Read …" line, the source chips, then small Copy and Report icons |
| Ask sheet | First question, Frapp AI not on (chose Not now) | Meet Frapp AI opens over Ask: three lines, the line naming the companies with Privacy policy, a gold Continue and an underlined Not now. Not now, or swiping it away, sends nothing: the card says Frapp AI is off and offers Turn on Frapp AI. Continue sends the question |
| Ask sheet | An answered question | The step line sits under the words while they stream and nothing above it moves. The question sits in a bubble on the right and the answer is plain text on the left, with numbered gold markers and a row of numbered source chips under it; a document chip opens in the in-app browser over the sheet, a minutes chip closes the sheet and opens the minutes. A second question lands under the first and the sheet follows it; "And for elections?" after a quorum question is answered about quorum. Reopening the sheet shows the same conversation, and **New conversation** in the header clears it |
| Settings | **Frapp AI** switch under Account (only on a server with AI on) | Caption reads Works with the companies. Turning it on opens Meet Frapp AI; turning it off turns it off at once. A failed save says so under the switch |
| Chat home | An account that never answered Frapp AI, on a server with AI on | Meet Frapp AI opens once over Chat home a moment after launch, never on top of What's new, and not on a launch the first-run tour is due on. Continue or Not now and it does not come back; swiping it away brings it back next launch |
| Event (`/event-details`) | Minutes row, `meetings` module on | A member sees the row only once minutes they may read exist. An officer who records minutes sees **Write minutes** only where drafting from notes is offered; it opens the new draft |
| Minutes (`/minutes-details`) | A draft, as its editor | **Draft minutes** opens a tall sheet for pasted notes; the status line under the field keeps its height through drafting, done and failed. **Post** asks first. A member sees neither |
| Tasks, then the **Suggested** row | After minutes with action items are posted, as an officer who can accept them | The row sits last on Tasks and only while some are waiting. Accept makes a task at once when the minutes named who and when; otherwise the task form opens filled in. Dismiss removes one |
| Events or Tasks, then **Suggested** | "This time last year" has something waiting, as an officer who can create events | Events shows one row, "2 events from this time last year", last on the screen. In the list, **Add to calendar** opens the New event sheet filled in from last year's event on the same weekday this year; Create adds it and the row leaves with "Added to the calendar" above the list. **Already planned** and **Not this year** each remove the row in one tap. Nothing shifts while a row is being sent |
| A busy channel (`/chat-thread`) | Opened from Chat home with 20 or more new messages, summaries on for the chapter | A strip under the header says how many are new and offers **Catch me up**; × dismisses it. The sheet opens at one height and the working line sits where the first group lands. Tapping a point closes the sheet and scrolls to that message (a reply opens its thread on that reply); the strip then reads "Your summary is still here." and **Back to summary** shows the same summary at once. The header's ⋯ menu has **Catch me up** above the notification levels. Open the sheet with the keyboard up: it must not sit under the keyboard. No strip and no menu row in a DM |
| A thread with 5 or more messages | Summaries on for the chapter | **Summarize thread** sits on the reply-count line and opens the same sheet with no range control. Tapping a point scrolls the thread to that reply |
| Ask sheet, as an officer with `ai:act` | Type a request in the same field as a question | There is no Ask and Do switch. "Give 5 points to Ana and Jordan" returns a card in the conversation naming both; × removes one and **Add a member** opens a searchable roster sheet over the Ask sheet. **Confirm** replaces the card with one line saying what was done and a link to where it shows; a second request leaves the first card waiting. A task request missing who or when opens the New task sheet on **Confirm**. A member without `ai:act` who types the same words gets an answer, never a card |
| An Ask answer, a written draft in **Draft minutes**, or a suggested task | **Report this**, as a member with `ai:use` | A sheet with four reasons and an optional note. The line above **Send report** says what goes with the report and for how long before it can be sent. After sending, the action reads **Reported** in the same place. A member without `ai:use` sees no Report this |
| Notifications (`/(app)/notifications`) | Tap a row with a recognizable target | Marks it read **and** routes to the target (chat thread, event detail, tasks, dues, service hours, directory) |
| Notifications (`/(app)/notifications`) | Tap a row whose target this build does not recognize | Marks it read and stays put — never a navigation to a wrong or dead screen |
| Settings (`/(app)/preferences`) | Push notifications switch | On a fresh install (never asked), a tap shows the OS prompt and the switch follows the answer. Once granted, or once the OS stops asking, a tap opens the OS settings app; changing the permission there and returning updates the switch on the next foreground — it does **not** need a relaunch. On Android, switching off only the "Chapter notifications" category there also reads off on return. Expo Go reads Unavailable with the reason |

## 4) Connection states and write gating

Force these with airplane mode, or by pointing `EXPO_PUBLIC_API_URL` at a dead
host for the DEGRADED/OFFLINE-from-health path (three consecutive failed
`/health` polls, 30s apart).

| Screen | Control | Expected outcome |
|---|---|---|
| Any tab | Enter airplane mode | A small pill fades in over ~200ms (an opacity transition, not a slide — see [`spec/ui/resilience/connection-state.md`](../../spec/ui/resilience/connection-state.md)) just below the status bar, with a red dot and "Offline". Nothing on screen moves. Tapping the label opens "You're offline. Showing cached data."; tapping again closes it. Cached content stays on screen |
| Any tab | Dismiss the pill | It fades out and returns after 30s if the connection has not recovered; a change of state clears the dismissal on its own |
| Any tab | Leave airplane mode | The pill leaves without a tap, and stale queries refetch on their own — `onlineManager` is wired, so no force-quit is needed |
| Chat thread | Compose and send while offline | The composer stays **enabled**, with no offline line of its own; the pill's sentence (tap "Offline") reads "You're offline. Messages you send go out when you reconnect. Photos and files need a connection." The message queues and sends on reconnect. A disabled composer here is a regression — the outbox is the point |
| Chat thread | Offline, or a slow connection | Exactly one connection indicator on screen: the pill. No band under the thread header and no hint line in the composer. A slow connection reads "Slow connection", never "Slow connection" plus "Reconnecting…" |
| Service hours (s20 sheet) | Submit while offline | Submit is disabled, "Reconnect to make changes." is shown **and** read out as the button's hint. There is no queue here — a lost submit would be silent |
| Check-in (s18) | Manual code submit while offline | Same: disabled with the reason stated. The camera keeps scanning — reading a QR code is local, and a latched read the member can retry beats a dead viewfinder |

## 5) Push notifications — **not verifiable in Expo Go**

Exercise remote push on an installed build that meets the prerequisites in
[Mobile (EAS) Setup](../ops/deployment/mobile.md#61-initial-setup). Project linkage
alone is not evidence that token registration or delivery works; record actual
device results before checking off remote-push behavior.

- Expo Go dropped remote push in SDK 53, so `expo-notifications` is not even
  loaded there.
- `isPushAvailable()` checks native-module loading and the resolved EAS project
  id, not credentials, permission, or successful delivery.

Availability and local-notification checks:

| Screen | Control | Expected outcome |
|---|---|---|
| Settings (`/(app)/preferences`) | Push notifications row, Expo Go | Reads "Unavailable" with the Expo Go sentence, draws no switch, and does nothing on a tap |
| First-run (`/(auth)/welcome`, s03) | Notifications step, Expo Go | Skipped: the screen shows the channels, then "Go to chat", with no notifications step, no disabled "Turn on" and no apology ([#2299](https://github.com/pdcarlson/Frapp/issues/2299)) |
| Study hours | Background the app mid-session (installed build) | A local "Study session paused" notification appears; returning clears it. **Local** notifications need the native module but no project id and can be tested independently of remote-push setup — this does nothing in Expo Go |
| Study hours | End a session while paused | The paused notification is cleared rather than left inviting the member back to a session that no longer exists |

On an installed build meeting those prerequisites, verify: s03's `Turn on notifications` step after
`Continue` (`(auth)/welcome.tsx`) and chapter setup's (`(auth)/create-chapter.tsx`), the OS
prompt firing **only** after its "Turn on notifications", `Open Settings` in its place after an
earlier "Don't Allow", the chat home's `Notifications are off` row after a "Not now" (three days
later; clear app data or wait), token register on sign-in /
deregister on sign-out, a tap deep-linking from a cold start, and a foregrounded
notification actually presenting.

## 6) Interaction quality assertions

Run these assertions during manual walkthrough:

1. No tap on a button-like control is ignored.
2. Every action provides immediate visible feedback (state, text, route, or status change).
3. Disabled actions include explicit reason copy.
4. Route guards enforce auth boundaries:
   - unauthenticated users cannot access tab routes,
   - authenticated users with a completed membership are redirected away from sign-in / join / welcome,
   - authenticated users with zero memberships stay on join,
   - authenticated users whose active membership has `has_completed_onboarding === false` stay on welcome.

## 7) PR evidence requirements

For UI-touching mobile changes, include:

- walkthrough artifact (video or screenshot set),
- checklist pass/fail matrix for touched routes,
- note any intentionally disabled controls and user-facing reason copy.

## 8) Keyboard over the chat composer — **Android store build only**

The keyboard has covered the composer on Android twice: #3346, where the thread switched keyboard avoidance off on Android, and #4010, where the lift stopped short of the keyboard. Neither shows in a unit test, because the numbers only exist on a device, and Expo Go takes a different keyboard path entirely (`lib/keyboard.tsx`), so this runs on a Play build or a preview APK. Run it on the first such build after a change to `lib/keyboard.tsx`, to the chat thread's `SafeAreaView`, or to the `react-native-keyboard-controller` version, on Gboard with its suggestion strip showing, and note the phone, Android version, navigation mode (gesture or three-button) and build in the PR or its issue. The app is portrait only (`app.json`), so there is no rotation case.

In each case the whole message box, its rounded border and what you typed sit **directly above the keyboard's top edge**, with no gap and nothing hidden, and the newest message stays visible above it:

| Where | Check |
| --- | --- |
| A channel (#general) | Tap the box: it rises with the keyboard. Type two lines: the box grows upward and stays clear |
| A DM | The same |
| A message thread (Start thread) | The same |
| Any of the above | Open Gboard's emoji panel, then go back to letters: the box follows the keyboard's height each time |
| Any of the above | Switch keyboards (Gboard's globe or the navigation bar's keyboard button, to another installed keyboard and back) |
| Any of the above | Drag the thread down: the keyboard goes away and the box returns to the bottom, above the navigation bar |
| Any of the above | Repeat once with three-button navigation (Settings → System → Navigation mode) |
| Sign-in (Continue with email), welcome's name step, join, and each create-chapter step | Tap the lowest field: it, and the pinned Continue or Sign in, sit above the keyboard. These screens rise the same way as the composer (#4080), so run them on the same build |
