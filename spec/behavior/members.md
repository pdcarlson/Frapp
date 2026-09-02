# Members

The `members` module is always-on (free tier). Every chapter has a searchable member directory built around it.

## Directory

- The directory is searchable across **name, email, and custom-field values**. Custom-field search is **visibility-scoped** — a viewer can only match on field values they are permitted to see.
- Filters: role, class/line/cohort (rendered via the chapter vocabulary term), and status.
- Search also supports name, role, and join date.
- The directory paginates at **25 rows per page** in both the table and card layouts; the pager renders only when the filtered set exceeds one page.

## Profiles

- Each member has a profile card showing: display name, profile photo, role(s), point balance, join date, and optional bio.
- Core profile fields shown on the detail view: name, email, role, joined date.
- Profile photos are stored in Supabase Storage under `chapters/{chapter_id}/profiles/{user_id}`.
- Authenticated members may edit **their own** display name, bio, and profile photo — no additional permission required.
- Viewing other members' full profiles requires the `members:view` permission.

## Custom Fields

- Custom fields (defined in the settings Fields tab) render per chapter on the member detail view, each respecting its configured visibility (`self` / `chapter` / `exec` / `president`).
- Field **definitions** live in `chapter_custom_fields`; a member's **values** live in `member_custom_field_values` (one row per member+field), so the visibility check is applied as a query predicate against the definition rather than a post-fetch scrub.
- **Visibility is enforced server-side.** `GET /members/:id` resolves the viewer's allowed visibility tiers and only fields in that set are queried, so a sensitive field is never returned to a viewer who lacks access. Client-side filtering alone is never trusted for `sensitive` fields. The allowed-tier rule is defined in [`rbac.md`](rbac.md#custom-field-visibility-tiers):
  - `chapter` → any viewer who can see the directory (`members:view`).
  - `self` → only the member themselves (the owner). Not overridden by the president — private fields stay private.
  - `exec` → viewers with member/role management authority (`roles:manage` or `members:remove`) or the wildcard.
  - `president` → only the wildcard (`*`) holder.
- The read-only `GET /custom-fields` endpoint lists a chapter's full field-definition set for the **settings Fields tab** (gated by `chapter-config:view`, matching the custom-roles read); definition write CRUD also belongs to that tab. The member directory does not call it — it renders each member's values from the tier-filtered `GET /members/:id`, so the existence of higher-tier/sensitive fields is never exposed to baseline members.

## Custom Role Assignment

- A member's custom roles (defined in the settings Roles tab) can be assigned from the directory. An assigned custom role appears on the member's detail view.

## Invite Flow

- Invites can be shared as a **join link** (a single generated token, or a batch of tokens), or sent to a **list of email addresses** (comma/newline-separated, up to 50 at a time — `POST /v1/invites/email` mints one token per address and emails each a join link; a per-address delivery failure does not fail the whole batch, and its token is still valid to share manually). A **bulk CSV upload** path is specced but not yet built — see #580.
- Invite gating follows the subscription rules in [`onboarding.md`](onboarding.md) § Invite Token Rules: minting is free-tier for an `incomplete` chapter, but blocked for `past_due` (even in grace) and `canceled`; redeeming an already-minted token is never gated.
- **On send:** write a member-visible row to `chapter_audit_log`, which posts an audit message to `#chapter-audit`.

## Chat Integration

Chat integration (the members module's chat surface and the DM-on-accept message): see [`integrations.md`](integrations.md).
