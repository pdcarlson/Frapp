# Mobile Interaction Smoke Checklist

> Last updated: 2026-03-09  
> Scope: `apps/mobile` Expo preview workflows

This checklist prevents dead-end controls in mobile UX.  
Rule: **if a control looks interactive, it must do something** (navigate, mutate, open, or show explicit disabled reason).

## 1) Auth flow

| Screen | Control | Expected outcome |
|---|---|---|
| Sign in (`/(auth)/sign-in`) | Continue with email | Creates preview session + routes to `/(tabs)` |
| Sign in (`/(auth)/sign-in`) | Use magic link | Creates preview session with magic-link mode + routes to `/(tabs)` |
| Sign in (`/(auth)/sign-in`) | Password / Magic Link mode chips | Toggles selected mode styling and state |
| Profile (`/(tabs)/profile`) | Sign out of preview session | Clears preview session + routes to sign-in |

## 2) Primary tab routes

| Screen | Control | Expected outcome |
|---|---|---|
| Home (`/(tabs)`) | All nav tiles/links | Opens target route |
| Chat (`/(tabs)/chat`) | Open #general thread preview | Opens `chat-thread` route |
| Events (`/(tabs)/events`) | Open event details | Opens `event-details` route |
| Points (`/(tabs)/points`) | Open leaderboard details | Opens `points-details` route |
| More (`/(tabs)/more`) | Each utility tile | Opens selected utility route |

## 3) Detail routes with action controls

| Screen | Control | Expected outcome |
|---|---|---|
| Event details | Add to Calendar (.ics) | Starts `.ics` export flow or surfaces retry guidance |
| Chat thread | Retry failed upload | Requeues retry state + feedback |
| Chat thread | Queue message | Queues message + feedback |
| Points details | Time-window chips | Changes active chip + swaps leaderboard dataset |
| Notification targets | Target rows | Opens mapped destination route |

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
