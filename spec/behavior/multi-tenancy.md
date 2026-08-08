# Multi-Tenancy

**Invariant:** Every resource query and mutation must be scoped to a `chapter_id`. No endpoint may return or modify data belonging to a chapter the requesting user is not a member of.

**Enforcement layers:**

1. **API middleware** — Extracts the active chapter from the request and verifies the user is a member of that chapter. **Precedence:** the JWT claim is authoritative; the `x-chapter-id` request header is accepted only as a fallback for clients that haven't refreshed their token to embed the active chapter. If both are present and disagree, the request is rejected with `403 Forbidden` (`chapter.context.mismatch`) — the header never overrides the JWT. Membership is validated against the resolved chapter before the handler runs.
2. **Database RLS** (where applicable) — Row-level security policies on Supabase ensure that even direct database access respects tenant boundaries. **This is not a second line of defense for API traffic:** the API holds a single service-role client, which bypasses RLS entirely, so RLS only constrains clients that talk to Postgres directly (today: the web app's Realtime subscriptions). Layer 1 is the only control on every REST path.
3. **Schema** — Nearly all tables carry a `chapter_id` foreign key.

**How the claim is issued.** `users.active_chapter_id` holds the persisted selection, set through `POST /v1/chapters/:id/activate` after membership is validated. The `custom_access_token_hook` Postgres function stamps it into every issued access token as the top-level `active_chapter_id` claim, resolving in this order: the persisted selection while it is still a live membership, else the sole membership when the user has exactly one, else no claim. The API reads it with `getClaims()` — `getUser()` returns the database user record and never carries hook-issued claims.

Two consequences follow from tokens being immutable once issued:

- **The claim only changes when a token is issued.** Changing the active chapter must be followed by `supabase.auth.refreshSession()`, or the previous claim stands until the token expires (`jwt_expiry`, currently 3600s). Revoking a membership likewise only drops the claim at the next issuance — layer 1 still rejects the request, because membership is re-validated per request against the resolved chapter.
- **The hook is enabled per environment.** Local enables it in `supabase/config.toml`; hosted projects enable it in the dashboard (Authentication → Hooks) or via the Management API. Where it is not enabled the claim is simply absent and the header fallback carries context, so the two can be rolled out in either order.

**Changing the active chapter from a client.** On web, `useSelectChapter` (`apps/web/lib/auth/select-chapter.ts`) is the only sanctioned path, and it does four things in this order:

1. `POST /v1/chapters/:id/activate` — persists the selection, so the next issued token carries the new claim.
2. `supabase.auth.refreshSession()` — issues that token.
3. Write the persisted client store, which supplies the `x-chapter-id` fallback header.
4. Drop the client query cache.

The order is load-bearing. Writing the store before the token is reissued puts the header ahead of the claim, and every subsequent request is rejected with `chapter.context.mismatch` until the old token expires — so the helper leaves the store untouched whenever step 1 or 2 fails, and the caller reports the failure rather than showing a half-switched client. Step 4 exists because only some chapter-scoped query keys embed the chapter id; without it the outgoing chapter's rows stay cached and render under the incoming chapter's context, which is a cross-chapter leak in the client even though the API itself would reject the request.

Users with more than one membership switch from the dashboard sidebar (`ChapterSwitcher`). The control is hidden for single-chapter users, whose chapter auto-resolves server-side. When the persisted chapter is no longer a live membership — revoked, or a stale id left by another account on the same browser — the same control surfaces the chapters the user can still reach, instead of leaving them pinned to a context the API rejects with no way out.

**Edge cases:**

- **Chapter context is per-request** (non-sticky). Each request carries the chapter context via the JWT claim (primary) or the `x-chapter-id` header (fallback), resolved by the API middleware per request. Single-chapter users have their sole chapter auto-resolved server-side. Multi-chapter users must supply the context explicitly — requests missing context return `400 Bad Request` (`chapter.context.required`); requests targeting a chapter the user is not a member of return `403 Forbidden` (`chapter.context.invalid`).
- If a user's membership in a chapter is revoked mid-session, all subsequent requests for that chapter return 403 Forbidden.
- Endpoints that mutate a single resource by ID (e.g. `PATCH /v1/members/:id/roles`, `DELETE /v1/members/:id`, `PATCH /v1/backwork/departments/:id`, the chat message edit/delete/pin and category PATCH/DELETE routes) must verify the target row's `chapter_id` matches the caller's active chapter. Holding a permission in the caller's own chapter never grants it over another chapter's row.

  **Prefer scoping the write itself** — `.eq('chapter_id', …)` in the same statement — over a read-then-check, which leaves a TOCTOU window.

  **403 vs 404.** Both are acceptable and the choice is about disclosure, not correctness: a bare 403 confirms the ID exists somewhere. Return **404** wherever the ID space is guessable and the caller should not learn whether the row exists at all — the chat surfaces (see `spec/behavior/chat/README.md`) and `PATCH /v1/backwork/departments/:id` do this. Return **403** where the caller already legitimately knows the resource exists, as the member and role endpoints do. Never leak the other chapter's data in either body.
- **Permission resolution is itself chapter-scoped.** Roles carry `chapter_id`, so effective permissions are resolved only from roles in the active chapter; a stale or cross-chapter role ID on a member row grants nothing.
- Cross-chapter data leaks are treated as critical security bugs.
