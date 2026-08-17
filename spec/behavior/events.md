# Events & Attendance

## Event Creation

- Admins with `events:create` permission create events with: name, description, location (free text), start time, end time, point value (configurable, default 10), mandatory flag, and recurrence rule (optional).
- **Recurring events:** Admins can set a recurrence rule (weekly, biweekly, monthly). The system generates individual event instances according to the rule. Each instance can be individually edited or canceled. Recurrence rules can be modified (changes apply to future instances only).
- **Role-based required attendance:** Events can specify which roles are required to attend via a `required_role_ids` field (text array, nullable). If set, only members with those roles are counted for attendance purposes. If null, the event is either mandatory for all members (`is_mandatory = true`) or optional. This enables targeted meetings (e.g. an exec meeting requires only officers; a scholarship committee meeting requires only members with a scholarship-related role).
- **`required_role_ids` wire semantics:** omitting the field on create stores `null` (untargeted). On update, omitting the field leaves targeting unchanged; sending an empty array clears it. A stored `[]` is equivalent to `null` everywhere targeting is evaluated — check-in eligibility and the auto-absent sweep both treat a zero-length array as "all members". The values are **RBAC role ids** — rows of the live `roles` table, the same ids carried in `member.role_ids` and served by `GET /v1/roles` — not `chapter_custom_roles` keys (see [`rbac.md`](rbac.md)). The event editor's required-roles multi-select and the event detail's role-name resolution both read that endpoint; an untargeted event's detail view shows "All members".
- **Meeting minutes:** Events have an optional `notes` field (rich text / markdown). Editable by admins with `events:update` permission after the event. Visible to all members who have access to the event (based on required roles or chapter-wide for non-role-targeted events).

## Check-In

- Members check in via the mobile app (self-service).
- **Rotating check-in code (optional assurance).** An officer with `events:update` mints a rotating code from `POST /v1/events/:eventId/attendance/check-in-token` and displays it (mobile s22); a member scans it (s18) and the token rides on the check-in request. The code is HMAC-signed over the event id and a 30-second window, and the server accepts the **current and the immediately previous** window so a scan racing a rotation still lands. A short manual code (`4KQ-88`) is minted from the same secret for members whose camera fails. Signing key: `EVENT_CHECK_IN_TOKEN_SECRET` — where it is unset the mint route returns 503 and a supplied token is rejected, while plain self check-in is unaffected.
  - **"Single-use" means once per member, not once per code.** One host code is scanned by everyone in the room inside the same window; a globally single-use token would admit exactly one member. The one-per-member guarantee is the unique `(event_id, user_id)` index enforced inside `check_in_event`, not a redemption ledger over tokens.
  - **A token is verified when supplied, never required.** The chat event card checks in with no token at all and continues to work. The rotating code raises the effort of sharing a code around; it is not an access control. The geofence below is.
- **Check-in geofence (the anti-proxy control).** An event may carry `check_in_zone` — a polygon of `{lat,lng}` vertices — plus a display name in `check_in_zone_name`. When set, check-in **requires** the member's coordinates on every surface and rejects a position outside the polygon (403); a request that omits coordinates is a 400, and a malformed polygon fails closed rather than being treated as "no zone". When `check_in_zone` is null the event has no geofence and no location is requested. Any displayed code can be screenshotted and forwarded, so presence — not the code — is what the server actually verifies (`spec/ui/mobile/patterns.md` § QR check-in). A surface that cannot supply a location, such as the web chat event card, is told to use the mobile app rather than shown a control that fails.
  - Zones are set through `POST /v1/events` / `PATCH /v1/events/:id` (`events:create` / `events:update`). Sending an empty array **clears** the zone, matching the `required_role_ids` wire semantics above; fewer than three points is a 400.
- Check-in atomically creates an attendance record AND awards the event's point value (same database transaction), via the `check_in_event` RPC.
- Check-in is only available during the event's time window (between start_time and end_time, with a configurable grace period after end_time, default 15 minutes).
- Unique constraint: one attendance record per (event, user) — enforced inside `check_in_event` via `on conflict do nothing`, so a concurrent double check-in inserts nothing and returns 409 Conflict without a double award. See [points.md](points.md) for the atomicity invariant.
- For role-targeted events, only members with matching roles can check in. Members without the required role who attempt to check in receive a 403 Forbidden.
- Alumni-role members cannot check in and receive a 403 Forbidden, checked before the attendance + points write — **unless** the event names roles in `required_role_ids` and the alumnus matches, which is an explicit decision to include them (e.g. an alumni homecoming). See [alumni.md](alumni.md).

## Attendance Management

- Admins with `events:update` permission can view full attendance for any event.
- **Excuse workflow (admin-only):** Admins mark members as EXCUSED with an optional reason string. Members cannot self-submit excuses. Excused members are not penalized for mandatory events and do not appear as ABSENT in reports.
- Admins can also manually mark members as ABSENT or LATE after the event.
- Marking a member ABSENT who previously checked in (PRESENT) does NOT reverse the points already awarded. The admin must separately create a point adjustment if needed.
- **Auto-absent:** For mandatory or role-targeted events, members who are required to attend but did not check in and were not marked EXCUSED are auto-marked ABSENT after the grace period ends. Alumni-role members are excluded on non-targeted events — they can neither check in nor self-excuse, so marking them would guarantee an ABSENT record they have no way to avoid. A role-targeted event keeps whoever it names, alumni included. This runs automatically: an hourly scheduled sweep processes every event whose grace period closed in the preceding 24 hours, so no officer action is required. The admin-triggered endpoint remains available for immediate marking. Re-running is harmless — members who already hold an attendance record are skipped.

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
