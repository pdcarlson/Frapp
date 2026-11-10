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
| Create chapter (`/(auth)/create-chapter`) | Primer, only when the build can push: Turn on / Not now | OS prompt on Turn on; either answer opens the invite step, or chat when the new chapter couldn't be made active |
| Create chapter (`/(auth)/create-chapter`) | Share invite (the gold primary), Skip for now / Go to chat (the quiet line under it) | Each Share invite press mints a link (`POST /v1/invites`) and opens the share sheet with it; once sent it lists under Shared as Link n. On iOS a sheet closed without sending keeps its link for the next press and lists nothing; Android's chooser can't report that, so a backed-out chooser lists its link too (expected). The quiet line replaces into `/` |
| Invite members (`/invite`) | As a President: More › Invite members, Directory's +, the tab bar's + › Invite, Chat home's Invite members line | Each opens Invite members (back capsule reads More, Directory, the tab the + was opened over, Chat; the edge swipe and Android back pop to the same screen). Invite by email: typing an address and pressing Send invite (chapter accent) emails it web's invite and lists it under Invited as Pending. Share invite opens the share sheet with "Join <chapter> on Frapp" and a fresh link (a Mail target gets that line as its subject); the link lists under Invited as Invite link and turns Joined after it is redeemed. Tapping a pending row offers Share link, Send again (emailed only) and Revoke invite. As a Member none of the four doors is drawn |

Magic-link rows additionally need `frapp://` allowlisted in Supabase Auth →
URL Configuration (#765), or the link opens the web app instead.

## 2) Primary tab routes

The bar carries four tabs. Home and Points were removed and Profile left the bar
in the S2 nav restructure (#957) — see
[`spec/ui/mobile/navigation.md`](../../spec/ui/mobile/navigation.md).

| Screen | Control | Expected outcome |
|---|---|---|
| Chat (`/`) | Open #general thread preview | Opens `chat-thread` route |
| Events (`/(app)/(tabs)/events`) | Open event details | Opens `event-details` route |
| Any tab | The + beside the tab bar | Opens the quick-actions panel; New task (shown only with `tasks:manage` and `members:view`) and New event (shown only with `events:create` and `members:view`) open their sheets over the current tab, and a create confirms above the bar. Events draws no + of its own. Press and hold the panel to edit it |
| More (`/(app)/(tabs)/more`) | Each row | Opens selected route. The exception is Host check-in (shown with `events:update`): with no upcoming event it reads "No upcoming event" and is disabled |

## 3) Detail routes with action controls

| Screen | Control | Expected outcome |
|---|---|---|
| Event details | `‹ Events` above the title, opened from Events | Slides back to the Events tab. Opened from Chat home's Up next the row reads `‹ Chat` and lands there; opened cold from a notification or a `frapp://` link it reads `‹ Chat` and lands on Chat home |
| Study hours, Service hours, Dues, Documents, Directory, Profile, Settings | `‹ More` above the title | Slides back to the More tab |
| Every screen past the four tabs (a channel, event details, each More page, Notifications, Check in, Host check-in) | iOS: swipe right from the left edge. Android: back button, or the back gesture | Goes back to the screen that opened it (a channel to the channel list), the same place its drawn `‹`, back capsule or ✕ goes. No screen ignores the swipe |
| Chat thread | Open a photo, zoom in, drag it from near the left edge; then close the viewer and swipe from the edge | The drag pans the photo and the thread stays; once the viewer is closed the swipe goes back to the channel list. Android back with the viewer open closes the viewer only |
| Dues | Pay, finish the Stripe sheet, swipe back at once, open Dues again | The invoice still reads Pending with "Payment received, confirmation pending", and Pay doesn't offer to pay it as new |
| Notifications | Tap a task notification | Lands on the Tasks tab with one tab bar, and back from there doesn't return to a second copy of the tabs |
| Profile (`/(app)/profile`) | Edit, change a field, Save | The sheet opens on your current details; Save stays off until something changes; saving closes the sheet onto the new value; a changed name also shows in Directory and on your chat messages, and a changed city or company in Directory, without a restart |
| Profile (`/(app)/profile`) | Edit, clear the name, or enter a graduation year like 1850 | Refused inline under the field, Save stays off, nothing is sent |
| Profile (`/(app)/profile`) | Edit, Save with no connection | "That didn't save" under the fields; what you typed is still there |
| Documents (`/(app)/documents`) | Open as the President, then as a plain member | The President sees an upload arrow at the right end of `‹ More`; a member sees none |
| Documents (`/(app)/documents`) | Upload arrow, choose a photo, type a title, tap a folder, Upload | The sheet shows the photo's name and size; nothing uploads until Upload; Upload closes the sheet at once, a row with the title and a gray "Uploading…" heads the list, and within a few seconds the document takes that row's place and opens. With the network off, the row reads "Didn't upload. Tap to try again." and a tap reopens the sheet on the draft |
| Documents (`/(app)/documents`) | Upload with no connection | The sheet closes and the pending row reads "Didn't upload. Tap to try again."; tapping it reopens the sheet with "Couldn't upload that photo" and the photo, title and folder still there; if the photo had already gone up, the title and folder stop taking edits; Upload works once you're back online and files one document |
| Documents (`/(app)/documents`) | After a failed upload, swipe the sheet down, reopen it from the row, Upload | The reason, photo, title and folder are still there, and one document is filed; Cancel instead removes the row |
| Notifications (`/(app)/notifications`) | `‹ Chat` above the title | Slides back to Chat home |
| Chat thread | Retry failed upload | Requeues retry state + feedback |
| Chat thread | Queue message | Queues message + feedback |
| Chapter picker | Chapter row, the one marked Current included (multi-chapter account only) | Activates, refreshes the session, lands in the tabs. When it fails, whether it stays with the error or still lands in the tabs is the rule in [`screens.md`'s supporting-routes paragraph](../../spec/ui/mobile/screens.md) |
| Chapter picker (More → Switch chapter) | `‹ More` above the title, and again while a switch is running | Lands on the More tab; while a switch runs it is dimmed and does nothing. Opened from a `frapp://chapter-picker` link, the picker draws no row |
| Study hours | Study zone row (2+ zones) | Opens the zone picker sheet; picking one closes it and updates the card |
| Study hours | Start session (location not yet granted) | Opens the **primer sheet first**, never the OS prompt — "Not now" dismisses quietly |
| Study hours | Start session (location granted) | Session card replaces the start card; the timer ticks |
| Study hours | Background the app for under the grace window, then return | Card shows paused on leave, resumes on return, and credited time does not jump |
| Study hours | Background the app for longer than the grace window | Returning surfaces the closed-session notice; the row lands in RECENT SESSIONS |
| Study hours | End session | Native destructive `Alert` confirm; cancelling leaves the session running |
| Dues | Pay now (Expo Go) | CTA is **disabled with the reason stated**; balance and history still render |
| Dues | Pay now (installed build, key configured) | Stripe PaymentSheet opens; dismissing it says nothing |
| Dues | Complete a payment | Shows "payment received, confirmation pending", then flips to Paid only once the webhook lands |
| Chat home (`/`) and Events (`/(app)/(tabs)/events`) | Header, flag **off** (the default) | **No ✦ Ask pill at all**. Events shows nothing beside the title; Chat home shows only the notifications bell. This is the state a build gets when nothing sets `EXPO_PUBLIC_ASK_ENABLED`. A pill here, or one that opens a sheet saying Ask is off, is the placeholder #2259 removed |
| Chat home (`/`) | Notifications bell, with unread notifications | Shows a house-gold badge counting unread notifications that are not chat messages (those are badged on the channel rows); tapping opens Notifications. With none unread, the bell shows no badge |
| `frapp://ask` | Open the link, flag **off** | Lands on Chat home. No "Ask" screen, no sheet |
| Chat home (`/`) | ✦ Ask pill, flag **on** (`EXPO_PUBLIC_ASK_ENABLED=1` in a local build) | Presents the s17 Ask sheet over the screen, with the scrim behind it; the grabber or a tap on the scrim dismisses it (there is **no** Cancel control, by design) |
| Events (`/(app)/(tabs)/events`) | ✦ Ask pill, flag **on** | Same sheet, same behavior |
| Ask sheet | Send a question, flag **on** | Question echoes, a content-shaped skeleton holds briefly, then an answer card with source chips — or the refusal / "I don't know" path. Answers come from a **mock corpus**; do not read them as real chapter data |
| Ask sheet | Tap a source chip | Says the citation is a sample with nothing behind it to open. A chip that swallowed the tap would be the dead end this checklist exists to catch |
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
