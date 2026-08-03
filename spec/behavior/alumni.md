# Alumni Features

## Alumni Role

Alumni is a system role seeded on chapter creation with limited default permissions: read access to chat (cannot post in most channels), view Backwork, view member directory. No points accumulation, no event check-in, no study hours.

### Enforcement

Alumni status is a **lifecycle state, not a permission level** — holding the Alumni role is what restricts, so a member who still needs to act operationally should not carry it. The seeded Alumni permission set (`members:view`) is deliberately not the mechanism: it satisfies the same permission gate active members pass, so the restrictions are enforced in the domain services rather than by the permission guard.

Enforced restrictions:

- **Study hours** — starting, heartbeating, or stopping a study session returns `403 Forbidden`. Alumni therefore never reach the STUDY point award.
- **Event check-in** — checking in to an event returns `403 Forbidden`, before the atomic attendance + ATTENDANCE points write.
- **Chat posting** — alumni may post only in the `#alumni` channel (any ROLE_GATED channel they can read) and in direct conversations (DM / GROUP_DM). Posting in ordinary operational channels (PUBLIC / PRIVATE) is denied. Read access is unchanged everywhere they can already see, and the read-only gate (`#announcements`, `#chapter-audit`) still applies on top.

A member holding `*` (President) bypasses the posting restriction, so a chapter cannot lock itself out by assigning the Alumni role to its own President.

If a chapter has no Alumni role (e.g. it was renamed or deleted), these checks fail open to the caller's normal permissions rather than denying everyone.

> **Known limitation:** the Alumni role is resolved by name. System roles can currently be renamed, which would silently disable these restrictions. Giving system roles a stable, rename-proof key is tracked as follow-up work.

## Alumni Directory

- A separate, searchable directory of alumni members.
- In addition to the standard profile fields (name, role, join date), alumni can self-report: graduation year, current city, and current company/organization.
- The alumni directory is visible to all chapter members (active and alumni).
- Search/filter by graduation year, city, or company.

## Alumni Chat Channel

- A default `#alumni` channel is seeded on chapter creation alongside `#general` and `#announcements`.
- `#alumni` is ROLE_GATED: visible to members with the Alumni role AND active members. This allows current brothers and alumni to communicate.

## Donation Link

- Chapter settings include an optional `donation_url` field.
- If set, a "Support the Chapter" button/link appears in the mobile app for alumni members.
- Frapp does not process donations. The link opens an external URL (e.g. a university giving page or a Venmo link).
