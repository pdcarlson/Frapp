# Multi-Tenancy

**Invariant:** Every resource query and mutation must be scoped to a `chapter_id`. No endpoint may return or modify data belonging to a chapter the requesting user is not a member of.

**Enforcement layers:**

1. **API middleware** — Extracts the active chapter from the request and verifies the user is a member of that chapter. **Precedence:** the JWT claim is authoritative; the `x-chapter-id` request header is accepted only as a fallback for clients that haven't refreshed their token to embed the active chapter. If both are present and disagree, the request is rejected with `403 Forbidden` (`chapter.context.mismatch`) — the header never overrides the JWT. Membership is validated against the resolved chapter before the handler runs.
2. **Database RLS** (where applicable) — Row-level security policies on Supabase ensure that even direct database access respects tenant boundaries.
3. **Schema** — Nearly all tables carry a `chapter_id` foreign key.

**Edge cases:**

- **Chapter context is per-request** (non-sticky). Each request carries the chapter context via the JWT claim (primary) or the `x-chapter-id` header (fallback), resolved by the API middleware per request. Single-chapter users have their sole chapter auto-resolved server-side. Multi-chapter users must supply the context explicitly — requests missing context return `400 Bad Request` (`chapter.context.required`); requests targeting a chapter the user is not a member of return `403 Forbidden` (`chapter.context.invalid`).
- If a user's membership in a chapter is revoked mid-session, all subsequent requests for that chapter return 403 Forbidden.
- Endpoints that mutate a single resource by ID (e.g. `PATCH /v1/members/:id/roles`, `DELETE /v1/members/:id`) load the target row first and verify its `chapter_id` matches the caller's active chapter, returning 403 Forbidden when an ID from a different chapter is supplied.
- Cross-chapter data leaks are treated as critical security bugs.
