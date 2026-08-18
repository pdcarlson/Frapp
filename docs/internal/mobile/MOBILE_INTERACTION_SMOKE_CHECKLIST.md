# Mobile Interaction Smoke Checklist

> Last updated: 2026-08-08  
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

## 4) Interaction quality assertions

Run these assertions during manual walkthrough:

1. No tap on a button-like control is ignored.
2. Every action provides immediate visible feedback (state, text, route, or status change).
3. Disabled actions include explicit reason copy.
4. Route guards enforce auth boundaries:
   - unauthenticated users cannot access tab routes,
   - authenticated users are redirected away from auth routes.

## 5) PR evidence requirements

For UI-touching mobile changes, include:

- walkthrough artifact (video or screenshot set),
- checklist pass/fail matrix for touched routes,
- note any intentionally disabled controls and user-facing reason copy.
