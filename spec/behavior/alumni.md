# Alumni Features

## Alumni Role

Alumni is a system role seeded on chapter creation with limited default permissions: read access to chat (cannot post in most channels), view Backwork, view member directory. No points accumulation, no event check-in, no study hours.

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
