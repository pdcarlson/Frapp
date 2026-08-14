# Authorization model — route scoping and RLS truth table

Reference for **how Frapp proves a caller may touch a row**. Two questions this doc answers, for
every route and every table:

1. **Routes** — what proves the caller owns the row they read or write? (`#847`)
2. **Tables** — which *layer* enforces tenancy: Postgres RLS, or the API?

Keep this current when adding a route, a table, or a storage bucket. It is a durable map of the
enforcement model, not a point-in-time audit write-up.

Related: [`SECURITY_FIXES.md`](SECURITY_FIXES.md) (history of applied fixes) ·
[`../../../spec/behavior/multi-tenancy.md`](../../../spec/behavior/multi-tenancy.md) (product rules).

---

## 1. The model in short

Frapp is multi-tenant **by chapter**. Every request carries a bearer token, and the active chapter
comes from the JWT `active_chapter_id` claim (an `x-chapter-id` header is a legacy fallback). Three
guards compose, in this order:

| Guard | Proves | Source |
| --- | --- | --- |
| `SupabaseAuthGuard` | The bearer token is valid; `request.supabaseUser` is set | `guards/supabase-auth.guard.ts` |
| `ChapterGuard` | The caller **is a member of** the active chapter; sets `request.chapterId`, `request.member`, `request.appUser`. Also enforces subscription state and the module toggle | `guards/chapter.guard.ts` |
| `PermissionsGuard` | The caller's resolved permission set satisfies `@RequirePermissions` / `@RequireAnyOfPermissions` | `guards/permissions.guard.ts` |

**The header is never trusted on its own.** `ChapterGuard` re-reads the membership row for whatever
chapter was requested (`chapter.guard.ts:68-76`), and a JWT/header disagreement is a hard
`403 chapter.context.mismatch` (`:130-136`) — the header cannot override the claim. A user with no
chapter context is auto-resolved only when they hold exactly one membership (`:143-153`).

Below the guards, the API talks to Postgres with the **service-role key, which bypasses RLS**. So for
almost every table the *API is the enforcing layer* and RLS is a default-deny backstop. See §4.

### The four tenancy-proof idioms

Every route uses one of these. Anything that matches none of them is a bug.

| # | Idiom | Proof | Example |
| --- | --- | --- | --- |
| **A** | **Guard-resolved chapter** — the handler takes `@CurrentChapterId()` and never a client chapter id | `ChapterGuard` verified membership | `tasks`, `events`, `invoices` — the majority |
| **B** | **Scoped repository read** — `findById(id, chapterId)`; a foreign id simply returns no row | Query predicate | `task.service.ts:78`, `event.service.ts`, `financial-invoice.service.ts:103` |
| **C** | **Fetch-then-compare** — unscoped `findById(id)` followed by an explicit `chapter_id !== chapterId` throw | Post-fetch check | `member.service.ts:112`, `rbac.service.ts:70`, `invite.service.ts:148` |
| **D** | **Self-scoped** — the row is keyed by the caller's own user id, no chapter involved | `@CurrentUser('id')` | `users/me`, `settings`, `push-tokens`, `notifications` |

Idiom **C** is the fragile one: the check is a separate statement that a refactor can drop without
breaking a type. `apps/api/test/cross-tenant-isolation.e2e-spec.ts` exists to fail when that happens.

---

## 2. Route → guard → ownership proof

Guard column: **A** = `SupabaseAuthGuard`, **C** = `ChapterGuard`, **P** = `PermissionsGuard`.
Permissions shown are the effective requirement (class-level unless the route overrides).

### Chapter-scoped controllers (full `A+C+P` chain)

These take `@CurrentChapterId()` from the guard and never a client-supplied chapter id — **idiom A**,
composed with **B** or **C** for per-row reads.

| Controller / base | Routes | Guards | Row proof |
| --- | --- | --- | --- |
| `alumni` | `GET /` | A+C+P `members:view` | A — chapter-scoped list |
| `backwork` | `POST /upload-url`, `POST /`, `GET /`, `GET /departments`, `PATCH /departments/:id`, `GET /professors`, `GET /:id`, `DELETE /:id` | A+C+P, `backwork:upload` / `backwork:admin` on writes | B — `resourceRepo.findById(id, chapterId)` (`backwork.service.ts:201,222`) |
| `billing` | `GET /status`, `POST /checkout`, `POST /portal` | A+C+P `billing:view` / `billing:manage`; `@SubscriptionExempt` | A — chapter is the subject |
| `chapters/:id/config` | `GET`, `PATCH`, `POST /:id/theme-palette` | A+C+P `chapter_config:view` / `…:manage`\|`*` | A — **path `:id` is deliberately ignored** (bound as `_id`); the guard-resolved chapter is used (`chapter-config.controller.ts:41,57,74`). See §5.1 |
| `documents` | `POST /upload-url`, `POST /`, `GET /`, `GET /folders`, `POST /folders`, `PATCH /folders/:id`, `DELETE /folders/:id`, `GET /:id`, `DELETE /:id` | A+C+P `members:view`, `chapter_docs:upload` / `…:manage` | B — `findById(id, chapterId)` |
| `channels` (chat) | 23 routes incl. `GET/POST /:id/messages`, `PATCH/DELETE /messages/:messageId`, pins, reactions, `POST /:id/upload-url` | A+C+P `members:view`, `channels:create` / `channels:manage` | B for channels/categories; **C** for messages via `assertMessageAccess` → `assertChannelAccess` (`chat.service.ts:566-590`) |
| `custom-fields` | `GET`, `POST`, `PATCH /:id`, `DELETE /:id` | A+C+P `chapter_config:view` | B |
| `custom-roles` | `GET`, `POST`, `PATCH /:id`, `DELETE /:id` | A+C+P `chapter_config:view` | B — `findByIds(ids, chapterId)` |
| `events` | `GET`, `GET /:id`, `POST`, `PATCH /:id`, `GET /:id/ics`, `DELETE /:id` | A+C+P `members:view`, `events:create/update/delete` | B — `eventRepo.findById(id, chapterId)` |
| `events/:eventId/attendance` | `POST /check-in`, `GET /`, `PATCH /:userId`, `POST /auto-absent` | A+C (+P `events:update` on writes) | B — event fetched as `findById(eventId, chapterId)` first (`attendance.service.ts:43,136,152,176`); `:userId` only ever writes inside that event |
| `invoices` | `GET`, `GET /overdue`, `GET /:id`, `POST`, `PATCH /:id`, `POST /:id/status`, `POST /:id/payment-intent`, `GET /:id/transactions` | A+C+P `members:view`, `billing:view` / `billing:manage` | B — `invoiceRepo.findById(id, chapterId)` |
| `members` | `GET`, `GET /search`, `GET /:id`, `PATCH /:id/roles`, `PATCH /me/onboarding`, `DELETE /:id` | A+C+P `members:view`, `roles:manage`, `members:remove` | **C** — `memberRepo.findById(id)` then `member.chapter_id !== chapterId → 403` (`member.service.ts:112,205,218`) |
| `points` | `GET /me`, `GET /leaderboard`, `GET /transactions`, `GET /members/:userId`, `POST /adjust` | A+C+P `members:view`, `points:view_all`, `points:adjust` | B — `pointTxnRepo.findByUser(chapterId, userId)`; a foreign `:userId` yields an empty summary, not another chapter's rows |
| `polls` | `POST /channels/:channelId/polls`, `POST/DELETE /polls/:messageId/vote`, `GET /polls`, `GET /polls/:messageId` | A+C+P `members:view`, `polls:create`, `polls:view_all` | **C** — `messageRepo.findById()` then `channelAccess.assertChannelAccess(channel_id, chapterId, …)` before any poll field is read (`poll.service.ts:110,178,208`) |
| `roles` | `GET`, `GET /permissions-catalog`, `POST`, `PATCH /:id`, `DELETE /:id`, `POST /transfer-presidency` | A+C+P `members:view`, `roles:manage`, `*` for transfer | **C** — `roleRepo.findById()` then `role.chapter_id !== chapterId → 403` (`rbac.service.ts:70,124`) |
| `reports` | `POST /attendance`, `POST /points`, `POST /roster`, `POST /service` | A+C+P `reports:export` | A |
| `search` | `GET /` | A+C+P `members:view` | A |
| `semesters` / `chapters/current/rollover` | `POST /chapters/current/rollover`, `GET /semesters` | A+C+P `members:view`, `semester:rollover` | A |
| `service-entries` | `GET`, `GET /leaderboard`, `GET /:id`, `POST /proof-upload-url`, `GET /:id/proof-url`, `POST`, `PATCH /:id/review`, `DELETE /:id` | A+C, +P per route: `members:view`, `service:log`, `service:approve` | B — `serviceEntryRepo.findById(id, chapterId)` (`service-entry.service.ts:183,221,376,439,470`) |
| `geofences` / `study-sessions` | `GET`, `POST`, `PATCH /:id`, `DELETE /:id`; `POST /start|heartbeat|pause|resume|stop`, `GET /` | A+C+P `members:view`, `geofences:manage` | B — `geofenceRepo.findById(id, chapterId)` at all 8 call sites |
| `tasks` | `GET`, `GET /:id`, `POST`, `PATCH /:id/status`, `POST /:id/confirm`, `POST /:id/reject`, `DELETE /:id` | A+C+P `members:view`, `tasks:manage` | B — `taskRepo.findById(id, chapterId)`; `GET /:id` additionally narrows to **assignee or `tasks:manage`** (`task.controller.ts:64-72`) — a per-row ACL on top of chapter scoping |

### Controllers without `ChapterGuard`

The interesting half. Each takes either **no** chapter id, or a client-supplied one it verifies itself.

| Route | Guards | Why it is safe |
| --- | --- | --- |
| `GET /health` | none | Liveness only; no tenant data |
| `POST /webhooks/stripe` | none (throttler skipped) | **HMAC signature** verified against `STRIPE_WEBHOOK_SECRET` before the body is parsed; an invalid signature is `401` (`webhook.controller.ts:52-66`). Not user-authenticated by design |
| `GET /chapter-directory/search` | A | Public reference dataset (Greek orgs + universities). Contains no chapter-owned data |
| `GET /analytics/identity` | A | **D** — returns the caller's own pseudonymous id |
| `POST /analytics/events` | A | Body carries `chapter_id`; `trackFromClient` resolves `members.findByUserAndChapter(userId, chapterId)` and **403s a non-member**; a DB error fails closed (`analytics.service.ts:157-170`) |
| `POST /chapters`, `POST /chapters/onboard` | A | Creates a new chapter for the caller; no existing row is addressed |
| `GET /chapters` | A | **D** — lists only the caller's own memberships |
| `POST /chapters/:id/activate` | A | Client-supplied `:id`, but `setActiveChapter` requires a membership row and throws `403` otherwise (`chapter.service.ts:81-87`) |
| `POST /invites/redeem` | A | Redeems by opaque invite code; the code *is* the capability. Chapter comes from the invite row, not the caller |
| `GET/PATCH /users/me`, `DELETE /users/me` | A | **D** |
| `GET /users/me/permissions`, `POST /users/me/avatar-url` | A+C | Chapter context needed; guard supplies it |
| `POST /push-tokens`, `DELETE /push-tokens/:id` | A | **D** — `removePushToken` checks `existing.user_id !== userId → 404` (`notification.service.ts:299`) |
| `GET /notifications`, `PATCH /notifications/:id/read` | A | **D** — `markNotificationRead` checks `existing.user_id !== userId → 404` (`:271`) |
| `GET /notifications/preferences?chapterId=`, `PATCH /notifications/preferences` | A | Client-supplied chapter id with **no** `ChapterGuard` — verified explicitly by `assertChapterMembership(userId, chapterId)` (`notification.service.ts:309,319,334`) |
| `GET/PATCH /settings` | A | **D** |

---

## 3. What the enumeration found

**No route returns another chapter's data.** Every id-taking route resolves to one of the four
idioms above. Specifically checked and clear:

- **All 10 unscoped `findById(id)` repositories** — `attendance`, `chapter`, `chat-message`,
  `invite`, `member`, `notification`, `push-token`, `role`, `study-session`, `user` — have callers
  that re-check tenancy (idiom C) or are self-scoped (idiom D).
- **`x-chapter-id` swap** — rejected by `ChapterGuard`'s membership re-read, and a mismatch against
  the JWT claim is a distinct `403` before any query runs.
- **`transfer-presidency`** — `currentMemberId` comes from the server-resolved `@CurrentMember()`,
  not the body, so it cannot be pointed at another chapter's member; the target is checked against
  `chapterId` and the write goes through the chapter-scoped `transfer_presidency` RPC.

The residual items in §5 are contract/robustness concerns, not data leaks.

---

## 4. RLS truth table

**Every one of the 43 tables has `enable row level security`.** 41 of them carry **zero policies**,
which under Postgres means *default deny* — no `anon` or `authenticated` client can read or write
them at all. The API reaches them with the **service-role key, which bypasses RLS**.

That is deliberate, not an oversight, and the design is stated in
`supabase/migrations/20260803150000_chat_message_actions_membership_rls.sql:14-17`:

> *"The check must read chat_messages / chat_channels / members / roles, which are all default-deny
> (RLS enabled, no policies). Under the invoking `authenticated` role those sub-selects would return
> nothing…"*

**Consequence for anyone adding a table:** enabling RLS and writing no policy is the correct default.
Adding an `auth.uid()` policy *widens* access from "nothing" to "something" and must be justified by
a client that genuinely reads the table directly.

### Enforcing layer per table

| Enforcing layer | Tables | Count |
| --- | --- | --- |
| **API only** (RLS on, no policy → default-deny; service-role bypasses) | `backwork_departments`, `backwork_professors`, `backwork_resources`, `channel_read_receipts`, `chapter_activation_milestones`, `chapter_custom_fields`, `chapter_custom_roles`, `chapter_directory`, `chapter_directory_requests`, `chapter_document_folders`, `chapter_documents`, `chapter_dues_config`, `chapter_service_config`, `chapter_workflows`, `chapters`, `chat_channel_categories`, `chat_channels`, `chat_messages`, `event_attendance`, `events`, `financial_invoices`, `financial_transactions`, `invites`, `member_custom_field_values`\*, `members`\*, `message_reactions`, `notification_preferences`, `notifications`, `point_transactions`, `poll_votes`, `push_tokens`, `roles`, `scheduled_notification_dispatches`, `semester_archives`, `service_entries`, `stripe_webhook_events`, `study_geofences`, `study_sessions`, `tasks`, `user_settings`, `users`\* | 41 |
| **RLS enforces** (read directly by a user-JWT client) | `chat_message_actions` | 1 |
| **RLS enforces** (policy present, defense-in-depth) | `chat_notification_preferences` | 1 |

\* carries a non-widening policy — see the notes below.

### The policies that do exist (10 statements)

| Table | Policy | Effect |
| --- | --- | --- |
| `chat_message_actions` | `_select` | `auth.role() = 'authenticated' AND can_read_chat_message(message_id)` — per-row channel-membership check via a `SECURITY DEFINER` function mirroring `canAccessChannel`. **This is the one table where RLS is the only gate**: the web reads it directly (`apps/web/lib/chat/realtime-manager.ts`, 2 call sites) |
| `chat_message_actions` | `_insert`, `_delete` | `user_id in (select id from users where supabase_auth_id = auth.uid())` — own rows only |
| `chat_notification_preferences` | `_select_own` | Own rows only |
| `chapter_audit_log` | `_no_update`, `_no_delete` | `using (false)` — append-only, tightens rather than widens |
| `member_custom_field_values` | `_service_role` | `auth.role() = 'service_role'` — explicit rather than implicit; no non-service access |
| `users`, `members` | `auth_admin_can_read_*` | `to supabase_auth_admin` only — lets the custom-access-token hook read the `active_chapter_id` claim. Not reachable by `anon`/`authenticated` |

### Storage buckets

All **seven** buckets are declared `public = false` in IaC, so nothing is served by an unauthenticated
URL:

| Bucket | Declared in | MIME allowlist |
| --- | --- | --- |
| `branding`, `profiles` | `20260808204500_declare_dashboard_created_buckets.sql` | images |
| `documents`, `backwork`, `chat` | same | per-bucket |
| `service` (service proof) | `20260803231500_service_proof_bucket.sql` | images + `application/pdf` |
| `reports` | `20260805133000_reports_bucket.sql` | `application/pdf` |

Clients never read a bucket directly; the API issues short-lived signed URLs after running the same
route guards. Every bucket carries a MIME allowlist and a 25 MB (`26214400`) size cap. Note the five
dashboard-created buckets were only brought into IaC by #690 — their pre-migration public/private
state is tracked in #770.

---

## 5. Residual items

Neither is a cross-tenant leak; both are tracked so they are not rediscovered.

### 5.1 `chapters/:id/config` ignores its own path parameter

`GET|PATCH /v1/chapters/:id/config` and `POST /v1/chapters/:id/theme-palette` bind the path segment
as `_id` and operate on the guard-resolved chapter instead (`chapter-config.controller.ts:41,57,74`).

Passing **another chapter's id returns 200 with your own chapter's config** rather than `403`. No
data crosses a tenant boundary — the response is always the caller's own chapter — but the URL
asserts something the handler does not honour, which is exactly the shape a future refactor
misreads. The fix is a one-line `_id !== chapterId → 403` assertion, or dropping `:id` from the path
(a breaking route change). Tracked separately; not changed here because the route shape is a
public-API decision.

### 5.2 `chat_messages` Realtime subscription is RLS-blind

`realtime-manager.ts:414-419` subscribes to `postgres_changes` on `public.chat_messages` with the
user-JWT client. That table is default-deny, so Postgres Changes delivers **no rows** to it. This
fails safe — nothing leaks — but it means the subscription cannot be the live-message transport it
appears to be. Worth confirming which path actually carries new messages before anyone "fixes" the
RLS by adding a policy, which *would* widen access. Tracked separately.

---

## 6. Regression coverage

`apps/api/test/cross-tenant-isolation.e2e-spec.ts` drives the **real** `ChapterGuard` and the **real**
service-layer checks against a table-aware in-memory Supabase fake seeded with two chapters. It
asserts that a member of chapter B is rejected when they:

- send chapter A's `x-chapter-id` (no membership) → `403 chapter.context.invalid`
- send an `x-chapter-id` that disagrees with their JWT claim → `403 chapter.context.mismatch`
- request chapter A's member, role, invite, task, event, or invoice by raw id → `403` / `404`
- read or write notification preferences for chapter A → `403`

The rest of the e2e suite stubs `ChapterGuard`; this spec must not, or it tests nothing.
