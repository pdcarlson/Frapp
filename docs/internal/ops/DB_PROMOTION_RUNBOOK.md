# DB Promotion Runbook (local → staging → production)

## Purpose

Use this runbook whenever `supabase/migrations/**` changes need to be promoted.

## Promotion order (never skip)

1. **Local** (`npx supabase db push --local`)
2. **Staging** (`main` branch / staging Supabase project)
3. **Production** (`production` branch / production Supabase project)

## Preflight checklist

- [ ] Migration filenames pass `npm run check:migration-safety`
- [ ] PR includes migration SQL + rollback plan (`DB_ROLLBACK_PLAYBOOK.md`)
- [ ] Query/index/policy changes reviewed by at least one backend reviewer
- [ ] Production deploy window chosen; stakeholders notified
- [ ] Supabase backups/snapshots confirmed for target environment

## Local validation

```bash
npx supabase start
npx supabase db push --local
```

Then run:

```bash
npm run test -w apps/api
npm run check:api-contract
```

## Staging promotion

```bash
npx supabase db push --project-ref <STAGING_PROJECT_REF>
```

Post-apply staging checks:

- [ ] `GET /health` returns `status: ok`
- [ ] One auth-protected API route succeeds
- [ ] Stripe staging webhook endpoint (`/v1/webhooks/stripe`) accepts signed event
- [ ] No migration-related errors in Render logs

## Production promotion

```bash
npx supabase db push --project-ref <PRODUCTION_PROJECT_REF>
```

Post-apply production checks:

- [ ] `GET /health` succeeds
- [ ] Critical API smoke tests pass (auth + chapter-scoped endpoint)
- [ ] Webhook delivery in Stripe dashboard is green
- [ ] No elevated 5xx/Sentry alerts after deploy

## Promotion guardrails

- Do not apply production migrations before staging validation.
- Do not merge migration PRs without rollback instructions.
- If any post-apply check fails, stop and execute `DB_ROLLBACK_PLAYBOOK.md`.

## 2026-06-04: Add `transfer_presidency` RPC (FRA-39)
* **Migration**: `20260604120000_add_transfer_presidency_rpc.sql`
* **Purpose**: Atomic presidency transfer — removes the wildcard (`*`) President role from the current President and adds it to the target member inside one transaction, replacing the two independent `members` updates in `RbacService.transferPresidency` that could leave a chapter with zero or two Presidents on a partial failure (`spec/behavior/rbac.md` → Presidency Transfer). EXECUTE is locked to `service_role`; the API calls it via `SupabaseMemberRepository.transferPresidencyAtomic`.
* **Safety**: Additive — creates one function, no schema or data changes. `create or replace function` is idempotent; the revoke/grant block guards each Supabase role on existence so it also applies on bare Postgres / PGlite.
* **Checks**: After `db push`, `select proname from pg_proc where proname = 'transfer_presidency';` returns 1 row; `select has_function_privilege('service_role', 'transfer_presidency(uuid, uuid, uuid, text)', 'execute');` returns `true`.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback `transfer_presidency` RPC.

## 2026-06-02: past_due grace clock on `chapters` (FRA-109)

One additive migration that adds a nullable column and backfills existing `past_due` rows.

### 20260602120000_chapter_past_due_since.sql
* **Purpose**: Adds `chapters.past_due_since timestamptz` (nullable) so `ChapterGuard` can enforce the spec's 3-day `past_due` grace window (`spec/behavior/billing.md`). The Stripe webhook (`BillingService`) stamps it on the into-`past_due` transition and clears it on recovery/exit.
* **Safety**: `ADD COLUMN IF NOT EXISTS` (nullable, no default) is non-lock-heavy and backward-compatible — older API code simply ignores the column. The backfill (`update chapters set past_due_since = now() where subscription_status = 'past_due' and past_due_since is null`) only touches rows already in `past_due` and starts their grace clock at promotion time, so an existing lapsed chapter is not instantly hard-locked. Idempotent.
* **Checks**: `select column_name from information_schema.columns where table_name = 'chapters' and column_name = 'past_due_since';` — should return 1 row. `select count(*) from chapters where subscription_status = 'past_due' and past_due_since is null;` — should return 0 after apply.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback past_due grace clock.

## 2026-05-30: Chunk 07d — Dues config schema alignment (#540)

One migration that modifies an existing (but empty) table to match the spec.

### 20260530193000_chapter_dues_config_align_spec.sql
* **Purpose**: Aligns `chapter_dues_config.cadence` to the canonical spec (`spec/behavior/settings/customization.md` → Dues Tab): drops the old `cadence in ('semester','monthly','annual')` CHECK, sets the default to `per_semester`, and adds a new CHECK `cadence in ('monthly','per_semester','per_quarter')`. Also adds `installment_count int not null default 1 check (installment_count >= 1)` for the spec's installment "count".
* **Safety**: `chapter_dues_config` has had **no write path** since it was created (`20260523120000`) — no API wrote it (this chunk adds the first), onboarding never provisioned a row, and `seed.sql` doesn't touch it. So the table is empty in every environment and the new CHECK cannot be violated by an existing row; no data backfill/remap is required. The new column is `NOT NULL DEFAULT 1`, filled for any (hypothetical) existing row on add.
* **Checks**: After `db push`, `select pg_get_constraintdef(oid) from pg_constraint where conname = 'chapter_dues_config_cadence_check';` — should list `monthly`/`per_semester`/`per_quarter`. `select column_name from information_schema.columns where table_name = 'chapter_dues_config' and column_name = 'installment_count';` — should return 1 row.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback Chunk 07d dues config alignment.

## 2026-05-30: Analytics opt-out flag on `chapters` (#464)

One additive migration. Adds a single boolean column with a default — fully backward-compatible, no backfill, no lock-heavy operation (Postgres fills existing rows with the default on add).

### 20260530180000_chapter_analytics_opt_out.sql
* **Purpose**: Adds `chapters.analytics_opt_out boolean not null default false`. Read server-side by `AnalyticsService` as defense-in-depth before any server-originated analytics event is sent (pseudonymous pipeline, `spec/behavior/data-retention.md` #analytics-events-pseudonymous). The Settings toggle that writes it is tracked as #466.
* **Checks**: After `db push`, `select column_name from information_schema.columns where table_name = 'chapters' and column_name = 'analytics_opt_out';` — should return 1 row; `select analytics_opt_out from public.chapters limit 1;` — defaults to `false`.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback analytics opt-out flag.

## 2025-02-26: Add `get_points_report` RPC
* **Migration**: `20250226120000_add_get_points_report_rpc.sql`
* **Purpose**: Creates an RPC for faster points report aggregation.
* **Checks**: Verify the RPC exists using `select has_function_privilege('get_points_report(uuid, uuid, text)', 'execute');`.
* **Superseded by**: `20260604130000_get_points_report_window_filter.sql` (2026-06-04) — replaces the `text` overload with `p_since timestamptz`.

## 2026-06-04: Points report window filter (`get_points_report` → `p_since`)
* **Migration**: `20260604130000_get_points_report_window_filter.sql`
* **Purpose**: FRA-31 — drops the old `get_points_report(uuid, uuid, text)` overload and recreates it with `p_since timestamptz`, so semester/month points reports filter `point_transactions.created_at` (the API resolves the window's lower bound, matching the points leaderboard) instead of silently returning all-time totals.
* **Checks**: After `db push`, confirm the new signature exists and the old one is gone: `select has_function_privilege('get_points_report(uuid, uuid, timestamptz)', 'execute');` returns `t`, and `select to_regprocedure('get_points_report(uuid, uuid, text)') is null;` returns `t`. Rollback: `DB_ROLLBACK_PLAYBOOK.md` § Rollback `get_points_report` RPC.

## 2026-04-17: Poll list vote aggregation RPCs
* **Migration**: `20260417180000_add_poll_list_vote_aggregate_rpcs.sql`
* **Purpose**: `get_poll_vote_option_totals` and `get_poll_user_votes_for_messages` aggregate `poll_votes` in Postgres for `GET /v1/polls` (chapter poll list) instead of loading every vote row into the API.
* **Checks**: After `db push`, e.g. `select proname from pg_proc where proname in ('get_poll_vote_option_totals', 'get_poll_user_votes_for_messages');` Rollback: `DB_ROLLBACK_PLAYBOOK.md` § Rollback poll list vote aggregate RPCs.

## 2026-04-17: Point transactions chapter audit index
* **Migration**: `20260417120000_point_transactions_chapter_created_at_idx.sql`
* **Purpose**: B-tree on `(chapter_id, created_at desc)` so chapter-scoped point transaction lists (admin Audit tab, `GET /v1/points/transactions`) stay fast as tables grow.
* **Checks**: After `db push`, confirm the index exists, e.g. `select indexname from pg_indexes where tablename = 'point_transactions' and indexname = 'idx_point_transactions_chapter_created_at';`

## 2026-04-17: Backfill `polls:view_all` on system roles (Treasurer, VP, Secretary)
* **Migration**: `20260417140000_backfill_polls_view_all_system_roles.sql`
* **Purpose**: Data-only backfill so existing chapters match new seeds: Treasurer gains `polls:view_all` where missing; Vice President and Secretary system rows are inserted with `polls:view_all` and `display_order` is shifted for chapters that lacked VP.
* **Checks**: After `db push`, spot-check system roles — e.g. `select count(*) from public.roles where is_system and name = 'Treasurer' and 'polls:view_all' = any (permissions);` should equal the number of Treasurer rows; confirm VP/Secretary rows exist per chapter (`select chapter_id, name from public.roles where is_system and name in ('Vice President', 'Secretary') order by chapter_id, name limit 20;`). Rollback: `DB_ROLLBACK_PLAYBOOK.md` § Rollback `backfill_polls_view_all_system_roles`.

## 2026-04-17: Add `members:view` to VP / Secretary system roles
* **Migration**: `20260417150000_backfill_members_view_vp_secretary.sql`
* **Purpose**: Append `members:view` to Vice President and Secretary so they can use chapter-scoped routes that merge controller- and handler-level `@RequirePermissions` (e.g. dashboard poll list requires both `members:view` and `polls:view_all`).
* **Checks**: After `db push`, e.g. `select count(*) from public.roles where is_system and name in ('Vice President', 'Secretary') and 'members:view' = any (permissions);` should equal twice the number of chapters with those rows (or verify zero rows missing the permission). Rollback: `DB_ROLLBACK_PLAYBOOK.md` § Rollback `backfill_members_view_vp_secretary`.

## 2026-05-27: Chunk 05 — Chat integrations + push: chat_notification_preferences

One additive migration. Creates a new table with one RLS policy (select-own) and an `updated_at` trigger.

### 20260527120000_chat_notification_preferences.sql
* **Purpose**: Creates `chat_notification_preferences` (ADR-06) — the per-channel + per-kind notification level (`all` / `mentions` / `off`) the Chunk 05 push worker reads. Distinct from the existing `notification_preferences` table (boolean, category-keyed). Two scope arms (`scope ∈ {channel, kind}`) with a check constraint ensuring exactly one of `scope_id` / `scope_kind` is set, a unique index on `(user_id, chapter_id, scope, coalesce(scope_id::text, scope_kind))`, and a `(user_id, chapter_id)` index for the worker's hot path. RLS enabled with one policy: members may read their own rows; writes flow through the API (service role).
* **Checks**:
  - Table: `select tablename from pg_tables where tablename = 'chat_notification_preferences';` — should return 1 row.
  - Indexes: `select indexname from pg_indexes where tablename = 'chat_notification_preferences';` — should include `idx_chat_notif_prefs_unique` and `idx_chat_notif_prefs_user_chapter`.
  - RLS: `select relrowsecurity from pg_class where relname = 'chat_notification_preferences';` — should return `true`.
  - Policy: `select policyname from pg_policies where tablename = 'chat_notification_preferences';` — should return `chat_notification_preferences_select_own`.
  - Trigger: `select tgname from pg_trigger where tgrelid = 'chat_notification_preferences'::regclass and tgname = 'trg_chat_notification_preferences_updated_at';` — should return 1 row.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback Chunk 05 migration.

## 2026-05-24: Chunk 03 — Onboarding wizard: system user seed + chapter_directory_requests

One additive migration. Creates a new table and seeds one well-known row. No existing columns modified, no lock-heavy operations.

### 20260524120000_chapter_directory_requests.sql
* **Purpose**: (1) Idempotent `INSERT … ON CONFLICT DO NOTHING` seeds the all-zeros system user (`00000000-0000-0000-0000-000000000000`) required as `sender_id` for system-authored `chat_messages` rows (chapter-audit welcome message). Without this seed the Chunk 02 audit bridge silently no-ops due to the `NOT NULL FK` on `chat_messages.sender_id`. (2) Creates `chapter_directory_requests` table — captures manual-entry chapter submissions from the onboarding wizard so the curated directory seed can be backfilled later (#232). RLS enabled; no client policies (API/service-role only).
* **Checks**:
  - System user: `select id from public.users where id = '00000000-0000-0000-0000-000000000000';` — should return 1 row.
  - Table: `select tablename from pg_tables where tablename = 'chapter_directory_requests';` — should return 1 row.
  - Indexes: `select indexname from pg_indexes where tablename = 'chapter_directory_requests';` — should return `idx_chapter_directory_requests_status` and `idx_chapter_directory_requests_chapter`.
  - RLS: `select relrowsecurity from pg_class where relname = 'chapter_directory_requests';` — should return `true`.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback Chunk 03 migration.

## 2026-05-23: Chunk 02 — Chapter customization + audit log + directory + chat hot-path

Four additive migrations in this PR. All use `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE` — fully backward-compatible, no lock-heavy operations, no data backfills.

### 20260523120000_chapter_customization.sql
* **Purpose**: Adds 7 new columns to `chapters` (org_archetype, enabled_modules, vocabulary, branding, theme_palette, directory_id, beta_config) and creates `chapter_custom_fields`, `chapter_custom_roles`, `chapter_workflows`, `chapter_dues_config`. All new tables have RLS enabled (no policies — access controlled at API layer per repo convention).
* **Checks**: `select column_name from information_schema.columns where table_name = 'chapters' and column_name in ('org_archetype','enabled_modules','vocabulary','branding','theme_palette','directory_id','beta_config');` — should return 7 rows.

### 20260523130000_audit_log.sql
* **Purpose**: Creates `chapter_audit_log` append-only table. Two explicit RLS policies deny UPDATE and DELETE to enforce append-only at the DB level.
* **Checks**: `select tablename from pg_tables where tablename = 'chapter_audit_log';` + `select policyname from pg_policies where tablename = 'chapter_audit_log';` — should return 2 policies (audit_log_no_update, audit_log_no_delete).

### 20260523140000_chapter_directory.sql
* **Purpose**: Creates `chapter_directory` global reference table with generated `search_vector` tsvector column. Adds FK constraint from `chapters.directory_id` → `chapter_directory.id`.
* **Checks**: `select column_name from information_schema.columns where table_name = 'chapter_directory' and column_name = 'search_vector';` — should return 1 row. `select indexname from pg_indexes where tablename = 'chapter_directory' and indexname = 'idx_chapter_directory_search';` — should return 1 row.

### 20260523150000_chat_hotpath.sql
* **Purpose**: Adds `kind`, `payload`, `client_message_id`, `deleted_at` to `chat_messages`. Creates partial unique index for client_message_id dedup. Creates `chat_message_actions` table with two indexes.
* **Checks**: `select column_name from information_schema.columns where table_name = 'chat_messages' and column_name in ('kind','payload','client_message_id','deleted_at');` — should return 4 rows. `select indexname from pg_indexes where tablename = 'chat_messages' and indexname = 'idx_chat_messages_dedupe';` — should return 1 row.

**Rollback**: All migrations are additive (new columns/tables). Rollback is: drop new tables (chapter_directory, chapter_audit_log, chapter_custom_fields, chapter_custom_roles, chapter_workflows, chapter_dues_config, chat_message_actions), drop new columns from chapters and chat_messages. See `DB_ROLLBACK_PLAYBOOK.md` § Rollback Chunk 02 migrations.
