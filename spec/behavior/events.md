# Events & Attendance

## Event Creation

- Admins with `events:create` permission create events with: name, description, location (free text), start time, end time, point value (configurable, default 10), mandatory flag, and recurrence rule (optional).
- **Recurring events:** Admins can set a recurrence rule (weekly, biweekly, monthly). The system generates individual event instances according to the rule. Each instance can be individually edited or canceled. Recurrence rules can be modified (changes apply to future instances only).
- **Role-based required attendance:** Events can specify which roles are required to attend via a `required_role_ids` field (text array, nullable). If set, only members with those roles are counted for attendance purposes. If null, the event is either mandatory for all members (`is_mandatory = true`) or optional. This enables targeted meetings (e.g. an exec meeting requires only officers; a scholarship committee meeting requires only members with a scholarship-related role).
- **Meeting minutes:** Events have an optional `notes` field (rich text / markdown). Editable by admins with `events:update` permission after the event. Visible to all members who have access to the event (based on required roles or chapter-wide for non-role-targeted events).

## Check-In

- Members check in via the mobile app (self-service).
- Check-in atomically creates an attendance record AND awards the event's point value (same database transaction).
- Check-in is only available during the event's time window (between start_time and end_time, with a configurable grace period after end_time, default 15 minutes).
- Unique constraint: one attendance record per (event, user). Double check-in returns 409 Conflict.
- For role-targeted events, only members with matching roles can check in. Members without the required role who attempt to check in receive a 403 Forbidden.

## Attendance Management

- Admins with `events:update` permission can view full attendance for any event.
- **Excuse workflow (admin-only):** Admins mark members as EXCUSED with an optional reason string. Members cannot self-submit excuses. Excused members are not penalized for mandatory events and do not appear as ABSENT in reports.
- Admins can also manually mark members as ABSENT or LATE after the event.
- Marking a member ABSENT who previously checked in (PRESENT) does NOT reverse the points already awarded. The admin must separately create a point adjustment if needed.
- **Auto-absent:** For mandatory or role-targeted events, members who are required to attend but did not check in and were not marked EXCUSED are auto-marked ABSENT after the grace period ends.

## Edge Cases

- If a role referenced in `required_role_ids` is deleted, that role is effectively ignored for attendance purposes (members who previously held it are no longer required).
- If an event's point value is changed after some members have already checked in, only future check-ins use the new value. Already-awarded points are not retroactively adjusted.

## Calendar Integration

- Events display an "Add to Calendar" action.
- Tapping it generates an `.ics` file (or deep-links to the device's calendar app on mobile) with event name, description, location, start/end time, and a link back to the event in Frapp.
- Recurring events generate recurring calendar entries.

## Chat Integration

The `/event "<name>" <YYYY-MM-DD> <HH:MM>-<HH:MM> [location] [points]` slash command creates an event
(`events:create`, re-checked on `POST /v1/events`) and posts a server-originated **event card** to the
current channel — an immutable snapshot (name, when, location, point value). Every member sees a
**Check-in** action during the event window (start → end + grace), so the chat card is an *additional*
self-service check-in surface alongside the mobile app; the server enforces the window, the role gate, and
one-check-in-per-member regardless of surface. Viewers who can read attendance (`events:update`) also see a
live checked-in count read back through the attendance query (members can self-check-in but can't read the
roster, so the count is shown only to them). Recurrence, role-targeting, and the mandatory flag stay on the dashboard.

Pre-event **RSVP intent** (going / maybe / not-going, ahead of the window) is not yet modelled — tracked as
a follow-up. The shared slash-command catalog, dispatch path, renderer registry, and the
server-originated-kind (anti-forgery) rules are canonical in [`integrations.md`](integrations.md) and the
chat-specific [`chat/integrations.md`](chat/integrations.md).
