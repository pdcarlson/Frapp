# Study Sessions — Foreground Enforcement

## Heartbeat Validation

- The client sends GPS coordinates every 5 minutes while the app is in the foreground.
- The server runs a point-in-polygon check against the selected geofence's coordinates.
- If the heartbeat shows the user is outside the polygon, the session status is set to EXPIRED and a notification is sent.
- If no heartbeat is received within 10 minutes, the session is marked EXPIRED (stale heartbeat).

## Anti-Distraction: Foreground Requirement

When a study session is active, the mobile app must remain in the **foreground**.

- If the app moves to the **background**, the session timer **pauses immediately**. The heartbeat timer stops.
- A local notification fires: "Your study session is paused. Return to Frapp to resume."
- If the user returns within a **grace window** (chapter-configurable, default 5 minutes), the timer resumes seamlessly and the next heartbeat is sent.
- If the user does **not** return within the grace window, the session auto-expires with status `PAUSED_EXPIRED`. Points are calculated only for the active (foreground) time accumulated before the pause.
- The API only receives heartbeats while the app is in the foreground. No heartbeat = paused or expired.

## Study Mode Screen

While a study session is active, the app displays a dedicated study mode screen:

- Large timer showing elapsed study time.
- Current geofence name and location status (inside/outside).
- Progress toward the next point award (e.g. "12 of 30 minutes toward next point").
- Motivational streak indicator (e.g. "3rd session this week").
- Minimal UI — no feeds, no chat, no distractions. Just the timer and status.
- A "Stop Studying" button to end the session.

## Points Award

- Points are awarded when the session reaches COMPLETED status (user manually stops via the study mode screen).
- Minimum session length must be met (chapter-configurable, default 15 minutes). Sessions shorter than the minimum award zero points.
- Points = `floor(total_foreground_minutes / minutes_per_point) * points_per_interval`. Both `minutes_per_point` and `points_per_interval` are chapter-configurable.
- The `points_awarded` flag on the session prevents double-awarding.
- Point transactions for study sessions include the session ID and geofence ID in the metadata for audit.

## Edge Cases

- If the app is force-killed or the device loses power, the heartbeat stops and the session expires after the stale-heartbeat timeout (10 minutes). The user is notified and can start a new session.
- If the user's GPS is spoofed or unreliable (accuracy > 100m), the heartbeat is rejected and the session is flagged. After 2 consecutive rejected heartbeats, the session is expired with status `LOCATION_INVALID`.
- A user can only have one active study session at a time. Starting a new session while one is active returns 409 Conflict.
- Alumni-role members cannot record study hours: start and heartbeat return 403 Forbidden, so no minutes accrue and no STUDY points are awarded. Stopping is still permitted — nothing else transitions a session out of ACTIVE, so denying it would strand a session forever for someone granted the Alumni role mid-session. Their stop completes the session with zero points. See [alumni.md](alumni.md).
