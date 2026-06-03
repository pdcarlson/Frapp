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

1. Fetch the user's `role_ids` for the active chapter from `members`.
2. Fetch the `permissions` arrays for those roles from `roles`.
3. Flatten to a unique set.
4. If the set contains `*`, access is granted.
5. Otherwise, check that **all** required permissions for the endpoint are present in the set.

Permissions are never cached across requests. Each request freshly resolves the user's permission set, ensuring that role changes take effect immediately.

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
- Chapter admins with `roles:manage` can create unlimited **custom roles**.
- Role **create, update, and delete** are scoped to the caller's active chapter (per the multi-tenancy invariant): update/delete load the target role and verify its `chapter_id` matches the active chapter, returning `403 Forbidden` when a role ID from another chapter is supplied.
- Roles have a **display_order** (integer, for UI sorting) and an optional **color** (hex string, for chat name colors like Discord).
- A user with no assigned roles has zero permissions (fail-safe closed).

## Presidency Transfer

The President role is a system role that always carries the `*` wildcard permission.

- **Transfer:** The current President assigns the President role to another member and removes it from themselves. This is a **single atomic operation** — the system never allows a chapter to have zero Presidents or two Presidents simultaneously.
- **Edge case:** If the President leaves the chapter (account deletion or manual removal by Frapp support), the system flags the chapter and prompts the next member with the highest-ranked admin role to claim the presidency. If no suitable member exists, Frapp support intervenes.
- **Safeguard:** Only the current President can initiate a presidency transfer. No other role (even with `roles:manage`) can assign or remove the President role.
  - `PATCH /v1/members/:id/roles` (the generic role-update endpoint) rejects any payload that adds or removes the chapter's system President role (the role carrying `*`) with **`403 Forbidden`**. The dedicated `POST /v1/roles/transfer-presidency` flow is the only path that can move the wildcard role.
  - `PATCH /v1/members/:id/roles` also validates every incoming `role_id` against the active chapter's roles and returns **`400 Bad Request`** for unknown or cross-chapter / fabricated role IDs, preventing such IDs from being persisted on a member.

## Custom roles vs. `chapter_custom_roles`

Two role models coexist. The live `roles` table described above is the **enforcement** source — the permission-check algorithm reads it, and the Settings → Roles "Live roles" sub-tab edits it. The separate `chapter_custom_roles` table (label, rank, capabilities, `core`) backs the Settings → Roles "Custom" sub-tab and its dedicated CRUD endpoints (see [`settings/customization.md`](settings/customization.md) → Roles Tab). `chapter_custom_roles` is presentation-only today; wiring it into the permission-check algorithm and member assignment is tracked as a follow-up and is **not** consulted by the enforcement path until then.

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
