# Members

The `members` module is always-on (free tier). Every chapter has a searchable member directory built around it.

## Directory

- The directory is searchable across **name, email, and custom-field values**. Custom-field search is **visibility-scoped** — a viewer can only match on field values they are permitted to see.
- Filters: role, class/line/cohort (rendered via the chapter vocabulary term), and status.
- Search also supports name, role, and join date.
- The directory paginates at **25 rows per page**; the pager renders only when the filtered set exceeds one page. (Web renders one flush list; the table and card layouts this line used to name were deleted by the greenfield Directory lane, [#2146](https://github.com/pdcarlson/Frapp/issues/2146).)

## Profiles

- Each member has a profile card showing: display name, profile photo, role(s), point balance, join date, and optional bio.
- Core profile fields shown on the detail view: name, email, role, joined date.
- Profile photos are stored in the private `profiles` bucket under `chapters/{chapter_id}/profiles/{user_id}/`, in the folder for the chapter the member uploaded from. The member's `users.avatar_url` holds that object's path.
- Authenticated members may edit **their own** display name, major, graduation year, bio, current city, current company and profile photo — no additional permission required. Web (`/profile`) and mobile (s15) both edit all of them: the photo through the three steps below, the rest through `PATCH /v1/users/me` (mobile's Edit sheet since #3387; corrected 2026-11-04, this listed only name, bio and photo, and the photo alone for mobile). The graduation year's bounds are `GRADUATION_YEAR_MIN` / `GRADUATION_YEAR_MAX` in `@repo/validation`, which the API's `UpdateUserDto` enforces; what mobile refuses before sending is s15's row in [`spec/ui/mobile/screens.md`](../ui/mobile/screens.md). The web form does not yet refuse a blank name, and sends it, so the column stores `''` (#3392). Major (`users.major`, added 2026-11-06) is free text up to `MAJOR_MAX_LENGTH` (100); both forms take their labels and placeholders from `PROFILE_FIELD_COPY` in `@repo/validation`, and show it on the member's own profile, the mobile member detail line and the alumni directory row. Both forms draw City and Company only from the member's graduation year on, or while either already holds a value so it can be cleared (`showsAfterGraduation` in `@repo/validation`, Paul, 2026-11-06: an undergrad has no after-graduation city or company); the API takes them from anyone.
- **Setting the photo is three steps** (#732): `POST /v1/users/me/avatar-url` mints a signed upload URL for a server-minted, unique key; the client PUTs the bytes; `POST /v1/users/me/avatar` confirms it. The confirm accepts only an existing object directly in the caller's own folder for the active chapter, then deletes the photo it replaced and any unconfirmed upload in that folder older than a day. A younger one is left alone, since it may be another device's upload about to be confirmed. `DELETE /v1/users/me/avatar` clears it. `PATCH /v1/users/me` does not accept `avatar_url` (#2519): a free-text value let a member point their photo at any path.
- **Every read serves the photo as a signed URL** (one hour), because the bucket is private and a bare path renders nothing. That covers `GET /v1/users/me`, the member list, detail, search, the alumni directory, `GET /v1/members/roster` (which chat reads), and the actors on `GET /v1/activity-feed` (built server-side from the same roster read, `MemberService.findRosterWithJoinDates`). Only a path in the row owner's own folder is signed. Anything else serves as `null`, so the client draws initials; that includes a URL, which only the old free-text `PATCH` could have stored: sign-in syncs only the email and name, and no migration or seed sets the column.
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

- Invites can be shared as a **join link** (one token per link; `POST /v1/invites/batch` still mints several at once, though no client calls it since 2026-11-06), or sent to a **list of email addresses** (up to 50 at a time — `POST /v1/invites/email` mints one token per address, stores the address on the invite (`invites.email`), and emails each a join link that names the chapter and who sent it; a per-address delivery failure does not fail the whole batch, and its token is still valid to share manually). A **bulk CSV upload** path is specced but not yet built — see #580.
- **The web Invite members panel never shows a token (2026-11-06, Paul).** Its top is the composer, shared with the web setup wizard's invite step (`apps/web/components/members/invite-composer.tsx`): an email field that turns each typed or pasted address into a chip (Enter, Tab, comma, semicolon, space, leaving the field, or a paste of a list), a `Joins as <role>` picker, and `Send invite` / `Send N invites`. An address that isn't one turns red when it becomes a chip, never per keystroke, and blocks Send; an address the server couldn't email stays in the field, marked, so Send tries it again. Below it, `Copy link` mints one fresh single-use link and copies only the join URL. Nothing is minted before a press. Under that, `Invited` lists every pending invite and the joined or expired ones from the last 14 days, newest first, by address (or `Invite link` for a link), with the role, when it was sent, and its status. Revoked invites are not listed. A row's menu (its ⋯ button or a right-click) offers `Copy link` and `Revoke invite` on a pending invite and `Send again` on an emailed one that is pending (it revokes the old invite first) or expired.
- **Status (#3607).** `GET /v1/invites` returns typed rows with a `status`: `revoked` when `revoked_at` is set, else `joined` when `used_at` is set, else `expired` past `expires_at`, else `pending`. A revoke sets `revoked_at` and `used_at` together, only while `used_at` is still null, so every path that refuses a used token refuses a revoked one, and a revoke that loses a race with a redeem is refused as already used rather than relabelling a join.
- Invite gating follows the subscription rules in [`onboarding.md`](onboarding.md) § Invite Token Rules: minting is free-tier for an `incomplete` chapter, but blocked for `past_due` (even in grace) and `canceled`; redeeming an already-minted token is refused (403, token kept) once the chapter is under the hard lock — `canceled`, or `past_due` past grace — and admitted otherwise (#1546).
- **Default invite role.** A chapter can nominate the role new invites use when the sender does not pick one, set in Settings → Roles and persisted as `chapters.default_invite_role_id`. Naming a role on the invite still wins, so the default is a starting point rather than a restriction. Resolution order is explicit role → chapter default → the seeded Member role; a chapter that has set no default behaves exactly as it did before the field existed. See [`rbac.md`](rbac.md) § Default Invite Role for the validation and deletion rules.
- **On send:** write a member-visible row to `chapter_audit_log`, which posts an audit message to `#chapter-audit`.

## Chat Integration

Chat integration (the members module's chat surface and the DM-on-accept message): see [`integrations.md`](integrations.md).
