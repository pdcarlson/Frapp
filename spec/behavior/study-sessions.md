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
| Mobile | **Not yet built** — there is no study screen in `apps/mobile`. The local pause notification above and OS foreground enforcement land with it. |

## Study Mode Screen

While a study session is active, the app displays a dedicated study mode screen:

- Large timer showing elapsed study time.
- Current geofence name and location status (inside/outside).
- Progress toward the next point award (e.g. "12 of 30 minutes toward next point").
- Motivational streak indicator (e.g. "3rd session this week").
- Minimal UI — no feeds, no chat, no distractions. Just the timer and status.
- A "Stop Studying" button to end the session.

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
