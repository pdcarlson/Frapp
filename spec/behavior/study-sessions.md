# Study Sessions — Foreground Enforcement

## Heartbeat Validation

- The client sends GPS coordinates every 5 minutes while the app is in the foreground.
- The server runs a point-in-polygon check against the selected geofence's coordinates.
- If the heartbeat shows the user is outside the polygon, the session status is set to EXPIRED and a notification is sent.
- If no heartbeat is received within 10 minutes, the session is marked EXPIRED (stale heartbeat).

## Anti-Distraction: Foreground Requirement

When a study session is active, the app must remain in the **foreground**.

The pause is **server-owned**: a client that only stops its local heartbeat is not enough, because the server cannot tell "backgrounded" apart from "still studying, heartbeat in flight" and would credit the gap as foreground time.

- If the app moves to the **background**, the client calls `POST /v1/study-sessions/pause`. The server credits foreground minutes up to that instant, records `paused_at`, and starts the grace clock. The heartbeat timer stops.
- Pause is a **sub-state of `ACTIVE`**, not a status of its own — the one-active-session rule keeps applying to a paused session.
- A local notification fires: "Your study session is paused. Return to Frapp to resume." *(mobile only — see Surface Coverage below)*
- If the user returns within the **grace window** (`study_geofences.pause_grace_minutes`, chapter-configurable per zone, default 5 minutes), the client calls `POST /v1/study-sessions/resume` with coordinates and the timer resumes without losing accumulated minutes. Coordinates are re-checked on resume: the member may have left the zone while away, and the next heartbeat is up to five minutes out.
- If the user does **not** return within the grace window, the session auto-expires with status `PAUSED_EXPIRED`. Points are calculated only for the active (foreground) time accumulated before the pause, and the session's `end_time` is the pause instant, not the late return.
- Paused time **never accrues**, however the member returns. A heartbeat arriving on a paused session is treated as an implicit resume (grace checked first), so a client that never calls `/resume` still cannot bank background time.
- While a session is paused, `paused_at` governs — **not** the 10-minute stale-heartbeat rule. A chapter that configures a grace window longer than 10 minutes would otherwise have the stale rule silently win and report `EXPIRED` where this section calls for `PAUSED_EXPIRED`.
- Expiry is **lazy** — there is no sweeper. Every entry point (`start`, `heartbeat`, `pause`, `resume`, `stop`, and listing sessions) resolves a lapsed pause before doing anything else. `start` doing so is what keeps an abandoned session from 409-ing a member out of ever starting another one.

### Surface Coverage

| Surface | Backgrounding signal |
| --- | --- |
| Web dashboard | Page Visibility (`visibilitychange`) and the manual pause button both call `/pause`; returning calls `/resume`. Closing the tab stops the session outright. |
| Mobile | `AppState` drives it: leaving the foreground calls `/pause`, returning calls `/resume` with fresh coordinates. The mirror tracks the last state *reported to the server* and rolls back on a failed call, so a dropped `/pause` is retried rather than leaving the client believing the server knows. Backgrounding never calls `/stop` — that is the web tab-close behaviour and it would make the grace window pointless. Built in C5 of #937 (`apps/mobile/app/(tabs)/study.tsx`). The local pause notification above ships (C7 of #937, #1065, `apps/mobile/lib/notifications/study-pause.ts`): posted only **after** `/pause` returns — an optimistic notice would tell a member their session paused while the request was about to fail and be retried — and cleared both on resume and when the session ends, so a closed session never leaves a "return to Frapp to resume" notice inviting the member back to nothing. It is a *local* notification, so it needs no push token, no EAS build and no APNs/FCM credential; it still needs the native module, so it does nothing in Expo Go, where the in-app card states the paused state instead. |

## Study Mode Screen

While a study session is active, the app displays a dedicated study mode screen.

**This list is intent; the locked Canvas artboard is the visual truth** (s10 in
[`../ui/design-system/reference/canvas-screens.dc.html`](../ui/design-system/reference/canvas-screens.dc.html),
and [`../ui/README.md`](../ui/README.md) for the precedence rule). Where the two
disagreed, what shipped is recorded here so the next reader is not working from
a screen that does not exist:

- Large timer showing study time. **Shipped as credited time**, re-derived from
  the session's `last_heartbeat_at` watermark — not elapsed wall time, which
  would include paused gaps the member is not paid for.
- Current geofence name and location status (inside/outside). Shipped, paired
  with a status label rather than colour alone.
- A button to end the session. Shipped as the drawn **"End session"**, behind a
  native destructive confirm ([`../ui/mobile/README.md`](../ui/mobile/README.md)).
- Progress toward the next point award, and a motivational streak indicator.
  **Not shipped** — Canvas draws neither, and the reference wins on visuals.
  Both are derivable from data the client already holds if they are wanted.
- Minimal UI. **Not shipped as specified**: Canvas draws the week summary and a
  recent-session list below the timer card, and that is what the screen renders.

## Points Award

- Points are awarded when the session reaches COMPLETED status (user manually stops via the study mode screen) or `PAUSED_EXPIRED` (grace window lapsed). `EXPIRED` and `LOCATION_INVALID` award nothing.
- Minimum session length must be met (chapter-configurable, default 15 minutes). Sessions shorter than the minimum award zero points.
- Points = `floor(total_foreground_minutes / minutes_per_point) * points_per_interval`. Both `minutes_per_point` and `points_per_interval` are chapter-configurable.
- `total_foreground_minutes` counts whole minutes only, but the remainder is **not** discarded: `last_heartbeat_at` advances by exactly the minutes credited, so sub-minute leftovers carry into the next interval instead of being truncated away on every heartbeat.
- The `points_awarded` flag on the session prevents double-awarding.
- Point transactions for study sessions include the session ID and geofence ID in the metadata for audit.

## Edge Cases

- If the app is force-killed or the device loses power, the heartbeat stops and the session expires after the stale-heartbeat timeout (10 minutes). The user is notified and can start a new session.
- If the user's GPS is spoofed or unreliable (accuracy > 100m), the heartbeat is rejected and the session is flagged. After 2 consecutive rejected heartbeats, the session is expired with status `LOCATION_INVALID`.
- A user can only have one active study session at a time. Starting a new session while one is active returns 409 Conflict.
- Alumni-role members cannot record study hours: start and heartbeat return 403 Forbidden, so no minutes accrue and no STUDY points are awarded. Stopping is still permitted — nothing else transitions a session out of ACTIVE, so denying it would strand a session forever for someone granted the Alumni role mid-session. Their stop completes the session with zero points. See [alumni.md](alumni.md).
