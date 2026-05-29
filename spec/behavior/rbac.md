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
- **Seeded permissions (must match `DEFAULT_SYSTEM_ROLES` in `apps/api/src/domain/constants/permissions.ts`):**
  - **President:** `*` (wildcard).
  - **Treasurer:** `billing:view`, `billing:manage`, `points:adjust`, `points:view_all`, `polls:view_all`, `members:view`, `reports:export`, `events:create`, `events:update`.
  - **Vice President:** `members:view`, `polls:view_all` (baseline chapter API access plus dashboard chapter-wide poll list and tallies).
  - **Secretary:** `members:view`, `polls:view_all` (same as Vice President).
  - **Member:** `members:view`, `backwork:upload`, `service:log`, `polls:create`.
  - **New Member:** `members:view`, `backwork:upload`.
  - **Alumni:** `members:view`.
- System roles can be **renamed** and have their **permissions modified**, but cannot be deleted.
- Chapter admins with `roles:manage` can create unlimited **custom roles**.
- Roles have a **display_order** (integer, for UI sorting) and an optional **color** (hex string, for chat name colors like Discord).
- A user with no assigned roles has zero permissions (fail-safe closed).

## Presidency Transfer

The President role is a system role that always carries the `*` wildcard permission.

- **Transfer:** The current President assigns the President role to another member and removes it from themselves. This is a **single atomic operation** — the system never allows a chapter to have zero Presidents or two Presidents simultaneously.
- **Edge case:** If the President leaves the chapter (account deletion or manual removal by Frapp support), the system flags the chapter and prompts the next member with the highest-ranked admin role to claim the presidency. If no suitable member exists, Frapp support intervenes.
- **Safeguard:** Only the current President can initiate a presidency transfer. No other role (even with `roles:manage`) can assign or remove the President role. The generic `PATCH /v1/members/:id/roles` endpoint enforces this by resolving the chapter's system President role (the one carrying `*`) and rejecting any payload that adds or removes it with `403 Forbidden`; the dedicated `POST /v1/roles/transfer-presidency` flow remains the only path to move the wildcard role. That same endpoint also validates every incoming `role_id` against the active chapter's roles and rejects unknown IDs with `400 Bad Request` so cross-chapter or fabricated role IDs cannot be persisted on a member.

## Edge Cases

- If a role is deleted while members still hold it, those members lose the permissions from that role on their next request (no stale cached permissions).
- If a chapter has only one member (the President), that member cannot remove themselves or cancel the presidency.
- Role names must be unique within a chapter. Attempting to create a duplicate returns 409 Conflict.
