# Alumni Features

## Alumni Role

Alumni is a system role seeded on chapter creation with limited default permissions: read access to chat (cannot post in most channels), view Backwork, view member directory. No points accumulation, no event check-in, no study hours.

### Enforcement

Alumni status is a **lifecycle state, not a permission level** — holding the Alumni role is what restricts, so a member who still needs to act operationally should not carry it. The seeded Alumni permission set (`members:view`) is deliberately not the mechanism: it satisfies the same permission gate active members pass, so the restrictions are enforced in the domain services rather than by the permission guard.

Enforced restrictions:

- **Study hours** — starting a session or sending a heartbeat returns `403 Forbidden`, so no minutes accrue and the STUDY award is never reached. **Stopping is deliberately allowed**: nothing else moves a session out of ACTIVE (expiry is computed lazily inside heartbeat/stop, there is no sweeper), so denying the stop would strand a session forever for anyone granted the Alumni role mid-session — and block them from ever starting another. An alumnus closing a session completes it with **no points awarded**.
- **Event check-in** — checking in returns `403 Forbidden`, before the atomic attendance + ATTENDANCE points write. **Exception:** an event that names roles in `required_role_ids` is an explicit chapter decision about who attends, so an alumni-facing event (e.g. homecoming) that lists the Alumni role stays reachable — the role check governs, not the lifecycle rule. For the same reason alumni are **excluded from auto-absent marking** on non-targeted events: they can neither check in nor self-excuse, so including them would hand every alumnus a guaranteed ABSENT record on every mandatory event.
- **Chat posting** — alumni may post only in ROLE_GATED channels they can read (`#alumni` in a default chapter) and in direct conversations (DM / GROUP_DM). Posting in ordinary operational channels (PUBLIC / PRIVATE) is denied. This covers **editing** as well as sending: an edit writes new member-authored content, so it clears the same gate — otherwise the rule would be bypassable by rewriting an older message. Read access is unchanged everywhere they can already see, and the read-only gate (`#announcements`, `#chapter-audit`) still applies on top.

**Restricted to authored content only.** Reactions, poll votes, and other message actions are *participation* in something the member can already read, not posting, and stay open to alumni. Creating a poll authors a message and is therefore restricted.

A member holding `*` (President) bypasses the posting restriction, so a chapter cannot lock itself out by assigning the Alumni role to its own President.

If a chapter has no Alumni role, these checks fail open to the caller's normal permissions rather than denying everyone.

> **Scope caveat:** the posting rule keys on channel *type*, not on the `#alumni` channel's identity — so **any** ROLE_GATED channel is alumni-postable. Because `DEFAULT_CHANNELS` seeds channels without `required_permissions`, and an empty requirement means "any chapter member", a chapter that creates a ROLE_GATED `#exec` channel without setting `required_permissions` would let alumni post there. Tightening ROLE_GATED seeding is tracked as follow-up work.

> **Role identity:** the Alumni role is resolved by its stable `roles.system_key` (`ALUMNI`), not by name, so renaming it does not affect these restrictions — see [`rbac.md`](rbac.md#role-lifecycle). One legacy exception: a chapter that renamed the role *before* `system_key` was introduced has no key on it and keeps the fail-open behavior above.

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
