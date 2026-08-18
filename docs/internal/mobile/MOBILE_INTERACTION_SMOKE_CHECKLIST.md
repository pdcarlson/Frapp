# Mobile Interaction Smoke Checklist

> Last updated: 2026-08-18  
> Scope: `apps/mobile` Expo workflows

This checklist prevents dead-end controls in mobile UX.  
Rule: **if a control looks interactive, it must do something** (navigate, mutate, open, or show explicit disabled reason).

## 1) Auth flow

Auth is real Supabase auth (#698) — these rows need a build carrying
`EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` and a real member
account. Without them the sign-in card reports "Auth provider: Not configured"
and every row below is expected to fail.

| Screen | Control | Expected outcome |
|---|---|---|
| Sign in (`/(auth)/sign-in`) | Password / Magic Link mode chips | Toggles selected mode styling; password field shows in Password mode only |
| Sign in (`/(auth)/sign-in`) | Sign in (Password mode) | Authenticates against Supabase + routes to `/(tabs)` |
| Sign in (`/(auth)/sign-in`) | Sign in, wrong password | Shows the Supabase error inline; stays on the screen |
| Sign in (`/(auth)/sign-in`) | Email me a link (Magic Link mode) | Confirms "Link sent to …"; tapping the emailed link on the device signs in and routes to `/(tabs)` |
| Sign in (`/(auth)/sign-in`) | Tap an already-used or expired magic link | Opens the app and shows the reason inline — never a silent return to a blank sign-in form |
| Profile (`/(tabs)/profile`) | Sign out | Clears the session + routes to sign-in; relaunching the app does not restore it |

Magic-link rows additionally need `frapp://` allowlisted in Supabase Auth →
URL Configuration (#765), or the link opens the web app instead.

## 2) Primary tab routes

The bar carries four tabs. Home and Points were removed and Profile left the bar
in the S2 nav restructure (#957) — see
[`spec/ui/mobile/navigation.md`](../../../spec/ui/mobile/navigation.md).

| Screen | Control | Expected outcome |
|---|---|---|
| Chat (`/(tabs)`) | Open #general thread preview | Opens `chat-thread` route |
| Events (`/(tabs)/events`) | Open event details | Opens `event-details` route |
| Tasks (`/(tabs)/tasks`) | Back to more | Opens `more` route |
| More (`/(tabs)/more`) | Each row | Opens selected route (several are stubs) |

## 3) Detail routes with action controls

| Screen | Control | Expected outcome |
|---|---|---|
| Event details | Add to Calendar (.ics) | Starts `.ics` export flow or surfaces retry guidance |
| Chat thread | Retry failed upload | Requeues retry state + feedback |
| Chat thread | Queue message | Queues message + feedback |
| Chapter picker | Chapter row (multi-chapter account only) | Activates, refreshes the session, lands in the tabs |
| Study hours | Study zone row (2+ zones) | Opens the zone picker sheet; picking one closes it and updates the card |
| Study hours | Start session (location not yet granted) | Opens the **primer sheet first**, never the OS prompt — "Not now" dismisses quietly |
| Study hours | Start session (location granted) | Session card replaces the start card; the timer ticks |
| Study hours | Background the app for under the grace window, then return | Card shows paused on leave, resumes on return, and credited time does not jump |
| Study hours | Background the app for longer than the grace window | Returning surfaces the closed-session notice; the row lands in RECENT SESSIONS |
| Study hours | End session | Native destructive `Alert` confirm; cancelling leaves the session running |
| Dues | Pay now (Expo Go) | CTA is **disabled with the reason stated**; balance and history still render |
| Dues | Pay now (installed build, key configured) | Stripe PaymentSheet opens; dismissing it says nothing |
| Dues | Complete a payment | Shows "payment received, confirmation pending", then flips to Paid only once the webhook lands |
| Chat home (`/(tabs)`) | ✦ Ask pill | Presents the s17 Ask sheet over the screen, with the scrim behind it; the grabber or a tap on the scrim dismisses it (there is **no** Cancel control, by design) |
| Events (`/(tabs)/events`) | ✦ Ask pill | Same sheet, same behavior — the s06 pill is new in C7 |
| Ask sheet | Send a question, flag **off** (the default) | Sheet states why Ask is unavailable, the composer and send are disabled with that reason wired to the control, and the suggestion chips are omitted rather than dimmed. **This is the shipped state**: nothing sets `EXPO_PUBLIC_ASK_ENABLED` |
| Ask sheet | Send a question, flag **on** (`EXPO_PUBLIC_ASK_ENABLED=1` in a local build) | Question echoes, a content-shaped skeleton holds briefly, then an answer card with source chips — or the refusal / "I don't know" path. Answers come from a **mock corpus**; do not read them as real chapter data |
| Ask sheet | Tap a source chip | Says the citation is a sample with nothing behind it to open. A chip that swallowed the tap would be the dead end this checklist exists to catch |
| Notifications (`/(tabs)/notifications`) | Tap a row with a recognizable target | Marks it read **and** routes to the target (chat thread, event detail, tasks, dues, service hours, directory) |
| Notifications (`/(tabs)/notifications`) | Tap a row whose target this build does not recognize | Marks it read and stays put — never a navigation to a wrong or dead screen |
| Settings (`/(tabs)/preferences`) | Push notifications row | Reads On / Off / Unavailable and opens the OS settings app. Changing the permission there and returning updates the row on the next foreground — it does **not** need a relaunch |

## 4) Connection states and write gating

Force these with airplane mode, or by pointing `EXPO_PUBLIC_API_URL` at a dead
host for the DEGRADED/OFFLINE-from-health path (three consecutive failed
`/health` polls, 30s apart).

| Screen | Control | Expected outcome |
|---|---|---|
| Any tab | Enter airplane mode | The banner appears at the top over ~200ms (an opacity transition, not a slide — see [`spec/ui/resilience.md`](../../../spec/ui/resilience.md) § 2), below the status bar and never under it, reading "You're offline. Showing cached data." Cached content stays on screen |
| Any tab | Dismiss the banner | It fades out and returns after 30s if the connection has not recovered; a change of state clears the dismissal on its own. Expect the bar's **space** to remain while dismissed — known drift, recorded in § 2 |
| Any tab | Leave airplane mode | The banner leaves without a tap, and stale queries refetch on their own — `onlineManager` is wired, so no force-quit is needed |
| Chat thread | Compose and send while offline | The composer stays **enabled** and labels itself "You're offline — messages send when you reconnect."; the message queues and sends on reconnect. A disabled composer here is a regression — the outbox is the point |
| Chat thread | Offline with the global banner up | The in-thread pill does **not** repeat "Offline"; it stays silent unless it has something the banner cannot say ("Real-time updates paused. Polling for new messages." or "Reconnecting…") |
| Service hours (s20 sheet) | Submit while offline | Submit is disabled, "Reconnect to make changes." is shown **and** read out as the button's hint. There is no queue here — a lost submit would be silent |
| Check-in (s18) | Manual code submit while offline | Same: disabled with the reason stated. The camera keeps scanning — reading a QR code is local, and a latched read the member can retry beats a dead viewfinder |

## 5) Push notifications — **not verifiable in Expo Go**

Remote push cannot be exercised from any build that currently exists, and no row
here should be checked off from a Go session:

- Expo Go dropped remote push in SDK 53, so `expo-notifications` is not even
  loaded there.
- `getExpoPushTokenAsync` needs an EAS `projectId` and **no EAS project exists**
  (#938, open and `[human]`). `isPushAvailable()` is therefore false in an
  installed build too.

What *can* be checked today:

| Screen | Control | Expected outcome |
|---|---|---|
| Settings (`/(tabs)/preferences`) | Push notifications row, Expo Go | Reads "Unavailable" with the Expo Go sentence — not "Off", which would imply a switch the member could flip |
| Study hours | Background the app mid-session (installed build) | A local "Study session paused" notification appears; returning clears it. **Local** notifications need the native module but no project id, so this is the one push-shaped path that works without #938 — and it does nothing in Expo Go |
| Study hours | End a session while paused | The paused notification is cleared rather than left inviting the member back to a session that no longer exists |

Once #938 lands and a dev build exists, add rows for: the s03 primer card
(built, currently hosted nowhere — see `spec/ui/mobile/screens.md` s03), the OS
prompt firing **only** after the primer's "Turn on", token register on sign-in /
deregister on sign-out, a tap deep-linking from a cold start, and a foregrounded
notification actually presenting.

## 6) Interaction quality assertions

Run these assertions during manual walkthrough:

1. No tap on a button-like control is ignored.
2. Every action provides immediate visible feedback (state, text, route, or status change).
3. Disabled actions include explicit reason copy.
4. Route guards enforce auth boundaries:
   - unauthenticated users cannot access tab routes,
   - authenticated users are redirected away from auth routes.

## 7) PR evidence requirements

For UI-touching mobile changes, include:

- walkthrough artifact (video or screenshot set),
- checklist pass/fail matrix for touched routes,
- note any intentionally disabled controls and user-facing reason copy.
