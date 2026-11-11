# RBAC — Open-Ended Permissions

## Permission Model

Permissions are **arbitrary strings**. Any string is valid as a permission.

Frapp publishes a **system permissions catalog** — these are the strings the API enforces on endpoints:

| Permission            | Grants                                                 |
| --------------------- | ------------------------------------------------------ |
| `*`                   | Wildcard — all actions                                 |
| `events:create`       | Create events                                          |
| `events:update`       | Edit events                                            |
| `events:delete`       | Delete events                                          |
| `members:invite`      | Invite members by email or link, and revoke invites    |
| `members:remove`      | Remove members from the chapter                        |
| `members:view`        | View the full member directory                         |
| `points:adjust`       | Manually add/remove points                             |
| `points:view_all`     | View all members' transactions (not just own)          |
| `roles:manage`        | Create, edit, delete roles; assign roles to members; edit the chapter's pledge classes and any member's class and order number ([`members.md`](members.md#pledge-class-and-order-number)) |
| `channels:create`     | Create chat channels                                   |
| `channels:manage`     | Edit/delete channels, pin messages, manage permissions |
| `announcements:post`  | Post in the #announcements channel                     |
| `alumni:post`         | Channel marker: names a ROLE_GATED channel alumni may write in (read off the channel's `required_permissions`, not the caller's) |
| `billing:view`        | View subscription and invoice status                   |
| `billing:manage`      | Manage subscription, create member invoices            |
| `backwork:upload`     | Upload resources to Backwork                           |
| `backwork:admin`      | Manage courses, professors, delete resources           |
| `geofences:manage`    | Create/edit/delete study geofences                     |
| `polls:create`        | Create polls in channels                               |
| `polls:view_all`      | List polls chapter-wide with aggregate vote tallies    |
| `tasks:manage`        | Create, assign, and confirm tasks                      |
| `rush:view`           | Look up a recruitment prospect and see their bid status ([`rush.md`](rush.md#permissions) owns the recruitment rows and their default grant) |
| `rush:add`            | Add a prospect                                         |
| `rush:notes`          | Write notes on a prospect (gates nothing until notes are built) |
| `rush:vote`           | Vote on a prospect                                     |
| `rush:view_results`   | See a prospect's vote count (gates nothing yet, [#4084](https://github.com/pdcarlson/Frapp/issues/4084)) |
| `rush:bid`            | Record a bid                                           |
| `rush:manage`         | Delete prospects and export the list (gates nothing until those are built) |
| `chapter_docs:upload` | Upload documents to Chapter Files                      |
| `chapter_docs:manage` | Delete/organize documents in Chapter Files             |
| `service:log`         | Log service hours (typically all members)              |
| `service:approve`     | Approve or reject service hour entries                 |
| `semester:rollover`   | Trigger a new semester rollover                        |
| `reports:export`      | Export attendance, points, and roster reports          |
| `chapter-config:view` | Read chapter config and custom fields; with `members:view`, the audit log |
| `chapter-config:manage` | With `chapter-config:view`, which every one of these routes also requires: change chapter config (including the theme-palette recompute), write custom fields, and edit the chapter profile, accent and logo (`PATCH /v1/chapters/current` and the logo routes, #2575). The profile routes need `view` too because the Settings tabs they are edited from need it to show ([`settings/README.md`](settings/README.md#who-sees-what) § Who sees what), so `manage` alone would reach a save the page never shows. The API and the Settings page read that pair from `CHAPTER_PROFILE_PERMISSIONS` in `@repo/validation` |

What each permission is called on screen, its one-line description, the module it is grouped under and its scope live in `PERMISSION_REGISTRY` ([`permission-registry.ts`](../../packages/validation/src/permission-registry.ts), #4069). `GET /v1/roles/permissions-catalog` serves that list, and web and mobile read the same one. Every permission's scope is `chapter` today.

Chapters can define **custom permission strings** beyond this catalog. Custom permissions are used for:

- Channel gating (a channel can require any permission string, including custom ones).
- UI visibility hints (show/hide a tab or action based on permissions).
- Future extensibility (new API features can adopt existing custom strings without schema changes).

The system does NOT reject unknown permission strings. It stores and evaluates them for gating purposes the same way it handles system permissions.

## Permission Check Algorithm

1. Fetch the user's `role_ids` for the active chapter from `members`.
2. Fetch the `permissions` arrays for those roles from `roles`, **filtered to the active chapter**. An id carried on the membership that belongs to another chapter (stale, or written before an earlier validation gap was closed) matches no row and contributes no permissions. A request with no resolved active chapter is denied outright rather than resolved chapter-wide.
3. Flatten to a unique set of permissions. `roles` is the only source: the second role system, `chapter_custom_roles`, was folded into it ([below](#custom-roles-folded-into-roles)).
4. If the set contains `*`, access is granted.
5. Otherwise, check that **all** required permissions for the endpoint are present in the set.

Permissions are never cached across requests. Each request freshly resolves the user's permission set, ensuring that role changes take effect immediately.

The same resolution backs `GET /v1/users/me/permissions` (the effective-permission set clients use to render permission-aware UI), so the chapter filter applies there too.

### Lifecycle rules are separate from permissions

A permission answers "may this member do X?"; a **lifecycle rule** answers "is this member still an active participant?". The two are enforced independently, and passing the permission check above does not imply a lifecycle rule allows the action.

The only lifecycle rule today is the **Alumni** role (see [`alumni.md`](alumni.md)), which blocks study-hour accrual, event check-in, and posting outside `#alumni` / DMs. It is deliberately not modelled as a permission: the seeded Alumni permission set is `members:view` (exactly what active members hold) plus `alumni:post`, which is a *channel* marker rather than a capability — the posting gate tests it against the channel's `required_permissions`, not the caller's — so widening or narrowing the caller's permissions could not express the rule — and the study controller's `members:view` requirement is satisfied by alumni, which is why the rule is enforced in the domain services rather than in `PermissionsGuard`. Holding the role is what restricts, so a member who still needs to act operationally should not carry it.

## Role Lifecycle

- On chapter creation, the **starting tiers** and the **default system roles** are seeded: President (`*`), Treasurer, Vice President, Secretary, Member, New Member, Alumni, each in its starting tier ([Tiers and overrides](#tiers-and-overrides)).
- **Seeded permissions** (`STARTING_ROLE_TIERS` and `DEFAULT_SYSTEM_ROLES` in `apps/api/src/domain/constants/permissions.ts` own the lists; this is what they give a chapter created today, and each role can do what it could before tiers existed):
  - **Exec board** (tier 1) gives its roles `members:view` and `polls:view_all` (baseline chapter API access plus `GET /v1/polls`, the chapter-wide poll list, whose web page was retired in #3871; the permission's fate is #3887). In it: **President** (also `*`, as an override), **Vice President** and **Secretary** (nothing beyond the tier), and **Treasurer** (also `billing:view`, `billing:manage`, `points:adjust`, `points:view_all`, `reports:export`, `events:create`, `events:update`, as overrides).
  - **Officers and chairs** (tier 2) gives `members:view`. No role is seeded into it; it is where a chapter puts its chairs.
  - **Members** (tier 3) gives `members:view`, `backwork:upload`, `service:log`, `polls:create`, and the six member recruitment keys (`rush:view`, `rush:add`, `rush:notes`, `rush:vote`, `rush:view_results`, `rush:bid`; [`rush.md`](rush.md#permissions)). In it: **Member**.
  - **New members** (tier 4) gives `members:view`, `backwork:upload`. In it: **New Member**.
  - **Alumni** sits outside the tiers and holds `members:view`, `alumni:post` as overrides.
  - The officer defaults for new chapters (Paul, 2026-11-10, #4068 decision 9: the top two starting tiers approve service hours, post announcements and manage tasks and channels; the top tier also manages roles and chapter settings) are not seeded yet. They land with the rank rules in the next slice of #4071, and will reach new chapters only.
- System roles can be **renamed** and have their **permissions modified**, but cannot be deleted.
  - **Renaming is safe: system roles carry a stable `system_key`.** Each seeded role is created with a rename-proof identifier (`PRESIDENT`, `TREASURER`, `VICE_PRESIDENT`, `SECRETARY`, `MEMBER`, `NEW_MEMBER`, `ALUMNI`) stored in `roles.system_key`, unique per chapter. Every lookup that asks "is this *the* Alumni/President/Member role?" — the Alumni lifecycle restrictions (see [`alumni.md`](alumni.md)), the President notification target, the invite fallback role — resolves on that key, never on `name`. Renaming a system role is therefore a pure relabel: it changes no authorization or lifecycle outcome, and a custom role that takes the freed name inherits nothing.
  - `system_key` is **not writable through the API**. Role create forces it to `null` (custom roles never carry one) and role update strips it, so `roles:manage` can neither mint a role impersonating a seeded one nor detach a key from one.
  - **One legacy gap.** The backfill that introduced `system_key` matched existing rows by their current name, so a chapter that had *already* renamed a system role before that migration has no key on it and keeps the historical fail-open behavior (the restriction simply does not apply). The original identity is not recoverable after the fact. The guarantee is forward-looking: renames from that point on cannot break enforcement.
- Chapter admins with `roles:manage` can create unlimited **custom roles**. A Discord import can create them too, and add a `channels:read:<name>` read permission to a role: saving its role mapping and starting it both need `roles:manage` whenever they would do so, and it never assigns anyone ([`chat/README.md` § Imported archive messages](chat/README.md#imported-archive-messages)).
- Role **create, update, and delete** are scoped to the caller's active chapter (per the multi-tenancy invariant): update/delete load the target role and verify its `chapter_id` matches the active chapter, returning `403 Forbidden` when a role ID from another chapter is supplied.
- Role **create, update, and delete** each write a `chapter_audit_log` row (`role_created`, `role_updated`, `role_deleted`) mirrored to `#chapter-audit`, including those a Discord import makes as the member who started it. A permission-matrix toggle is a role update, so every grant and revoke is on the record. The diff shapes and the no-op rule are in [`settings/README.md` § Audit Rules](settings/README.md#audit-rules).
- Roles have a **display_order** (integer, for UI sorting) and an optional **color**, for chat name colors like Discord (#3485).
  - The color is one of ten fixed palette values (`ROLE_COLOR_PALETTE` in `packages/validation/src/role-colors.ts`), each readable as text on every charcoal surface. Role create and update refuse any other value (`400`), and `null` clears it. Red and gold are left out: red means a mention or an error, and gold is the Ask surface's.
  - A member's name in chat takes the color of their highest-ranked colored role: the lowest `display_order` among their roles that has one. A member with no colored role reads in the plain foreground, and the viewer's own name keeps the chapter accent. `GET /v1/members/roster` carries it per member as `role_color`, so no client needs `role_ids` to paint a name. Clients paint only palette values, so an older stored hex paints nothing.
  - Seeded roles get palette defaults from `DEFAULT_SYSTEM_ROLES` (`apps/api/src/domain/constants/permissions.ts`), which owns the per-role values. The rule is that the officer and Alumni roles are colored and Member and New Member are not, so officers stand out.
- Roles have a **mentionable** switch (2026-11-06, owner direction: "anyone can ping any role by default. officers can change defaults"): on by default for every row of `roles`, seeded, created on the Roles page or imported. Mention resolution and the picker read `roles` and `members.role_ids` (#3638). A `roles:manage` holder turns it off on the web Roles page; while it is off, only a member holding `channels:manage` or `roles:manage` (or the wildcard) can `@` the role in chat. The mention rules are in [`chat/README.md`](chat/README.md#role-mentions) § Role mentions.
- A user with no assigned roles has zero permissions (fail-safe closed).

## Tiers and overrides

Roles are grouped into **tiers** (#4071, Paul 2026-11-10). A tier does two jobs: it is the starting bundle of permissions for every role in it, and it is rank.

- **Tiers are the chapter's own.** How many there are, what each is called and their order are rows in `role_tiers` that the chapter edits ("not all chapters will have the same tier structure and thus there should be heavy customization at the very least in naming conventions"). The four a chapter starts with are seed data. Nothing in the product may read meaning into a tier's name or number beyond "a lower `position` ranks higher", and what a chapter calls a tier at all is its `tier` vocabulary term.
- **A role sits in one tier or outside them.** `roles.tier_id` is null for a role outside the tiers, as Alumni is. A role outside the tiers gets nothing from any tier and ranks below every tier.
- **An override switches one permission on or off for one role, and beats the tier.** `roles.permission_overrides` maps a permission key to `true` or `false`. A role's effective permissions are its tier's permissions, plus its overrides that are `true`, minus its overrides that are `false`. An override stays until it is cleared, whatever the tier later does.
- **A person still holds the union of their roles.** Overrides act on one role. An "off" override on one role does not remove a permission another of the member's roles grants: there is no deny across roles and no per-person override.
- **The effective list is written back.** `roles.permissions` always holds the role's effective list, so the [Permission Check Algorithm](#permission-check-algorithm) reads exactly the column it always read and `PermissionsGuard` knows nothing about tiers. The database keeps it true inside the writer's own transaction (migration `20261111140000`): a change to a role's tier or overrides rewrites that role's list, and a change to a tier's permissions rewrites the list of every role in it.
- **A write of `permissions` alone still works.** `PATCH /v1/roles/:id` with a `permissions` list, the Roles page's matrix and a Discord import all write the list and nothing else. The role then holds exactly that list, and the difference from its tier is recorded as overrides, changing as few as possible.
- **A tier never carries `*`.** The wildcard moves only through [Presidency Transfer](#presidency-transfer); a tier holding it would hand it to every role moved in. The President role holds `*` as an override.
- **A tier that still has roles cannot be deleted**, and a role can only sit in a tier of its own chapter. Both are database constraints.

### Chapters that existed before tiers

Migration `20261111140000` gave every existing chapter the four starting tier names and placed its roles without changing what any role can do: no role's `permissions` was written, and `scripts/pglite/tiers/role-tiers.mjs` proves the lists are byte-for-byte the same before and after.

- A role holding `*`, and the seeded President, Vice President, Treasurer and Secretary, went to the first tier; the seeded Member to the third; the seeded New Member to the fourth.
- The seeded Alumni, and any role with no permissions at all (most roles a Discord import made), stayed outside the tiers.
- Any other role went to the second tier when it held a permission the chapter's Member role lacked, and to the third otherwise. Ranking such a role too high takes nothing from anyone; ranking an officer's role too low would have stopped them editing roles they edit today.
- Each tier started with the permissions that every seeded role placed in it already held, leaving out any role holding `*`. A tier with no seeded role in it (the second tier always, since no role is seeded there) started with what every role placed in it held, so a chapter whose only officer role held `events:create` has a second tier that gives `events:create`; a tier with no roles started empty. Each role recorded its difference from its tier as overrides. So an existing chapter's President role carries "off" overrides for the tier's few permissions beside its `*`, which change nothing the wildcard grants.

The endpoints that edit tiers and overrides, the rank rules on who may edit what, and the officer defaults for new chapters are the next slice of #4071 and are not built yet.

## Default Invite Role

A chapter can nominate the role that new invites use when the sender does not name one. It is set in Settings → Roles by a caller holding `chapter-config:manage`, read and written through `GET`/`PATCH /v1/chapters/:id/config` as `default_invite_role_id`, and audit-logged like every other config change.

- **Resolution order** is explicit role → `chapters.default_invite_role_id` → the seeded Member role, which is resolved by `system_key` rather than by name (see Role Lifecycle above). A chapter that sets no default therefore behaves exactly as it did before this field existed. A blank or whitespace-only role name counts as "not named" rather than being stored as-is.
- **The id is stored, not the name.** `invites.role` is a display-name string matched by name at redeem time; a name persisted here would silently dangle on rename or delete, quietly demoting every later invite to the Member fallback. The id is resolved to a name at invite time instead.
- **Deleting the role clears the default** — the column is `on delete set null`, so the chapter reports "no default configured" rather than pointing at a role that no longer exists.
- **Cross-chapter ids are rejected with 400.** The database foreign key only proves the role exists; that it belongs to *this* chapter is enforced in `ChapterConfigService`, which is the layer that knows the caller's chapter. This matters because RLS is enabled with no permissive policies and the API holds the service-role key, so tenant isolation here is application-layer. The exception carries the code `chapter.config.invalid_default_invite_role`, which reaches clients in the error body since #1020 ([`architecture/README.md` § Error responses](../architecture/README.md#error-responses)).

## Presidency Transfer

The President role is a system role that always carries the `*` wildcard permission.

- **Transfer:** The current President assigns the President role to another member and removes it from themselves. This is a **single atomic operation** — the system never allows a chapter to have zero Presidents or two Presidents simultaneously.
  - Enforced at the database layer by the `transfer_presidency` RPC (migration `20260604120000`): the removal from the current President and the addition to the target run in one transaction, so a failed target update rolls back the removal — a partial failure can never drop or duplicate the President. A concurrent/stale transfer whose source no longer holds the wildcard role is rejected (`403`) rather than applied, and a transfer that targets the current President themselves (`target == current`) is rejected (`400`). `RbacService.transferPresidency` also compares **both** members' `chapter_id` to the active chapter after `findById` (target and current); the RPC remains the authority. The `currentMemberId` on this path comes from `@CurrentMember()`, so it is already chapter-bound — the extra comparison is defence-in-depth if a future caller passes an id from elsewhere.
  - **The outgoing President keeps member access** (#3670, migration `20261108200000`). When the roles left after President is removed grant no member access (no live role in the chapter carrying `members:view` or `*`), the same RPC transaction appends the chapter's Member role (by `system_key`), after their other roles. A founder holds President alone, so without this a transfer left them with no roles and refused on every screen. A member already holding Member gets no second copy, and a chapter with no resolvable Member role transfers as before. Before #4075 a held custom role carrying `members:view` counted as access too; `20261111200000` dropped that clause once every custom role had become a role.
- **Edge case:** If the President leaves the chapter (account deletion or manual removal by Frapp support), the system flags the chapter and prompts the next member with the highest-ranked admin role to claim the presidency. If no suitable member exists, Frapp support intervenes.
  - **The flag.** `chapters.needs_president` (`not null default false`) is set by `RbacService.flagIfPresidentRemoved`, called from the two orphaning paths: `MemberService.remove` (a `members:remove` holder removing the President — the "manual removal by Frapp support" case, since only a support-level actor is expected to hold that permission against a President) and `AccountDeletionService.deleteAccount` (the President anonymizing their own account), once per chapter membership that carried the wildcard-carrying President role. It is a no-op when the removed member did not hold that role, or the chapter has none.
  - **Eligibility.** "The next member with the highest-ranked admin role" resolves against the chapter's *live* `roles` table by ascending `display_order` (lower = higher rank), skipping the vacant President role, and stopping at the first role with at least one live member holding it — not a hardcoded `SystemRoleKeys` list, since `display_order` is chapter-editable and a chapter may add, rename or reorder roles freely. All members holding that one role are eligible; no other role's holders are. `RbacService.resolveEligibleClaimants` implements this and is shared by the read and write paths below.
    - **Floored at the chapter's own Member role.** The walk stops considering candidates once `display_order` reaches the chapter's seeded Member role (resolved by `system_key`) — roles ranked at or below that are the ordinary-member baseline, not an admin tier. Without this floor, a chapter whose officer seats (Treasurer/VP/Secretary) are all vacant would fall through all the way to "Member," letting any ordinary member — there may be dozens — claim the wildcard. When no role between President and Member has a live member, or the chapter's Member role cannot be resolved at all (the legacy `system_key` backfill gap, see the Role Lifecycle section above), nobody is eligible — the "Frapp support intervenes" case. This decision grants `*`, so the unresolvable-boundary case fails closed rather than removing the floor.
  - **`GET /v1/roles/presidency-claim-status`** — `{needs_president, eligible, next_role_name}` for the caller. Gated only on the controller's baseline `members:view` (i.e. every member), deliberately not `roles:manage`: the eligible claimant is by definition not the outgoing President, and the default role pack grants `roles:manage` only to President, so the very member who needs to see this would otherwise be locked out of the page that shows it. The web Roles page renders its claim banner outside the `roles:manage` gate for the same reason, and distinguishes a failed status fetch from a genuine "no eligible officer" result — the two must not read the same to an actually-eligible officer.
  - **`POST /v1/roles/claim-presidency`** — `RbacService.claimPresidency` re-validates `needs_president` and eligibility server-side (the status endpoint is advisory for the UI, not the enforcement point), then grants the role via the `claim_presidency` RPC (migration `20260901183000`): a compare-and-set on `needs_president` (true → false) in the same transaction as the role grant, so two eligible members racing to claim resolve to exactly one winner — the loser gets `409 Conflict`. An ineligible caller gets `403`; a chapter that doesn't currently need a President gets `400`. The RPC additionally re-verifies, atomically with the grant, that the claiming member still holds the role that made them eligible — the application-layer eligibility check and the RPC call are not the same transaction, so a concurrent `PATCH /v1/members/:id/roles` could otherwise strip that role from the claimant in between and still see the grant succeed.
  - `president_orphaned` (on flagging) and `presidency_claimed` (on a successful claim) are written to `chapter_audit_log` and mirror into `#chapter-audit`, and so is `presidency_transferred` on a successful transfer (the outgoing President as actor, `president_member_id` from their member id to the target's).
- **Safeguard:** Only the current President can initiate a presidency transfer. No other role (even with `roles:manage`) can assign or remove the President role.
  - `PATCH /v1/members/:id/roles` (the generic role-update endpoint) rejects any payload that adds or removes the chapter's system President role (the role carrying `*`) with **`403 Forbidden`**. The dedicated `POST /v1/roles/transfer-presidency` flow is the only path that can move the wildcard role.
  - `PATCH /v1/members/:id/roles` also validates every incoming `role_id` against the active chapter's roles and returns **`400 Bad Request`** for unknown or cross-chapter / fabricated role IDs, preventing such IDs from being persisted on a member. One exemption: an id the member **already holds** is accepted even when it no longer resolves (a deleted role's leftover — see Edge Cases), so a client echoing the member's current row back never has its save rejected; such ids resolve to no row and grant nothing.
  - The endpoint does **not** refuse a save that leaves the member with no role carrying member access (`members:view` or `*` on a live role): an officer may mean to. The role editors ask first instead (#3670), with one shared rule (`memberAccessRoleIds` / `removesMemberAccess` in `@repo/validation`): web's member sheet before a save that removes the last such role, and mobile's Directory roles sheet before the tap that does. A member who already lacked access is not asked about again. Web's sheet doesn't save until the roles list has loaded, so the question can't be skipped on placeholder rows.

## Custom roles folded into roles

Frapp has one role system: the `roles` table. Every role a chapter creates on the Roles page or brings in from a Discord import is a row there, beside the seeded ones, and is edited, tiered, colored and assigned the same way.

Until #4075 (2026-11-11) there was a second: `chapter_custom_roles` (label, rank, capabilities, `core`), assigned through `members.custom_role_ids`, edited in a Custom roles section of Settings → Roles, and bridged into enforcement by a second read in `PermissionsGuard`. Paul decided on 2026-11-10 to fold it into `roles` rather than build tiers for both, and to remove the Settings surface that edited it. Migration `20261111200000_fold_custom_roles.sql`:

- **Turned each custom role into a role** in the same chapter, holding its capabilities without `*` (the guard never honored a custom role's wildcard). It is always a new role, even when the chapter already had one of that name holding the same list, because events, mentions and the Members list key on role ids and reusing one would change what the custom role's holders see. It is named after the label, or "Label (custom)", then "Label (custom 2)", when the name was taken, cut to fit the 100-character cap. `chapter_custom_roles.folded_role_id` records which role each became and `folded_at` when, so a re-run skips it even after the role is deleted.
- **Placed it in a tier by what it grants, not by `rank`.** The only writer of `rank`, the web Settings page, set it to creation order, and the API default was 99, so no `rank` said anything about a tier. The rule is the one [`20261111140000`](../../supabase/migrations/20261111140000_role_tiers.sql) used for every unseeded role: no permissions puts it outside the tiers, a permission the chapter's Member role lacks puts it in the tier at position 2, and otherwise position 3; outside the tiers when the chapter has no tier at that position. The role keeps exactly its list either way.
- **Moved assignments into `role_ids`**, after the roles the member already held (so the first role, which web's Members list shows, did not change), once each. Ids naming a deleted or another chapter's custom role granted nothing and were dropped. `custom_role_ids` was emptied.
- **Kept every member's effective permissions identical**, which the PGlite tier `scripts/pglite/tiers/fold-custom-roles.mjs` checks member by member against the old guard's formula.

What is left, and goes in a later release ([#4194](https://github.com/pdcarlson/Frapp/issues/4194)): the `chapter_custom_roles` table and `members.custom_role_ids` stay for one release, for rollback and so the fold can run again before the drop. Nothing reads either for access. `GET /v1/custom-roles` stays as a deprecated route that returns `[]`, and `custom_role_ids` stays on the member profile (always empty), because store builds of the mobile app already shipped call and read them. `PATCH /v1/members/:id/roles` still accepts `custom_role_ids` because a web page loaded before the deploy sends it: `[]` is ignored, and a non-empty list, which only a page holding the member's pre-fold row can send, is refused with `409` so its stale `role_ids` can't drop the folded roles. The create, update and delete routes are gone.

The wildcard rules that protected both tables now protect `roles` alone: role create rejects `*`, role update rejects *introducing* `*` to a role that does not already carry it, and the seeded President role may not have its `*` *stripped* either (its other permissions stay editable), since the chapter would otherwise irrecoverably lose its wildcard holder. A legacy non-system role carrying a pre-validation `*` remains strippable, as that is its cleanup path. The generic member-role-update endpoint refuses to add or remove **any** wildcard-carrying role, keyed on the permission and compared as sets, so neither a duplicated id nor a legacy `*` role can smuggle wildcard access onto a member. The presidency-transfer flow is the only path that moves the wildcard between members.

## Custom-field visibility tiers

Custom member fields declare a `visibility` of `self` / `chapter` / `exec` / `president` (see [`members.md`](members.md#custom-fields)). When a member profile is read, the server resolves the viewer's **allowed visibility set** from their effective permissions plus whether they are the member, and only fields in that set are queried:

- `chapter` → any viewer who can see the directory (holds `members:view`).
- `self` → only the member themselves (the owner). The president does **not** override `self`, so privately-scoped fields stay private.
- `exec` → viewers with member/role management authority. Since the default role pack has no dedicated "exec" permission, exec tier is keyed off holding `roles:manage` **or** `members:remove` (or the wildcard). A chapter that grants those manage permissions to additional officer roles widens the exec tier accordingly.
- `president` → only the wildcard (`*`) holder.

`sensitive` fields follow the same gate: a field outside the allowed set is never selected, so its value never enters the response (enforcement is server-side, never client-only).

## Edge Cases

- If a role is deleted while members still hold it, those members lose the permissions from that role on their next request (no stale cached permissions).
- If a chapter has only one member (the President), that member cannot remove themselves or cancel the presidency.
- Role names must be unique within a chapter. Attempting to create a duplicate returns 409 Conflict.
- Role names are capped at **100 characters** (409's sibling failure: a longer name returns 400). Role names are chapter-authored strings that render in member lists and the role picker.
