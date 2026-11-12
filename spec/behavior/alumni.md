# Alumni Features

## Alumni Role

Alumni is a system role seeded on chapter creation with limited default permissions: read access to chat (cannot post in most channels) and view member directory — the seeded set is stated exactly below. No study hours and no event check-in, the two paths where a member earns points without an officer signing off. An officer can still adjust an alumnus's points ([`points.md` § Admin Adjustments](points.md#admin-adjustments)).

### Enforcement

Alumni status is a **lifecycle state, not a permission level** — holding the Alumni role is what restricts, so a member who still needs to act operationally should not carry it. The seeded Alumni permission set (`members:view`, `alumni:post`) is deliberately not the mechanism: `members:view` satisfies the same permission gate active members pass, so the restrictions are enforced in the domain services rather than by the permission guard. `alumni:post` is a channel marker rather than a capability — the posting gate reads it off the *channel's* `required_permissions`, not off the caller's.

Enforced restrictions:

- **Study hours** — starting a session or sending a heartbeat returns `403 Forbidden`, so no minutes accrue and the STUDY award is never reached. **Stopping is deliberately allowed**: nothing else moves a session out of ACTIVE (expiry is computed lazily inside heartbeat/stop, there is no sweeper), so denying the stop would strand a session forever for anyone granted the Alumni role mid-session — and block them from ever starting another. An alumnus closing a session completes it with **no points awarded**.
- **Event check-in** — checking in returns `403 Forbidden`, before the atomic attendance + ATTENDANCE points write. **Exception:** an event that lists a role of theirs as required or optional ([attendance by role](events.md#event-creation)) is an explicit chapter decision about who attends, so an alumni-facing event (e.g. homecoming) that lists the Alumni role stays reachable — the role check governs, not the lifecycle rule. For the same reason alumni are **excluded from auto-absent marking** when only the event's default, not a role of theirs, makes them required: they can neither check in nor self-excuse, so including them would hand every alumnus a guaranteed ABSENT record on every mandatory event.
- **Chat posting** — alumni may post only in channels whose posting list names the Alumni role or its tier (`#alumni` in a default chapter; [who can see and post](chat/README.md#who-can-see-and-post)) and in direct conversations (DM / GROUP_DM). Posting anywhere else is denied, including a channel where everyone may post. This covers **editing** as well as sending: an edit writes new member-authored content, so it clears the same gate — otherwise the rule would be bypassable by rewriting an older message. It also covers **requesting a file-upload URL**, which is the first step of a send rather than a read (#2186). Both steps enforce the rule, so an alumnus attaching a file in an operational channel is refused at the attach — already, rather than only later at the send. Read access is unchanged everywhere they can already see, and the read-only gate (`#announcements`, `#chapter-audit`) still applies on top. `GET /v1/channels` and `GET /v1/channels/:id` carry a per-channel `can_post` capability derived from this same gate (`ChannelAccessService.withPostCapability`), so web, mobile, and poll creation can disable the composer proactively instead of the member discovering the restriction from a failed send.

**Restricted to authored content only.** Reactions, poll votes, and other message actions are *participation* in something the member can already read, not posting, and stay open to alumni. Creating a poll authors a message and is therefore restricted.

A member holding `*` (President) bypasses the posting restriction, so a chapter cannot lock itself out by assigning the Alumni role to its own President.

If a chapter has no Alumni role, these checks fail open to the caller's normal permissions rather than denying everyone.

> **Which channels are alumni-writable:** exactly those whose who-can-post list names the Alumni role or the tier it sits in, or, when anyone who can see may post, whose who-can-see list does (`isAlumniPostableChannel`). The rule deliberately does *not* key on "everyone may post" — that would make every open channel alumni-postable — nor on a permission alumni merely *hold*. Naming the Alumni role on a channel is the officer's explicit "alumni talk here", which is why `#alumni` is seeded with it.
>
> *Until #3722 (2026-11-11) the marker was the `alumni:post` string in a ROLE_GATED channel's `required_permissions`. Migration `20261111233000` turned it into the lists: a channel that required `alumni:post` names the Alumni role; one the Alumni role could see without it posts for its readers minus the Alumni role, so no alumnus gained a channel. The `alumni:post` permission itself is no longer read and its removal from the registry is [#4286](https://github.com/pdcarlson/Frapp/issues/4286).*

> **Role identity:** the Alumni role is resolved by its stable `roles.system_key` (`ALUMNI`), not by name, so renaming it does not affect these restrictions — see [`rbac.md`](rbac.md#role-lifecycle). One legacy exception: a chapter that renamed the role *before* `system_key` was introduced has no key on it and keeps the fail-open behavior above.

## Alumni Directory

- A separate, searchable directory of alumni members.
- **Actives and alumni don't overlap.** The directory's Actives list and count are the chapter minus its alumni, and its Alumni list is `GET /v1/alumni`. A member is an alumnus when they hold the Alumni role, resolved by `system_key` as under Role identity above. Every member profile carries that answer as `is_alumni`, computed by the same lookup that builds `GET /v1/alumni`, so the two lists can't both count one member (#2484). A chapter whose Alumni role has no key has no alumni on either count. `GET /v1/members` itself still returns everyone: its other readers (attendance, tasks, points, roles) need the whole chapter. Name search is not split: on web and mobile it spans both lists, since it is the directory's only name, email and custom-field search.
- In addition to the standard profile fields (name, role, join date), alumni can self-report: graduation year, current city, and current company/organization.
- The alumni directory is visible to all chapter members (active and alumni).
- Search/filter by graduation year, city, or company.

## Alumni Chat Channel

- A default `#alumni` channel is seeded on chapter creation alongside the other default channels (full definitions: [`chat/README.md` § Channels](chat/README.md#channels)).
- `#alumni` is ROLE_GATED: visible to members with the Alumni role AND active members. This allows current brothers and alumni to communicate.

## Donation Link

- Chapter settings include an optional `donation_url` field.
- If set, a "Support the Chapter" button/link appears in the mobile app for alumni members.
- Frapp does not process donations. The link opens an external URL (e.g. a university giving page or a Venmo link).
