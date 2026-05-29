# Multi-Tenancy

**Invariant:** Every resource query and mutation must be scoped to a `chapter_id`. No endpoint may return or modify data belonging to a chapter the requesting user is not a member of.

**Enforcement layers:**

1. **API middleware** — Extracts the active chapter from the request (header or JWT claim) and verifies the user is a member of that chapter.
2. **Database RLS** (where applicable) — Row-level security policies on Supabase ensure that even direct database access respects tenant boundaries.
3. **Schema** — Nearly all tables carry a `chapter_id` foreign key.

**Edge cases:**

- A user who is a member of multiple chapters must explicitly select which chapter is active. The API rejects requests where the chapter context is missing or mismatched.
- If a user's membership in a chapter is revoked mid-session, all subsequent requests for that chapter return 403 Forbidden.
- Endpoints that mutate a single resource by ID (e.g. `PATCH /v1/members/:id/roles`, `DELETE /v1/members/:id`) load the target row first and verify its `chapter_id` matches the caller's active chapter, returning 403 Forbidden when an ID from a different chapter is supplied.
- Cross-chapter data leaks are treated as critical security bugs.
