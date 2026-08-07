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
| `members:invite`      | Generate invite tokens                                 |
| `members:remove`      | Remove members from the chapter                        |
| `members:view`        | View the full member directory                         |
| `points:adjust`       | Manually add/remove points                             |
| `points:view_all`     | View all members' transactions (not just own)          |
| `roles:manage`        | Create, edit, delete roles; assign roles to members    |
| `channels:create`     | Create chat channels                                   |
| `channels:manage`     | Edit/delete channels, pin messages, manage permissions |
| `announcements:post`  | Post in the #announcements channel                     |
| `billing:view`        | View subscription and invoice status                   |
| `billing:manage`      | Manage subscription, create member invoices            |
| `backwork:upload`     | Upload resources to Backwork                           |
| `backwork:admin`      | Manage courses, professors, delete resources           |
| `geofences:manage`    | Create/edit/delete study geofences                     |
| `polls:create`        | Create polls in channels                               |
| `polls:view_all`      | List polls chapter-wide with aggregate vote tallies    |
| `tasks:manage`        | Create, assign, and confirm tasks                      |
| `chapter_docs:upload` | Upload documents to Chapter Files                      |
| `chapter_docs:manage` | Delete/organize documents in Chapter Files             |
| `service:log`         | Log service hours (typically all members)              |
| `service:approve`     | Approve or reject service hour entries                 |
| `semester:rollover`   | Trigger a new semester rollover                        |
| `reports:export`      | Export attendance, points, and roster reports          |

Chapters can define **custom permission strings** beyond this catalog. Custom permissions are used for:

- Channel gating (a channel can require any permission string, including custom ones).
- UI visibility hints (show/hide a tab or action based on permissions).
- Future extensibility (new API features can adopt existing custom strings without schema changes).

The system does NOT reject unknown permission strings. It stores and evaluates them for gating purposes the same way it handles system permissions.

## Permission Check Algorithm

1. Fetch the user's `role_ids` **and `custom_role_ids`** for the active chapter from `members`.
2. Fetch the `permissions` arrays for those roles from `roles`, and the `capabilities` arrays for the custom roles from `chapter_custom_roles`, **both filtered to the active chapter**. Both role models are chapter-scoped, so an id carried on the membership that belongs to another chapter (stale, or written before an earlier validation gap was closed) matches no row and contributes no permissions. A request with no resolved active chapter is denied outright rather than resolved chapter-wide.
3. Flatten to a unique set: the union of live-role permissions and custom-role capabilities, except that a `*` appearing in custom-role capabilities is dropped (see the bridge model below — only the live President role wields the wildcard).
4. If the set contains `*`, access is granted.
5. Otherwise, check that **all** required permissions for the endpoint are present in the set.

Permissions are never cached across requests. Each request freshly resolves the user's permission set, ensuring that role changes take effect immediately.

The same resolution backs `GET /v1/users/me/permissions` (the effective-permission set clients use to render permission-aware UI), so the chapter filter applies there too.

### Lifecycle rules are separate from permissions

A permission answers "may this member do X?"; a **lifecycle rule** answers "is this member still an active participant?". The two are enforced independently, and passing the permission check above does not imply a lifecycle rule allows the action.

The only lifecycle rule today is the **Alumni** role (see [`alumni.md`](alumni.md)), which blocks study-hour accrual, event check-in, and posting outside `#alumni` / DMs. It is deliberately not modelled as a permission: the seeded Alumni permission set is `members:view`, exactly what active members hold, so widening or narrowing permissions could not express it — and the study controller's `members:view` requirement is satisfied by alumni, which is why the rule is enforced in the domain services rather than in `PermissionsGuard`. Holding the role is what restricts, so a member who still needs to act operationally should not carry it.

## Role Lifecycle

- On chapter creation, **default system roles** are seeded: President (`*`), Treasurer, Vice President, Secretary, Member, New Member, Alumni. Each has a sensible default permission set.
- **Seeded permissions** (the API implementation is the source of truth; the constants below must stay in sync with the seeded role definitions):
  - **President:** `*` (wildcard).
  - **Treasurer:** `billing:view`, `billing:manage`, `points:adjust`, `points:view_all`, `polls:view_all`, `members:view`, `reports:export`, `events:create`, `events:update`.
  - **Vice President:** `members:view`, `polls:view_all` (baseline chapter API access plus dashboard chapter-wide poll list and tallies).
  - **Secretary:** `members:view`, `polls:view_all` (same as Vice President).
  - **Member:** `members:view`, `backwork:upload`, `service:log`, `polls:create`.
  - **New Member:** `members:view`, `backwork:upload`.
  - **Alumni:** `members:view`.
- System roles can be **renamed** and have their **permissions modified**, but cannot be deleted.
  - **Renaming is safe: system roles carry a stable `system_key`.** Each seeded role is created with a rename-proof identifier (`PRESIDENT`, `TREASURER`, `VICE_PRESIDENT`, `SECRETARY`, `MEMBER`, `NEW_MEMBER`, `ALUMNI`) stored in `roles.system_key`, unique per chapter. Every lookup that asks "is this *the* Alumni/President/Member role?" — the Alumni lifecycle restrictions (see [`alumni.md`](alumni.md)), the President notification target, the invite fallback role — resolves on that key, never on `name`. Renaming a system role is therefore a pure relabel: it changes no authorization or lifecycle outcome, and a custom role that takes the freed name inherits nothing.
  - `system_key` is **not writable through the API**. Role create forces it to `null` (custom roles never carry one) and role update strips it, so `roles:manage` can neither mint a role impersonating a seeded one nor detach a key from one.
  - **One legacy gap.** The backfill that introduced `system_key` matched existing rows by their current name, so a chapter that had *already* renamed a system role before that migration has no key on it and keeps the historical fail-open behavior (the restriction simply does not apply). The original identity is not recoverable after the fact. The guarantee is forward-looking: renames from that point on cannot break enforcement.
- Chapter admins with `roles:manage` can create unlimited **custom roles**.
- Role **create, update, and delete** are scoped to the caller's active chapter (per the multi-tenancy invariant): update/delete load the target role and verify its `chapter_id` matches the active chapter, returning `403 Forbidden` when a role ID from another chapter is supplied.
- Roles have a **display_order** (integer, for UI sorting) and an optional **color** (hex string, for chat name colors like Discord).
- A user with no assigned roles has zero permissions (fail-safe closed).

## Presidency Transfer

The President role is a system role that always carries the `*` wildcard permission.

- **Transfer:** The current President assigns the President role to another member and removes it from themselves. This is a **single atomic operation** — the system never allows a chapter to have zero Presidents or two Presidents simultaneously.
  - Enforced at the database layer by the `transfer_presidency` RPC (migration `20260604120000`): the removal from the current President and the addition to the target run in one transaction, so a failed target update rolls back the removal — a partial failure can never drop or duplicate the President. A concurrent/stale transfer whose source no longer holds the wildcard role is rejected (`403`) rather than applied, and a transfer that targets the current President themselves (`target == current`) is rejected (`400`).
- **Edge case:** If the President leaves the chapter (account deletion or manual removal by Frapp support), the system flags the chapter and prompts the next member with the highest-ranked admin role to claim the presidency. If no suitable member exists, Frapp support intervenes.
- **Safeguard:** Only the current President can initiate a presidency transfer. No other role (even with `roles:manage`) can assign or remove the President role.
  - `PATCH /v1/members/:id/roles` (the generic role-update endpoint) rejects any payload that adds or removes the chapter's system President role (the role carrying `*`) with **`403 Forbidden`**. The dedicated `POST /v1/roles/transfer-presidency` flow is the only path that can move the wildcard role.
  - `PATCH /v1/members/:id/roles` also validates every incoming `role_id` against the active chapter's roles and returns **`400 Bad Request`** for unknown or cross-chapter / fabricated role IDs, preventing such IDs from being persisted on a member. One exemption: an id the member **already holds** is accepted even when it no longer resolves (a deleted role's leftover — see Edge Cases), so a client echoing the member's current row back never has its save rejected; such ids resolve to no row and grant nothing.

## Custom roles vs. `chapter_custom_roles` (bridge model)

Two role models coexist, and **both enforce**. The live `roles` table described above remains the primary source — the permission-check algorithm reads it, and the Settings → Roles "Live roles" sub-tab edits it. The separate `chapter_custom_roles` table (label, rank, capabilities, `core`) backs the Settings → Roles "Custom" sub-tab and its dedicated CRUD endpoints (see [`settings/customization.md`](settings/customization.md) → Roles Tab), and is **bridged** into enforcement rather than merged into `roles`:

- **Assignment.** Members carry assigned custom roles in `members.custom_role_ids`, parallel to `role_ids`. `PATCH /v1/members/:id/roles` accepts an optional `custom_role_ids` array — omitted means unchanged (so pre-bridge clients never strip an assignment), `[]` clears it. Every incoming id is validated against the active chapter's `chapter_custom_roles` and unknown or cross-chapter ids are rejected with `400`, mirroring the `role_ids` rule — including its held-id exemption: an id the member already holds is accepted even when its role has since been deleted (the leftover resolves to no row and grants nothing), so echoing the member's current row back never fails a save.
- **Resolution.** Steps 2–3 of the Permission Check Algorithm flatten the member's custom-role `capabilities` into the same unique set as live-role permissions, filtered to the active chapter identically (a stale or cross-chapter id matches no row and contributes nothing). This applies everywhere the set is resolved: `PermissionsGuard`, `RbacService.memberHasAnyPermission` / `getEffectivePermissions`, and therefore `GET /v1/users/me/permissions`, channel gating, and custom-field visibility. Permissions are still never cached across requests, so assignment and capability edits take effect immediately.
- **Wildcard exclusion.** Custom roles can never carry `*`: create/update reject a wildcard capability with `400`, and the resolver drops `*` from custom-role capabilities defensively (pre-validation rows). The same rule protects the live `roles` table: role create rejects `*`, role update rejects *introducing* `*` to a role that does not already carry it, and the seeded President role may not have its `*` *stripped* either (its other permissions stay editable) — otherwise the chapter would irrecoverably lose its wildcard holder. A legacy non-system role carrying a pre-validation `*` remains strippable, as that is its cleanup path. The generic member-role-update endpoint refuses to add or remove **any** wildcard-carrying role — keyed on the permission and compared as sets, so neither a duplicated id nor a legacy `*` role can smuggle wildcard access onto a member. The presidency-transfer flow is the only path that moves the wildcard between members.
- **Capability edits are officer-trust surface.** Because capabilities now enforce, `chapter-config:manage` transitively controls what any assigned custom role grants — including roles the editor themselves holds. This is an accepted consequence of the bridge (the permission is officer-tier and every write is audit-logged to `#chapter-audit`), but it means granting `chapter-config:manage` should be treated with the same care as `roles:manage`.
- **Fail-safe.** A member with neither live roles nor custom roles has zero permissions, as before. Deleting a custom role while members still hold its id behaves like live-role deletion: the id resolves to no row and the capabilities vanish on the next request.

The bridge (rather than folding `chapter_custom_roles` into `roles`) was chosen because it is additive and reversible — no destructive data migration — and the tables serve distinct product concepts: `roles` is the RBAC ledger, `chapter_custom_roles` is the archetype-flavored role catalog surfaced in the Roles tab and permission matrix.

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
