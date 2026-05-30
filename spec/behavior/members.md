# Members

The `members` module is always-on (free tier). Every chapter has a searchable member directory built around it.

## Directory

- The directory is searchable across **name, email, and custom-field values**. Custom-field search is **visibility-scoped** — a viewer can only match on field values they are permitted to see.
- Filters: role, class/line/cohort (rendered via the chapter vocabulary term), and status.
- Search also supports name, role, and join date.

## Profiles

- Each member has a profile card showing: display name, profile photo, role(s), point balance, join date, and optional bio.
- Core profile fields shown on the detail view: name, email, role, joined date.
- Profile photos are stored in Supabase Storage under `chapters/{chapter_id}/profiles/{user_id}`.
- Authenticated members may edit **their own** display name, bio, and profile photo — no additional permission required.
- Viewing other members' full profiles requires the `members:view` permission.

## Custom Fields

- Custom fields (defined in the settings Fields tab) render per chapter on the member detail view, each respecting its configured visibility (`self` / `chapter` / `exec` / `president`).
- **Visibility is enforced server-side.** The query that returns custom-field values applies the visibility check; a sensitive field is never returned to a viewer who lacks access. Client-side filtering alone is never trusted for `sensitive` fields.

## Custom Role Assignment

- A member's custom roles (defined in the settings Roles tab) can be assigned from the directory. An assigned custom role appears on the member's detail view.

## Invite Flow

- Invites can be sent as a **single email** or a **bulk CSV upload**.
- Inviting members is free-tier and not billing-gated — see the invite token rules in [`onboarding.md`](onboarding.md).
- **On send:** write a member-visible row to `chapter_audit_log`, which posts an audit message to `#chapter-audit`.

## Chat Integration

Chat integration (the members module's chat surface and the DM-on-accept message): see [`integrations.md`](integrations.md).
