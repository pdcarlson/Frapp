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

## Rollback past_due grace clock

* **Migration**: `20260602120000_chapter_past_due_since.sql`
* **Action**: `ALTER TABLE chapters DROP COLUMN IF EXISTS past_due_since;`
* **Note**: The column only feeds `ChapterGuard`'s 3-day `past_due` grace window. Dropping it reverts to the prior behavior where any `past_due` write is hard-blocked immediately (no grace) — strictly more restrictive, so it is safe and causes no data loss beyond the per-chapter grace timestamps. After dropping, redeploy the API at the pre-FRA-109 revision (the post-FRA-109 guard `select`s the column and will error if it is gone). No data backfill needed on re-apply; the migration re-stamps existing `past_due` rows.

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

## Rollback `get_points_report` RPC
* **Migration**: `20250226120000_add_get_points_report_rpc.sql`
* **Action**: Run `DROP FUNCTION IF EXISTS get_points_report(uuid, uuid, text);`

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
