# Specification: RBAC Refinement

## 1. Overview
The RBAC Refinement track hardens the API by moving from simple role checks (e.g., "Is Admin") to granular permission checks (e.g., "Can create events"). This allows for custom roles and finer-grained control.

## 2. Database Schema (Drizzle)

### `permissions` (Hardcoded / Enum-like)
List of all possible actions in the system.
- `events:create`, `events:update`, `events:delete`
- `financials:create_invoice`, `financials:view_all`
- `members:invite`, `members:remove`
- `roles:manage`

### `roles`
Defines a set of permissions.
| Column | Type | Constraints |
| :--- | :--- | :--- |
| `id` | uuid | Primary Key |
| `chapter_id` | uuid | References `chapters.id`, Not Null |
| `name` | text | Not Null (e.g., "Treasurer") |
| `permissions` | text[] | Array of permission strings |
| `is_system` | boolean | Default: false (e.g. 'Admin' is system) |
| `created_at` | timestamp | Default: now() |

### `members` (Existing)
Already has `role_ids` array. We will link this to the new `roles` table.

## 3. Architecture

### Permissions Guard
- **Mechanism:** Interceptor/Guard that reads `@RequirePermissions()` metadata.
- **Logic:**
  1. Fetch user's `role_ids` from `members` table for the current `chapter_id`.
  2. Fetch `permissions` for those roles.
  3. Flatten to a unique set of user permissions.
  4. Verify if the required permissions are present.

### Role Management Service
- **Logic:** Create/Update/Delete roles for a chapter.
- **Logic:** Assign roles to members.

## 4. API Contracts

### `GET /api/rbac/roles`
- **Returns:** List of roles in the chapter.

### `POST /api/rbac/roles` (Admin Only)
- **Body:** `{ name, permissions: [] }`
- **Effect:** Creates a custom role.

### `PATCH /api/chapters/:id/members/:userId/roles`
- **Body:** `{ roleIds: [] }`
- **Effect:** Updates a member's roles.

## 5. Security & Decoupling
- **Fail-Safe:** If a user has no roles, they have 0 permissions.
- **Super Admin:** The "President" or "Admin" system role should have a wildcard `*` or all permissions.
