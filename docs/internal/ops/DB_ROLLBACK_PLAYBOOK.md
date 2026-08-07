# DB Rollback Playbook

## Automated Migration Context

Migrations are now applied automatically in the deploy pipeline (see `.github/workflows/deploy-api.yml`):
- **Staging:** Runs automatically on merge to `main` (no approval needed)
- **Production:** Runs automatically after the `main` → `production` promotion PR merges and CI passes. (No GitHub Actions environment-approval pause — required-reviewer environment rules are GitHub Enterprise-only on private repos; the gate is the promotion PR itself: branch protection requires CI + an approving review + conversation resolution.)

If an automated migration fails, the entire deploy pipeline halts — no API deploy happens. Check the GitHub Actions run for the error output.

## When to trigger rollback

Trigger rollback procedures if any of the following occurs after migration promotion:

- sustained API 5xx increase tied to schema errors
- failing health checks caused by DB query errors
- webhook processing failures caused by missing/changed columns
- severe latency/regression from new indexes/queries

## Decision matrix

### 1) Fast forward-fix (preferred)

Use when:
- issue is contained and can be fixed with additive SQL,
- no data corruption occurred,
- service can stay online.

Action:
1. Create new migration: `npx supabase migration new <hotfix_name>`
2. Apply to staging first.
3. Promote to production once verified.

### 2) Full rollback to backup/snapshot

Use when:
- destructive migration caused data loss/corruption,
- service remains broken after attempted forward-fix,
- unacceptable blast radius.

Action:
1. Freeze writes (maintenance mode if needed).
2. Restore latest verified backup/snapshot in Supabase.
3. Re-deploy API once DB state is consistent.
4. Execute incident postmortem.

## Immediate response steps

1. Announce incident in engineering channel.
2. Capture failing SQL/error logs and request IDs.
3. Identify failing migration file(s) and affected tables/indexes/policies.
4. Choose recovery strategy (forward-fix vs restore) using matrix above.

## Verification after rollback/recovery

- [ ] `GET /health` reports DB connected
- [ ] critical API routes pass smoke checks
- [ ] Stripe webhook endpoint processes signed test event
- [ ] no ongoing elevated error alerts (Sentry/logs)

## Documentation requirements

After any rollback event:

- update `docs/internal/DEPLOYMENT_STATUS.md` with incident notes
- create/update postmortem entry with timeline and root cause
- add preventive checks to migration or CI workflow

## Rollback durable Stripe webhook idempotency

* **Migration**: `20260805150000_stripe_webhook_events.sql`
* **Action**: Redeploy the API at the pre-FRA-23 revision **first** — the post-FRA-23 `BillingService` claims every side-effecting event and 500s on `POST /v1/webhooks/stripe` if the table or function is gone, which makes Stripe retry the same events for days. Then `DROP FUNCTION IF EXISTS public.claim_stripe_webhook_event(text, text, integer); DROP TABLE IF EXISTS stripe_webhook_events;`.
* **Note**: Additive table + function only; nothing else references them, so dropping loses only the delivery ledger. Behaviour reverts to the in-memory `Set` — dedup within one process, and a replay after any restart re-applies the event. No backfill on re-apply; the table refills from the next deliveries.
* **Lighter option — usually the right one**: if the goal is just to unstick a specific event rather than remove the feature, do not drop anything. `update stripe_webhook_events set status = 'failed' where event_id = 'evt_…';` makes it immediately re-claimable on Stripe's next retry, and `select event_id, event_type, status, attempts, last_error from stripe_webhook_events where status <> 'processed' order by claimed_at desc;` lists everything currently stuck or failing.

## Rollback system-role `system_key`

* **Migration**: `20260806220000_role_system_key.sql`
* **Action**: dropping the column is sufficient — Postgres drops indexes involving the column automatically, including this partial one (verified under PGlite), so no `CASCADE` and no separate `DROP INDEX` are required:
  ```sql
  ALTER TABLE roles DROP COLUMN IF EXISTS system_key;
  ```
  To revert only the uniqueness guarantee while keeping the column and its values, drop the index alone instead: `DROP INDEX IF EXISTS idx_roles_chapter_system_key;`
  **Redeploy the API at the pre-FRA-320 revision first.** The post-FRA-320 code `select`s and filters on `system_key` in `RbacService.getAlumniRoleId`, `MemberService.findAlumniByChapter`, and `BillingService.notifyChapterPresident`, and `ChapterService.create` *inserts* it — with the column gone, chapter creation 500s outright and the three lookups error rather than degrading.
* **Note**: Additive DDL only (one nullable column + one partial unique index); no existing column, constraint, policy, or row is altered, so nothing predating the migration can be lost. Rolling back reverts every system-role lookup to name matching, which **re-opens the silent rename fail-open this migration closed** (FRA-320): renaming the Alumni role again disables study-hour, event-check-in, and chat-posting restrictions chapter-wide with no error and no log line. Prefer a roll-forward fix.
* **Data caveat**: the column holds derived identity, not user data — on re-apply the migration's backfill reconstructs it from each system role's current name, so no snapshot is needed. The one thing that does *not* survive a drop/re-apply cycle: a chapter that renamed a system role **while the column existed** kept a correct key through the rename, but the re-apply backfill matches on the *current* name and will leave that role with a null key. Those chapters silently return to the fail-open path. If any chapter has renamed a system role since this migration landed, snapshot `select id, chapter_id, name, system_key from roles where system_key is not null` before dropping and restore it after re-applying.

## Rollback scheduled notification dispatches

* **Migration**: `20260805140000_scheduled_notification_dispatches.sql`
* **Action**: the migration creates one table **and three indexes on pre-existing tables**, which do *not* drop with it:
  ```sql
  DROP TABLE IF EXISTS scheduled_notification_dispatches; -- its own index drops with it
  DROP INDEX IF EXISTS idx_events_end_time;
  DROP INDEX IF EXISTS idx_financial_invoices_status_due_date;
  DROP INDEX IF EXISTS idx_tasks_status_due_date;
  ```
  The three indexes are safe to keep — they are pure read optimizations for the sweep queries and nothing depends on their existence. Drop them only if you are fully reverting the migration.
* **⚠️ Note**: Additive DDL only — no existing table's data is touched, so nothing that predates the migration can be lost. But **redeploy the API at the pre-FRA-24 revision first**, or disable the sweeps. `ScheduledJobsService` claims a row before *every* unit of work, and `ScheduledJobsRepository` treats an unexpected insert error as "not claimed", so with the table gone **all three sweeps silently stop doing anything** — reminders send nothing, and attendance auto-absent stops marking. They fail safe (no crash, no double-send) but they also fail *quietly*: the only signal is a `dispatch claim failed` line per item. Auto-absent is not exempt — it claims under `entity_type = 'EVENT'` so it runs once per event instead of once per replica per hour.
* **Data caveat**: the rows are delivery bookkeeping — which reminder has already gone out for which invoice/task. Dropping the table erases that memory, so **re-applying the migration and re-enabling the sweeps re-sends every reminder still inside the 7-day `OVERDUE_LOOKBACK_DAYS` window** (and any invoice/task due the next day). Members see duplicates for anything in that window; older items stay silent because the lookback bound excludes them. If that matters, snapshot the table before dropping and restore it alongside the re-apply.

## Rollback custom-role member assignment

* **Migration**: `20260804230000_member_custom_role_ids.sql`
* **Action**: `ALTER TABLE members DROP COLUMN IF EXISTS custom_role_ids;` — but redeploy the API at the pre-FRA-229 revision **first**: the post-FRA-229 `ChapterGuard` `select`s the column on every request and errors if it is gone.
* **Note**: Purely additive (`uuid[] not null default '{}'`). Dropping it loses only which members hold which `chapter_custom_roles` — the roles themselves, their capabilities, and all live-role assignments are untouched, and enforcement falls back to exactly the pre-bridge behavior (custom roles present but presentation-only). No backfill is needed on re-apply; assignments would have to be redone by hand.

## Rollback the generated-reports bucket

* **Migration**: `20260805133000_reports_bucket.sql`
* **Action**: Nothing schema-side is usually needed — the row is pure additive config. If the bucket must actually go: first redeploy the API at the pre-FRA-19 revision (otherwise `POST /v1/reports/*?format=pdf` 500s on upload; `format=json` and `format=csv` are unaffected and keep working either way), then empty and remove the bucket **through the Storage API, never raw SQL** — `supabase.storage.emptyBucket('reports')` then `supabase.storage.deleteBucket('reports')` (dashboard: Storage → reports → Empty bucket → Delete). Deleting `storage.objects` rows with SQL removes only metadata and strands the file bytes in the backing store with nothing left to find them by.
* **Note**: Report PDFs are disposable derived artifacts — every one can be regenerated from live data, and nothing in the database references them, so deleting them loses no chapter data. Any signed URL already handed out keeps working until its hour is up or the object is removed, whichever comes first. To only loosen the constraints instead, `update storage.buckets set allowed_mime_types = null, file_size_limit = null where id = 'reports';` — no deploy required. There is no scheduled cleanup of old exports yet — tracked in FRA-338.

## Rollback the service-proof bucket

* **Migration**: `20260803231500_service_proof_bucket.sql`
* **Action**: Nothing schema-side is usually needed — the row is pure additive config. If the bucket must actually go: first redeploy the API at the pre-FRA-49 revision (otherwise `POST /v1/service-entries/proof-upload-url` 500s), then empty and remove the bucket **through the Storage API, never raw SQL** — `supabase.storage.emptyBucket('service')` then `supabase.storage.deleteBucket('service')` (dashboard: Storage → service → Empty bucket → Delete). Deleting `storage.objects` rows with SQL removes only metadata and strands the file bytes in the backing store with nothing left to find them by.
* **Note**: Deleting the bucket destroys every uploaded proof object; entries keep their `proof_path` strings and `GET /v1/service-entries/{id}/proof-url` returns 404 for them afterwards. To only loosen the upload constraints instead, `update storage.buckets set allowed_mime_types = null, file_size_limit = null where id = 'service';` — no deploy required.

## Rollback active-chapter JWT claim

* **Migration**: `20260802120000_active_chapter_jwt_claim.sql`
* **First action — no deploy required**: disable the hook (**Authentication → Hooks** in the Supabase dashboard, or `hook_custom_access_token_enabled: false` via the Management API). This is the instant mitigation for anything auth-related and is almost always sufficient: with the hook off, tokens are issued without the `active_chapter_id` claim and `ChapterGuard` falls back to the `x-chapter-id` header, which every client still sends. **Do this before touching the schema** — it takes effect on the next token issuance, whereas dropping the function while the hook is still pointed at it would fail token issuance outright and lock users out.
* **Then, if the schema must also go**: `DROP FUNCTION IF EXISTS public.custom_access_token_hook(jsonb);` followed by `ALTER TABLE users DROP COLUMN IF EXISTS active_chapter_id;`. Order matters — the function reads the column. Also drop the two auth-admin read policies if fully reverting: `DROP POLICY IF EXISTS "auth_admin_can_read_users" ON public.users;` and `DROP POLICY IF EXISTS "auth_admin_can_read_members" ON public.members;`.
* **Note**: Dropping the column loses each user's persisted chapter selection only; memberships are untouched, so on re-apply single-chapter users auto-resolve again immediately and multi-chapter users re-select. The post-FRA-303 API tolerates the claim being absent by design, so **no API rollback is needed** — that is the whole point of the header fallback. The API only breaks if `users.active_chapter_id` is dropped while the activate endpoint is still deployed, so redeploy the pre-FRA-303 revision before dropping the column.

## Rollback past_due grace clock

* **Migration**: `20260602120000_chapter_past_due_since.sql`
* **Action**: `ALTER TABLE chapters DROP COLUMN IF EXISTS past_due_since;`
* **Note**: The column only feeds `ChapterGuard`'s 3-day `past_due` grace window. Dropping it reverts to the prior behavior where any `past_due` write is hard-blocked immediately (no grace) — strictly more restrictive, so it is safe and causes no data loss beyond the per-chapter grace timestamps. After dropping, redeploy the API at the pre-FRA-109 revision (the post-FRA-109 guard `select`s the column and will error if it is gone). No data backfill needed on re-apply; the migration re-stamps existing `past_due` rows.

## Rollback Stripe webhook ordering mark

* **Migration**: `20260604121000_chapter_last_stripe_webhook_at.sql` (renamed from `20260604120000_…` to resolve a version collision — FRA-288)
* **Action**: `ALTER TABLE chapters DROP COLUMN IF EXISTS last_stripe_webhook_at;`
* **Note**: Additive nullable column only — it records the `event.created` of the most recently applied Stripe subscription webhook so `BillingService` can drop out-of-order/retried deliveries (FRA-242, `spec/behavior/billing.md`). Dropping it reverts to last-writer-wins, where a delayed webhook can overwrite a newer status — strictly less safe but no data loss. The post-FRA-242 `BillingService` both `select`s and writes this column, so a forward-fix (redeploy the pre-FRA-242 API revision) is required before dropping it. No backfill on re-apply; the next webhook per chapter re-stamps the mark.

## Rollback Terms/Privacy acceptance columns

* **Migration**: `20260604130000_chapter_legal_acceptance.sql`
* **Action**: `ALTER TABLE chapters DROP COLUMN IF EXISTS legal_accepted_at, DROP COLUMN IF EXISTS legal_policy_version, DROP COLUMN IF EXISTS legal_accepted_by;`
* **Note**: Additive nullable columns recording the chapter admin's Terms/Privacy acceptance at onboarding (FRA-17, `spec/behavior/legal.md`). The post-FRA-17 `ChapterOnboardingService` **writes** these on chapter creation, so redeploy the pre-FRA-17 API revision (which omits them) before dropping, or new-chapter onboarding inserts will fail on the missing columns. Reads use `select('*')` and tolerate their absence. Dropping loses the per-chapter acceptance audit (timestamp, policy version, accepting user) but no operational data; no backfill on re-apply (legacy rows stay `NULL`).

## Rollback Chunk 09 member custom-field values

* **Migration**: `20260531120000_member_custom_field_values.sql`
* **Action**: Run `DROP TABLE IF EXISTS member_custom_field_values;` (its indexes, composite foreign keys, and the `updated_at` trigger drop automatically with the table). To fully revert the migration, also drop the helper unique constraints it added to the parent tables (safe to keep — they are redundant supersets of each table's primary key):
  ```sql
  ALTER TABLE members DROP CONSTRAINT IF EXISTS members_id_chapter_id_key;
  ALTER TABLE chapter_custom_fields DROP CONSTRAINT IF EXISTS chapter_custom_fields_id_chapter_id_key;
  ```
* **Note**: The table holds per-member values for the `chapter_custom_fields` definitions, carrying a `chapter_id` enforced by composite FKs so a row can never pair a member with a field from another chapter. Dropping it loses any stored custom-field values but does not touch the definitions. There is no value-write API yet (deferred to #581), so in most environments the table is empty.

## Rollback Chunk 07d dues config alignment
* **Migration**: `20260530193000_chapter_dues_config_align_spec.sql`
* **Action (forward-fix)**: Drop the added column and restore the prior cadence CHECK/default:
  ```sql
  ALTER TABLE chapter_dues_config DROP COLUMN IF EXISTS installment_count;
  ALTER TABLE chapter_dues_config DROP CONSTRAINT IF EXISTS chapter_dues_config_cadence_check;
  ALTER TABLE chapter_dues_config
    ALTER COLUMN cadence SET DEFAULT 'semester',
    ADD CONSTRAINT chapter_dues_config_cadence_check
      CHECK (cadence IN ('semester','monthly','annual'));
  ```
* **Note**: Safe at any time — `chapter_dues_config` has no write path until the API shipped in this chunk, so the table is empty and there is no data to lose. If rows exist by rollback time, any `per_semester`/`per_quarter` value must be reconciled to the old vocabulary first or the restored CHECK will reject them.

## Rollback analytics opt-out flag
* **Migration**: `20260530180000_chapter_analytics_opt_out.sql`
* **Action**: Run `ALTER TABLE chapters DROP COLUMN IF EXISTS analytics_opt_out;`
* **Note**: Additive boolean with a default; dropping it loses only each chapter's opt-out preference. The server reads it defensively and treats a missing/false value as "analytics enabled".

## Rollback `confirm_task_completion` RPC
* **Migration**: `20260602210000_add_confirm_task_completion_rpc.sql`
* **Action**: Run `DROP FUNCTION IF EXISTS confirm_task_completion(uuid, uuid);`
* **Note**: Additive function only — dropping it removes the atomic confirm path but loses no data. The API calls it from `SupabaseTaskRepository.confirmCompletionAtomic`, so a forward-fix (rather than a bare drop) is required to keep task confirmation working: deploy an API revision that reverts to the prior two-write path before dropping the function.

## Rollback `approve_service_entry` RPC
* **Migration**: `20260603120000_add_approve_service_entry_rpc.sql`
* **Action**: Run `DROP FUNCTION IF EXISTS approve_service_entry(uuid, uuid, uuid, text, integer);`
* **Note**: Additive function only — dropping it removes the atomic service-hour approval path but loses no data. The API calls it from `SupabaseServiceEntryRepository.approveAtomic`, so a forward-fix (rather than a bare drop) is required to keep service-hour approval working: deploy an API revision that reverts to the prior two-write path (point insert + entry update) before dropping the function.

## Rollback `check_in_event` RPC
* **Migration**: `20260603140000_add_check_in_event_rpc.sql`
* **Action**: Run `DROP FUNCTION IF EXISTS check_in_event(uuid, uuid, uuid, timestamptz, integer, text);`
* **Note**: Additive function only — dropping it removes the atomic event check-in path but loses no data. The API calls it from `SupabaseAttendanceRepository.checkInAtomic`, so a forward-fix (rather than a bare drop) is required to keep event check-in working: deploy an API revision that reverts to the prior two-write path (attendance insert + point insert) before dropping the function.

## Rollback `transfer_presidency` RPC
* **Migration**: `20260604120000_add_transfer_presidency_rpc.sql`
* **Action**: Run `DROP FUNCTION IF EXISTS transfer_presidency(uuid, uuid, uuid, text);`
* **Note**: Additive function only — dropping it removes the atomic presidency-transfer path but loses no data. The API calls it from `SupabaseMemberRepository.transferPresidencyAtomic`, so a forward-fix (rather than a bare drop) is required to keep presidency transfer working: deploy an API revision that reverts to the prior two-write path (remove the wildcard role from the current President, add it to the target) before dropping the function.

## Rollback `get_points_report` RPC
* **Migration**: `20260604140000_get_points_report_window_filter.sql` (supersedes `20250226120000_add_get_points_report_rpc.sql`)
* **Action**: Run `DROP FUNCTION IF EXISTS get_points_report(uuid, uuid, timestamptz);`
* **Note**: Additive/no data loss — the migration drops the old `(uuid, uuid, text)` overload and recreates the RPC with a `p_since timestamptz` window filter (FRA-31). The API calls the new overload from `ReportService.getPointsReport`, so a forward-fix (rather than a bare drop) is required to keep the points report working: deploy an API revision that reverts to the prior all-time call and re-creates the original `(uuid, uuid, text)` body before dropping the `timestamptz` overload.

## Rollback `chat_message_actions` membership-scoped read RLS
* **Migration**: `20260803150000_chat_message_actions_membership_rls.sql`
* **Action (forward-fix — restore the prior policy first, then drop the helper)**:
  ```sql
  DROP POLICY IF EXISTS "chat_message_actions_select" ON public.chat_message_actions;
  CREATE POLICY "chat_message_actions_select"
    ON public.chat_message_actions FOR SELECT
    USING (auth.role() = 'authenticated');
  DROP FUNCTION IF EXISTS public.can_read_chat_message(uuid);
  ```
* **⚠️ Note**: Rolling back **re-opens the cross-chapter / private-DM / role-gated action-read leak this migration closed** (FRA-38 / #279) — any authenticated user could again read every `chat_message_actions` row via the web client's direct query and the global Realtime subscription, so **prefer a roll-forward fix over this rollback**. No data is lost (policy + function only). Drop order matters: the `SELECT` policy references `can_read_chat_message(...)`, so the policy must be dropped/recreated **before** the function. No app-code change is required either way — the web reaction backfill and Realtime subscription work under either policy; the restored policy is simply permissive again.
* **Replica identity**: nothing to revert. The migration deliberately leaves `chat_message_actions` at the default replica identity — see the rationale in the migration header and `docs/internal/security/SECURITY_FIXES.md`. If you find the table set to `FULL`, that is drift, not this migration.

## Rollback poll list vote aggregate RPCs
* **Migration**: `20260417180000_add_poll_list_vote_aggregate_rpcs.sql`
* **Action**: Run `DROP FUNCTION IF EXISTS get_poll_vote_option_totals(uuid[]);` and `DROP FUNCTION IF EXISTS get_poll_user_votes_for_messages(uuid[], uuid);`

## Rollback `idx_point_transactions_chapter_created_at`
* **Migration**: `20260417120000_point_transactions_chapter_created_at_idx.sql`
* **Action**: `DROP INDEX IF EXISTS idx_point_transactions_chapter_created_at;`
* **Note**: Safe additive change only; dropping removes the performance optimization for chapter-scoped transaction lists. Same-day data backfills on `public.roles` are separate migrations — see the next two sections (`20260417140000`, `20260417150000`).

## Rollback `backfill_polls_view_all_system_roles`
* **Migration**: `20260417140000_backfill_polls_view_all_system_roles.sql`
* **Action (best-effort):** Remove appended permission and inserted roles (VP/Secretary may include `members:view` and `polls:view_all`), then restore `display_order` for system roles that were shifted by +2:
  1. `delete from public.roles where name in ('Vice President', 'Secretary') and is_system = true;`
  2. `update public.roles set permissions = array_remove(permissions, 'polls:view_all') where is_system = true and name = 'Treasurer' and not ('*' = any (permissions));`
  3. For each chapter that no longer has a Vice President row, decrement `display_order` by 2 on system roles with `display_order >= 5` (Member and below in the default ordering). Prefer restoring from a snapshot if unsure.
* **Note:** This migration is data-only; rollback is manual because removing `polls:view_all` from Treasurer may have been intentional pre-migration state.

## Rollback `backfill_members_view_vp_secretary`
* **Migration**: `20260417150000_backfill_members_view_vp_secretary.sql`
* **Action (best-effort):** `update public.roles set permissions = array_remove(permissions, 'members:view') where is_system = true and name in ('Vice President', 'Secretary');`
* **Note:** Only use if no chapter intentionally granted `members:view` solely through these roles and depends on it; prefer snapshot restore when unsure.

## Rollback Chunk 05 migration (20260527120000_chat_notification_preferences.sql)

Migration is additive (one new table with its own indexes, policy, and trigger). Rollback is safe at any time; the only data loss is per-user preference rows. The push worker tolerates an empty table (it falls back to channel-name defaults in `apps/api/src/modules/chat-push-worker/push-rules.ts`), so dropping the table degrades preferences gracefully without breaking fanout.

```sql
-- The trigger and indexes drop automatically with the table.
DROP TABLE IF EXISTS chat_notification_preferences;
```

**Note:** No NestJS worker change is required after rollback — the push worker's preference repository tolerates an empty result set and treats it as "no preference set," which falls back to the defaults table in [`spec/behavior/notifications.md`](../../../spec/behavior/notifications.md).

## Rollback Chunk 03 migration (20260524120000_chapter_directory_requests.sql)

Migration is additive (new table + one seeded row). Rollback is safe to run at any time without data-loss risk beyond losing directory-request submissions.

```sql
-- 1. Drop chapter_directory_requests (indexes drop automatically with table)
DROP TABLE IF EXISTS chapter_directory_requests;

-- 2. Remove the system user seed (only if it was inserted by this migration
--    and no chat_messages rows reference it; if they do, delete those first
--    or leave this row in place to keep historical system messages intact).
-- DELETE FROM public.users WHERE id = '00000000-0000-0000-0000-000000000000';
```

**Note:** The `DELETE` for the system user is commented out intentionally — if any `chat_messages` rows have `sender_id = '00000000-…'`, removing the user violates the FK. Prefer leaving the system user in place and only dropping the `chapter_directory_requests` table unless you are certain no system messages were written.

## Rollback Chunk 02 migrations (20260523*)

All four migrations are additive. Rollback drops the new structures in reverse order.

```sql
-- 1. chat hot-path (20260523150000)
DROP TABLE IF EXISTS chat_message_actions;
DROP INDEX IF EXISTS idx_chat_messages_dedupe;
DROP INDEX IF EXISTS idx_chat_messages_channel_created;
ALTER TABLE chat_messages
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS payload,
  DROP COLUMN IF EXISTS client_message_id,
  DROP COLUMN IF EXISTS deleted_at;

-- 2. chapter directory (20260523140000)
ALTER TABLE chapters DROP CONSTRAINT IF EXISTS fk_chapters_directory;
DROP TABLE IF EXISTS chapter_directory;

-- 3. audit log (20260523130000)
DROP TABLE IF EXISTS chapter_audit_log;

-- 4. chapter customization (20260523120000)
DROP TABLE IF EXISTS chapter_dues_config;
DROP TABLE IF EXISTS chapter_workflows;
DROP TABLE IF EXISTS chapter_custom_roles;
DROP TABLE IF EXISTS chapter_custom_fields;
ALTER TABLE chapters
  DROP COLUMN IF EXISTS org_archetype,
  DROP COLUMN IF EXISTS enabled_modules,
  DROP COLUMN IF EXISTS vocabulary,
  DROP COLUMN IF EXISTS branding,
  DROP COLUMN IF EXISTS theme_palette,
  DROP COLUMN IF EXISTS directory_id,
  DROP COLUMN IF EXISTS beta_config;
```

**Note:** Rolling back drops both new tables *and* the new columns added to `chapters` and `chat_messages`. Any data stored in those columns (`org_archetype`, `enabled_modules`, `vocabulary`, `branding`, `theme_palette`, `directory_id`, `beta_config`, `kind`, `payload`, `client_message_id`, `deleted_at`) will be permanently lost, in addition to all rows inserted into the new tables.

## Rollback the invoice payment RPC + indexes (20260803120000)

Additive: one function and two partial unique indexes (FRA-15). No columns or
rows are created, so rollback loses nothing that existed before the migration.

```sql
DROP FUNCTION IF EXISTS apply_invoice_payment(uuid, uuid, text, text);
DROP INDEX IF EXISTS idx_financial_transactions_payment_charge;
DROP INDEX IF EXISTS idx_financial_invoices_payment_intent;
```

**Order matters only for the function**: drop it before deploying an API build
that predates FRA-15, since the old build never calls it. Do **not** drop it
while the current API is serving — `FinancialInvoiceService.applyStripePaymentSuccess`
(webhook path) and `transitionStatus` → PAID (admin path) both call it, and a
missing function surfaces as a 500 on the Stripe webhook, which Stripe then
retries for up to ~72h.

**Data caveat:** the values the migration lets the app write —
`financial_invoices.stripe_payment_intent_id` and
`financial_transactions.stripe_charge_id` — are *not* removed by this rollback
and stay valid; only the uniqueness guarantee goes away. If you later re-apply
the migration, the `CREATE UNIQUE INDEX` statements will fail if duplicate
non-null ids accumulated while the indexes were absent. Check first:

```sql
SELECT stripe_payment_intent_id, count(*) FROM financial_invoices
 WHERE stripe_payment_intent_id IS NOT NULL
 GROUP BY 1 HAVING count(*) > 1;

SELECT stripe_charge_id, count(*) FROM financial_transactions
 WHERE stripe_charge_id IS NOT NULL AND type = 'PAYMENT'
 GROUP BY 1 HAVING count(*) > 1;
```

Resolve any duplicates (they indicate a double-recorded payment worth
reconciling in Stripe regardless) before re-applying.

## Rollback account deletion (20260803140000)

Additive DDL: one nullable column and one function (FRA-40). Rolling the
*schema* back loses nothing that existed before the migration:

```sql
DROP FUNCTION IF EXISTS anonymize_user(uuid, boolean);
DROP FUNCTION IF EXISTS anonymize_card_content(text, text);
ALTER TABLE users DROP COLUMN IF EXISTS deleted_at;
```

**Order matters for the function**: drop it only alongside (or after) deploying
an API build without FRA-40 — `AccountDeletionService.deleteAccount` calls it on
`DELETE /v1/users/me`, and a missing function surfaces as a 500 on every
account-deletion request while the current build is serving.

**Data caveat — anonymization itself is irreversible by design.** Rows already
processed by `anonymize_user` stay tombstoned after rollback: PII columns are
overwritten (not recoverable), current-state rows (memberships, settings, push
tokens, notifications, read receipts, study sessions) are deleted, and the
Supabase Auth account is removed by the API flow. `spec/behavior/data-retention.md`
documents deletion as irreversible, so this is the contract, not collateral —
there is nothing to restore. Dropping `deleted_at` also drops the tombstone
*marker*; if the migration is later re-applied, previously deleted users show
`deleted_at = null` while keeping their scrubbed "Deleted User" fields. That is
safe: the function re-runs its full scrub on every call by design (no tombstone
early-return), so re-running it on such a row simply re-stamps the marker.
