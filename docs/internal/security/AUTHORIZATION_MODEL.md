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
| **C** | **Fetch-then-compare** — unscoped `findById(id)` followed by an explicit `chapter_id !== chapterId` throw | Post-fetch check | `member.service.ts:112`, `rbac.service.ts:71`, `invite.service.ts:148` |
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
| `chapters/:id/config` | `GET`, `PATCH`, `POST /:id/theme-palette` | A+C+P `chapter_config:view` / `…:manage`\|`*` | A — data always comes from the guard-resolved chapter; `:id` disagreeing with it is rejected with `403 chapter.context.mismatch` (`chapter-config.controller.ts:45,64,80`, `assertMatchesActiveChapter`). See §5.1 |
| `documents` | `POST /upload-url`, `POST /`, `GET /`, `GET /folders`, `POST /folders`, `PATCH /folders/:id`, `DELETE /folders/:id`, `GET /:id`, `DELETE /:id` | A+C+P `members:view`, `chapter_docs:upload` / `…:manage` | B — `findById(id, chapterId)` |
| `channels` (chat) | 23 routes incl. `GET/POST /:id/messages`, `PATCH/DELETE /messages/:messageId`, pins, reactions, `POST /:id/upload-url` | A+C+P `members:view`, `channels:create` / `channels:manage` | B for categories; **C** for channels and messages — the list filters through `filterAccessibleChannels` and `GET /:id` through `assertChannelAccess` (`chat.service.ts:263-290`), messages via `assertMessageAccess` → `assertChannelAccess` (`chat.service.ts:702-753`). The `channels:manage` mutations resolve chapter-scoped only, by design |
| `custom-fields` | `GET`, `POST`, `PATCH /:id`, `DELETE /:id` | A+C+P `chapter_config:view` | B |
| `custom-roles` | `GET`, `POST`, `PATCH /:id`, `DELETE /:id` | A+C+P `chapter_config:view` | B — `findByIds(ids, chapterId)` |
| `events` | `GET`, `GET /:id`, `POST`, `PATCH /:id`, `GET /:id/ics`, `DELETE /:id` | A+C+P `members:view`, `events:create/update/delete` | B — `eventRepo.findById(id, chapterId)`. The three read routes (`GET`, `GET /:id`, `GET /:id/ics`) additionally filter out a role-targeted event (`required_role_ids` non-empty) unless the caller's `member.role_ids` intersects it — `event.service.ts`'s `isVisibleToViewer`, keyed on the optional `viewerId` param the controller passes only on reads; `update`/`delete`/series internals omit it and are unfiltered, since those already require `events:update`/`events:delete` (#1463) |
| `events/:eventId/attendance` | `POST /check-in`, `GET /`, `PATCH /:userId`, `POST /auto-absent` | A+C (+P `events:update` on writes) | B — event fetched as `findById(eventId, chapterId)` first (`attendance.service.ts:43,136,152,176`); `:userId` only ever writes inside that event |
| `invoices` | `GET`, `GET /overdue`, `GET /:id`, `POST`, `PATCH /:id`, `POST /:id/status`, `POST /:id/payment-intent`, `GET /:id/transactions` | A+C+P `members:view`, `billing:view` / `billing:manage` | B — `invoiceRepo.findById(id, chapterId)` |
| `members` | `GET`, `GET /search`, `GET /:id`, `PATCH /:id/roles`, `PATCH /me/onboarding`, `DELETE /:id` | A+C+P `members:view`, `roles:manage`, `members:remove` | **C** — `memberRepo.findById(id)` then `member.chapter_id !== chapterId → 403` (`member.service.ts:112,205,218`) |
| `points` | `GET /me`, `GET /leaderboard`, `GET /transactions`, `GET /members/:userId`, `POST /adjust` | A+C+P `members:view`, `points:view_all`, `points:adjust` | B — `pointTxnRepo.findByUser(chapterId, userId)`; a foreign `:userId` yields an empty summary, not another chapter's rows |
| `polls` | `POST /channels/:channelId/polls`, `POST/DELETE /polls/:messageId/vote`, `GET /polls`, `GET /polls/:messageId` | A+C+P `members:view`, `polls:create`, `polls:view_all` | **C** — `messageRepo.findById()` then `channelAccess.assertChannelAccess(channel_id, chapterId, …)` before any poll field is read (`poll.service.ts:110,178,208`) |
| `roles` | `GET`, `GET /permissions-catalog`, `POST`, `PATCH /:id`, `DELETE /:id`, `POST /transfer-presidency` | A+C+P `members:view`, `roles:manage`, `*` for transfer | **C** — `roleRepo.findById()` then `role.chapter_id !== chapterId → 403` (`rbac.service.ts:71,124`) |
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
| `GET /health/ready` | none | Readiness probe for deploy smoke checks; no tenant data |
| `POST /webhooks/stripe` | none (throttler skipped) | **HMAC signature** verified against `STRIPE_WEBHOOK_SECRET` before the body is parsed; an invalid signature is `401` (`webhook.controller.ts:52-66`). Not user-authenticated by design |
| `GET /chapter-directory/search` | A | Public reference dataset (Greek orgs + universities). Contains no chapter-owned data |
| `GET /analytics/identity` | A | **D** — returns the caller's own pseudonymous id |
| `POST /analytics/events` | A | Body carries `chapter_id`; `trackFromClient` resolves `members.findByUserAndChapter(userId, chapterId)` and **403s a non-member**; a DB error fails closed (`analytics.service.ts:157-170`) |
| `POST /chapters`, `POST /chapters/onboard` | A | Creates a new chapter for the caller; no existing row is addressed |
| `GET /chapters` | A | **D** — lists only the caller's own memberships. Each embedded chapter is the member-safe projection (`toChapterMemberView`), not the raw row: this route carries no billing permission, and before #930 it shipped `stripe_customer_id` / `subscription_id` for every chapter the caller belongs to |
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
| **API only** (RLS on, no policy → default-deny; service-role bypasses) | `backwork_departments`, `backwork_professors`, `backwork_resources`, `channel_read_receipts`, `chapter_activation_milestones`, `chapter_custom_fields`, `chapter_custom_roles`, `chapter_directory`, `chapter_directory_requests`, `chapter_document_folders`, `chapter_documents`, `chapter_dues_config`, `chapter_service_config`, `chapter_workflows`, `chapters`, `chat_channel_categories`, `chat_channels`, `event_attendance`†, `events`†, `financial_invoices`, `financial_transactions`, `invites`, `member_custom_field_values`\*, `members`\*, `message_reactions`, `notification_preferences`, `notifications`†, `point_transactions`, `poll_votes`, `push_tokens`, `roles`, `scheduled_notification_dispatches`, `semester_archives`, `service_entries`, `stripe_webhook_events`, `study_geofences`, `study_sessions`, `tasks`, `user_settings`, `users`\* | 40 |
| **RLS enforces** (read directly by a user-JWT client) | `chat_message_actions`, `chat_messages` | 2 |
| **RLS enforces** (policy present, defense-in-depth) | `chat_notification_preferences` | 1 |

\* carries a non-widening policy — see the notes below.

† emits a **contentless change ping** over private Realtime broadcast (`notif:<user_id>`,
`events:<chapter_id>`, `attendance:<event_id>`) so the web dashboard can invalidate its caches.
The ping carries `{table, op}` and **no row data**, and the table itself stays default-deny — the
refetch it triggers goes back through the API, which remains the enforcing layer. This is
deliberately *not* a `postgres_changes` subscription: Realtime evaluates the same policy PostgREST
does, so publishing these three would have opened them to direct browser reads and moved the
enforcing layer out of the API. Topics are authorised by `realtime_messages_scoped_select` on
`realtime.messages` (§ "The policies that do exist").

### The policies that do exist (11 statements)

**Counting convention.** `11` counts individual policy *statements* — rows in `pg_policies` — not
rows in the table below, several of which name two policies each. That ambiguity is what let the
number drift unnoticed before, so it is now stated rather than derived.

Reconciled against hosted `frapp-staging` on 2026-08-27
(`select schemaname, count(*) from pg_policies group by schemaname`):
**10 in `public` + 1 in `realtime` = 11.** The table below is correct.

The PGlite CI substrate sees **8**, and all three absences are role- or schema-gated rather than
drift: `auth_admin_can_read_users` and `auth_admin_can_read_members` are created only inside
`if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin')`
(`20260802120000_active_chapter_jwt_claim.sql:137`), and `realtime.messages` needs a `realtime`
schema PGlite does not have. `scripts/check-pglite-migrations.mjs` pins the `public` set **by name and command**, so adding or
dropping one of those 8 — or flipping one from `SELECT` to `ALL` — fails CI. Because a name-and-command
set still cannot see a policy *rewritten in place*, it additionally rejects any permissive policy whose
qualifier is a bare tautology — checking **both `qual` and `with_check`**. Reading only `qual` would
miss the write path entirely: a `FOR INSERT` policy such as `chat_message_actions_insert` has a NULL
`qual` and carries its whole predicate in `with_check`, and on a `FOR ALL` policy it is `with_check`
that gates writes. So `using (auth.role() = 'service_role') with check (true)` — name, command and
qualifier all unchanged — would otherwise have passed clean while letting any client insert arbitrary
rows. That matters most for `member_custom_field_values_service_role`, which is `FOR ALL` and, like
`chat_notification_preferences_select_own`, has no other coverage anywhere in the repo.

This is a tripwire for the obvious rewrite, not a proof: it catches the literal spellings
(`true`, `(true)`, `1=1`), and an adversarial `using (id = id)` would still pass.

Note the limit of the guard: the three policies PGlite cannot see are **not** covered, so dropping
`auth_admin_can_read_users`, `auth_admin_can_read_members`, or `realtime_messages_scoped_select`
would leave the inventory printing its clean `(8 here, 11 hosted)` — and the `11` is derived from
the pinned list plus those three, so it would then be reporting a hosted figure that is itself wrong. Those three stay doc-only, and changes to them have
to be caught in review.

| Table | Policy | Effect |
| --- | --- | --- |
| `chat_message_actions` | `_select` | `auth.role() = 'authenticated' AND can_read_chat_message(message_id)` — per-row channel-membership check via a `SECURITY DEFINER` function mirroring `canAccessChannel`. RLS is the only gate here: the web reads it directly (`packages/chat-core/src/realtime-manager.ts`, 2 call sites) |
| `chat_messages` | `_select` | `auth.role() = 'authenticated' AND can_read_chat_message(id) AND kind <> 'imported'` — the same predicate applied to the message row itself, plus the imported-archive exclusion. Introduced by `20260816140000_realtime_carrier_repair.sql` so the chat `postgres_changes` subscription can receive rows, then **superseded by `20260823123000_chat_imported_kind_semantics.sql`**, which added the third conjunct: Realtime evaluates this policy per subscriber, so it is what stops a bulk archive import fanning a frame per row to every open client. RLS is the only gate, as above |
| `realtime.messages` | `realtime_messages_scoped_select` | Authorises the three private change-ping topics by prefix (`notif:` / `events:` / `attendance:`), each behind a `SECURITY DEFINER` scope predicate (own user, chapter membership, event's chapter membership). Purely additive: `realtime.messages` had RLS on with **no** policy, which denied every private channel. Chat's typing/presence channels are *public* and bypass this table entirely |
| `chat_message_actions` | `_insert`, `_delete` | `user_id in (select id from users where supabase_auth_id = auth.uid())` — own rows only |
| `chat_notification_preferences` | `_select_own` | Own rows only |
| `chapter_audit_log` | `_no_update`, `_no_delete` | `using (false)` — append-only, tightens rather than widens |
| `member_custom_field_values` | `_service_role` | `auth.role() = 'service_role'` — explicit rather than implicit; no non-service access |
| `users`, `members` | `auth_admin_can_read_*` | `to supabase_auth_admin` only — lets the custom-access-token hook read the `active_chapter_id` claim. Not reachable by `anon`/`authenticated` |

#### `SECURITY DEFINER` predicates must pin `pg_temp` last

Every function in the table above runs `SECURITY DEFINER`, so it evaluates with the definer's
privileges rather than the caller's. That makes its `search_path` part of the authorization
boundary, not a style detail.

Postgres searches the temporary schema **first** for unqualified relation names unless `pg_temp` is
itself listed. A predicate declared `set search_path = public` therefore reads a caller-created temp
table in place of the real one — so `create temp table chat_messages (...)` could answer
`can_read_chat_message` instead of the actual row. Every such function must be declared:

```sql
set search_path = public, pg_temp
```

`pg_temp` **last** is the whole mechanism: naming it explicitly moves the temp schema to the end of
resolution order instead of its implicit position at the front. `search_path = pg_temp, public` is
not a partial fix — it is the original defect spelled out.

This is enforced, not conventional: `scripts/check-pglite-migrations.mjs` applies every migration and
fails the `pglite-migrations` job if any `SECURITY DEFINER` function in `public` does not pin
`pg_temp` last. Fixed repo-wide in #985 (#983 fixed the first instance).

### The `chat_messages` read surface — accepted, with the bound named

`chat_messages` is the largest table in the schema, and since
`20260816140000_realtime_carrier_repair.sql` it is readable directly by an `authenticated` client so
the chat `postgres_changes` subscription can receive rows. Its policy calls
`can_read_chat_message(id)`, which is `SECURITY DEFINER` and therefore **can never be inlined**: the
planner calls it once per candidate row, and each call joins
`chat_messages` / `chat_channels` / `users` / `members`.

A filter matching nothing is the worst case, because no `LIMIT` short-circuits it:

```
GET /rest/v1/chat_messages?content=ilike.*zzzz*
```

The two things that bound this *through the API* — `assertChannelAccess` narrowing to a single
`channel_id`, and `DEFAULT_MESSAGE_LIMIT` — do not apply to a direct PostgREST read.

**This cost is accepted rather than mitigated, and the bound of record is the per-role
`statement_timeout`: `authenticated = 8s`, `anon = 3s`** (read from hosted `frapp-staging`,
2026-08-27). The two alternatives were considered and rejected on the merits:

- **An index does not help.** The planner cannot use one to avoid a non-inlinable `SECURITY DEFINER`
  call — that call *is* the cost.
- **Narrowing the policy is ruled out** by what Realtime needs: the row has to stay readable by the
  subscriber, which is the entire point of #974.

> ⚠️ The bound is a **Supabase platform default this repo does not set or pin.** `statement_timeout`
> appears nowhere under `supabase/`, so raising it from the dashboard would weaken this mitigation
> with no diff, no failing check, and no signal in the repo. Tracked as
> [#1291](https://github.com/pdcarlson/Frapp/issues/1291).

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

### 5.1 `chapters/:id/config` ignores its own path parameter — resolved (#866)

`GET|PATCH /v1/chapters/:id/config` and `POST /v1/chapters/:id/theme-palette` previously bound the
path segment as `_id` and operated on the guard-resolved chapter instead, without ever checking the
two agreed — so **another chapter's id returned 200 with your own chapter's config** rather than
`403`. No data ever crossed a tenant boundary, but the URL asserted something the handler didn't
honour, which is exactly the shape a later refactor could misread into a real hole (e.g. wiring the
unused param through "to fix the lint warning").

Fixed by keeping the `:id` URL shape (the route rename to `chapters/current/config` was the
alternative, but that's a breaking public-API change outside this fix's scope) and adding
`assertMatchesActiveChapter(id, chapterId)` to all three handlers: a disagreement now throws
`403 chapter.context.mismatch` — the same code `ChapterGuard` uses for a JWT/header disagreement —
before the service is ever called (`chapter-config.controller.ts`). Regression coverage in
`apps/api/test/cross-tenant-isolation.e2e-spec.ts` (`chapter config: URL id vs active chapter`).

### 5.2 The Realtime carrier was never connected — resolved 2026-08-16 (#867)

This section previously recorded that `chat_messages` is default-deny, so its `postgres_changes`
subscription could not receive rows, and asked which path actually carried new messages. The answer
turned out to sit one layer lower, and to be worse.

Read-only against **both** deployed projects on 2026-08-16: the `supabase_realtime` publication
contained **no tables at all** (`puballtables = false`, zero rows) on `frapp-prod` *and*
`frapp-staging`, and `ALTER PUBLICATION` appeared in zero migrations repo-wide. A table absent from
the publication never reaches Realtime through the WAL, so **no RLS policy could have rescued it**:
every `postgres_changes` subscription in the product had been receiving nothing, in every
environment, since the first deploy. Nothing carried new messages — `broadcast` was in use for
typing indicators only, and the 5s REST poll arms only after a channel has been non-live for >10s,
which never happened because the channel *joins* perfectly well and simply never fires.

It still failed safe (nothing ever leaked), which is why it survived so long: the failure mode is a
subscription that reports `SUBSCRIBED` and stays silent, indistinguishable from an idle one.

Fixed by `20260816140000_realtime_carrier_repair.sql`, which deliberately treats the two classes of
subscriber differently — see the `†` note under "Enforcing layer per table". Chat consumes the
changed row, so it gets real replication plus the row-level policy #867 pre-authorised; the three
dashboard subscriptions consume nothing but the fact of a change, so they get a contentless private
broadcast and their tables stay API-enforced. The topic strings are a cross-substrate contract
between that migration and `apps/web/lib/realtime/change-topics.ts`, pinned by
`change-topics.test.ts` precisely because drift between them is silent.

---

## 6. Regression coverage

`apps/api/test/cross-tenant-isolation.e2e-spec.ts` drives the **real** `ChapterGuard` and the **real**
service-layer checks against a table-aware in-memory Supabase fake seeded with two chapters. It
asserts that a member of chapter B is rejected when they:

- send chapter A's `x-chapter-id` (no membership) → `403 chapter.context.invalid`
- send an `x-chapter-id` that disagrees with their JWT claim → `403 chapter.context.mismatch`
- request chapter A's member, task, event, or invoice by raw id → `403` / `404`
- edit chapter A's role, or revoke chapter A's invite → `403` / `404`
- read or write notification preferences for chapter A → `403`

It also carries **positive controls** — chapter B's own task, event, and invoice each return `200` —
so a fake that simply failed every lookup could not make the suite pass vacuously. Note that
`GET /tasks/:id` and `GET /invoices/:id` layer a per-row ACL (assignee / own-invoice, else a
managing permission) *on top of* chapter scoping, so their fixtures are owned by the caller.

The rest of the e2e suite stubs `ChapterGuard`; this spec must not, or it tests nothing.

### RLS enforcement (`scripts/check-pglite-migrations.mjs`)

The two tables where **RLS is the only gate** are covered black-box, by reading them as an
unprivileged `rls_probe` role rather than by pattern-matching the policy expression:

| Table | Coverage |
| --- | --- |
| `chat_message_actions` | membership/tenancy matrix (read path) |
| `chat_messages` | membership/tenancy matrix (#977) + the imported-archive exclusion (#974) + a post-archive tenancy re-check (#977) |

`rls_probe` is granted `SELECT` only, so this tier proves the **read** path by execution. The
own-row `INSERT`/`DELETE` policies on `chat_message_actions` are covered by shape assertions over
`polqual` / `polwithcheck`, not by attempting a write as a non-owner — a policy whose `with check`
still mentions `user_id` and `auth.uid()` without restricting them would pass. That gap is real and
is not claimed to be closed here.

Each reader's **exact visible set** is asserted, not a row count — a total is satisfied by the right
*number* of wrong rows, so a policy swapping one PRIVATE row for one cross-chapter row would keep a
count green. Two details carry most of the weight:

- **The cross-chapter reader has a positive control.** It is a real member of chapter B and is
  asserted to see chapter B's own `PUBLIC` message *and* none of chapter A's six. Without that
  half, "sees zero rows of chapter A" is satisfied equally well by a UUID belonging to nobody, and
  the tenant boundary is never actually exercised.
- **The matrix includes a `*` wildcard holder**, pinning permission and membership as independent
  axes: the wildcard opens both `ROLE_GATED` channels and must still not open a DM.

The membership matrix deliberately runs while the table holds only its own fixtures, which keeps its
expectations readable but means no assertion in it can see a policy that special-cases *imported*
rows. So the two readers that must see nothing of another tenant are re-checked after the archive
row is inserted. That gap was reachable: a policy of the form

```sql
using ((auth.role() = 'authenticated' and kind <> 'imported' and can_read_chat_message(id))
       or (auth.uid() is null and kind = 'imported'))
```

hands every archived message in every chapter to an unauthenticated client while satisfying all
three shape regexes and every membership expectation. Verified 2026-08-27: with that policy applied,
the shape assertion, the policy inventory, and all five membership assertions still report `OK`, and
the **only** failure in the whole suite is the null-uid post-archive re-check.

Why black-box rather than a shape assertion: the smoke-tier check on the policy *expression* is
substring-shaped and defeatable by construction. It tests three substrings —
`can_read_chat_message(id)`, `authenticated`, and `kind <> 'imported'` — so a defeating rewrite has
to keep all three and only needs to neuter the one that does the work:

```sql
using (
  auth.role() = 'authenticated'
  and (public.can_read_chat_message(id) or true)   -- neutered, still matches the regex
  and kind <> 'imported'
)
```

That satisfies **all three** substring checks *and* the single-policy inventory, while making every
message in every chapter's private channels and DMs readable by any authenticated caller.

Verified 2026-08-27 by applying exactly that edit to
`20260823123000_chat_imported_kind_semantics.sql` locally and running the suite: the shape assertion
and the policy inventory both still reported `OK`, and the black-box tier failed 7 assertions — the
cross-chapter reader and the no-JWT reader each seeing all seven seeded messages. The migration was
then reverted.
