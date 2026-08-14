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
- **Promoting migrations does not carry reference data.** `chapter_directory` is
  populated from `supabase/seed/chapter_directory.csv` by
  `scripts/load-chapter-directory.mjs`, which the local bootstrap scripts run and the
  promotion path does not. A hosted project therefore has the table and its indexes
  but **zero rows** until someone loads it — which is how it stayed empty in every
  environment long enough to reach production onboarding (#840). Check
  `select count(*) from chapter_directory` as part of post-apply verification;
  populating staging is tracked in #902.

  When you do load it, generate the SQL with `npm run load:chapter-directory` and read
  it before applying. It is idempotent and **preserves row ids**, which matters here:
  `chapters.directory_id` references `chapter_directory(id) on delete set null`, so a
  delete-and-reload would silently detach every chapter already linked to a directory
  entry. Updates are scoped to `source = 'seed'`, so hand-curated rows survive.

## 2026-08-14: Backfill `chapters.accent_color` from branding (#795)

### 20260814120000_backfill_chapter_accent_color_from_branding.sql

* **Purpose**: Data-only repair. The onboarding wizard wrote the officer's chosen accent into
  `chapters.branding.colors.accent` and into the derived `theme_palette`, but never into the
  `chapters.accent_color` column, which kept its schema default `#2563EB`. Every surface reading
  the column — the web dashboard shell, mobile chapter branding, the membership summary in
  `packages/hooks` — rendered Royal Blue for a chapter that had chosen something else, while
  `theme_palette` readers were branded correctly. The API now treats `branding.colors.accent` as
  authoritative and mirrors it into the column on all three write paths, so this only repairs rows
  written before that.
* **Shape**: single `UPDATE`, no DDL, no locks beyond the touched rows. Idempotent and re-runnable:
  it matches only rows whose branding holds a well-formed `#RRGGBB` accent differing from the
  column, and uses `is distinct from` so a NULL column is handled rather than skipped.
* **Not yet applied.** This lands as a file only; promotion follows the order at the top of this
  runbook. Nothing was run against a hosted project as part of the change that introduced it.
* **Checks** (after promotion):
  - Rows still disagreeing — expect 0:
    `select count(*) from public.chapters where branding->'colors'->>'accent' ~ '^#[0-9A-Fa-f]{6}$' and accent_color is distinct from branding->'colors'->>'accent';`
  - Rows repaired, before/after: `select count(*) from public.chapters where accent_color = '#2563EB';`
    should fall by the number of chapters that had chosen a custom accent.
* **Rollback**: no schema change to revert. The previous per-row values are not recoverable from
  the migration itself, so capture them first if that matters:
  `create table tmp_accent_backup as select id, accent_color from public.chapters;`
  Restoring is an `UPDATE … FROM` off that table. In practice the pre-state is the schema default
  for affected rows, which carried no information.

## 2026-08-10: Staging migration backlog cleared — two blockers behind the #696 credential

On 2026-08-10 the first CI-driven migration since 2026-02-28 ran successfully against `frapp-staging` ([run 31318329969 attempt 4](https://github.com/pdcarlson/Frapp/actions/runs/31318329969)), applying **38** migrations in a single push. `schema_migrations` went from 1 row to 39 — it held 2 before the foreign row described below was removed. Post-apply state: public tables 29 → 44, public functions 1 → 15, storage buckets 0 → 7 (`backwork, branding, chat, documents, profiles, reports, service`).

**Every dated section below except the initial schema** was applied to staging in that one run, not on its own date — staging's history contained nothing but `00000000000000_initial_schema`. Treat their "after `db push`" checks as first verified on 2026-08-10, and note that production has had no successful CI migration either (#832).

Fixing the invalid Infisical credential (#696) was necessary but **not sufficient**. Two further blockers only became visible once injection worked, and both will recur on the first **production** migration:

* **`SUPABASE_DB_PASSWORD` is mandatory.** The pinned Supabase CLI cannot initialise its `cli_login_postgres` login role — it sets that role's password with an already-expired `valid until`, failing as `42501: permission denied to alter role`. Reads like a privilege problem; is a CLI bug ([supabase/cli#5091](https://github.com/supabase/cli/issues/5091), pin tracked in #835). Setting `SUPABASE_DB_PASSWORD` in the Infisical environment makes the CLI connect directly and skip the broken path. Present in the Infisical `development`, `staging`, and `production` environments as of 2026-08-10. Only the staging value has been exercised by a real migration run — `frapp-prod` is paused and no `production`-branch deploy has run since, so the production value is provisioned but unverified (#832).
* **Migration-history reconciliation.** `db push` refused with `Remote migration versions not found in local migrations directory`. Staging's `schema_migrations` carried `20260228000000_enable_rls_on_remaining_tables`, a version that has never existed in this repository on any branch. Its recorded `statements` column showed four `alter table … enable row level security` calls (`users`, `chapters`, `push_tokens`, `user_settings`) — a hand-applied February hotfix. The current `00000000000000_initial_schema.sql` already enables RLS on all four, so the row was redundant and was deleted.

**On-call note — reconciling a foreign migration row.** When `db push` reports a remote version missing locally, the CLI suggests `supabase migration repair --status reverted <version>`. **Do not run it blind.** First read what the row actually did:

```sql
select version, name, array_to_string(statements, E'\n;;\n') as sql_text
from supabase_migrations.schema_migrations where version = '<version>';
```

Postgres stores the executed SQL, so a migration absent from git is still fully recoverable from the database. Only once you have confirmed its effects are either redundant with the repo or intentionally superseded should you remove the row (`delete from supabase_migrations.schema_migrations where version = '<version>';` — equivalent in effect to `repair --status reverted`, and what was used here). Record the `version` and `name` first — re-inserting them is the rollback. If the row's SQL is **not** represented in `supabase/migrations/`, stop: the correct fix is a new migration capturing it, not deleting the evidence.

**This class of drift now has a detector.** `.github/workflows/check-migration-drift.yml` runs
daily (07:00 UTC) and compares `supabase_migrations.schema_migrations` on each deployed database
against `supabase/migrations/`, reporting three sets — **pending** (in the repo, not applied),
**foreign** (applied, absent from the repo), and **matched**. Foreign rows fail immediately;
pending rows are tolerated for 24h after their own version timestamp so a just-merged migration is
not an alert. A failure upserts one `routine-state` tracking issue and closes it once every
environment is back in sync, so "alert issue open" means "a deployed database is drifting right
now". Semantics in `scripts/ci/check-migration-drift.mjs`; run it by hand from the Actions tab
(`workflow_dispatch`, with an adjustable grace window) or via `npm run check:migration-drift`.

The check **reports and never repairs** — it sends no SQL. Reconciling a foreign row is the manual
procedure above, and applying a backlog of pending migrations is a deliberate promotion, not
something a watchdog should do on its own.

## 2026-08-09: Activation funnel — `chapter_activation_milestones` (#267)
* **Migration**: `20260809001500_chapter_activation_milestones.sql`
* **Purpose**: Records the first time a chapter reaches each of the seven free-to-paid activation milestones (onboarding submitted → first invite → first redemption → first chat message → first paid module → checkout started → checkout completed), per `spec/behavior/observability.md` § Product Analytics — Activation Funnel. The unique `(chapter_id, milestone)` key *is* the "first" semantics: the API attempts an insert on every candidate action and only a winning insert emits the analytics event, so Stripe redeliveries and client retries cannot double-count. It also keeps conversion queryable in plain SQL when no `POSTHOG_API_KEY` is set.
* **Safety**: Purely additive — one new table, one new index, no changes to any existing object, no backfill. `chapter_id` FKs to `chapters` with `on delete cascade`, so chapter deletion cleans up. RLS is enabled with **zero policies** (API/service-role only, same posture as `stripe_webhook_events` and `chapter_directory_requests`); the table holds bookkeeping with no user id and nothing member-visible. The `milestone` CHECK pins the seven values to `ACTIVATION_MILESTONES` in `@repo/validation` — the two must be edited together.
* **Order**: Apply **before** deploying the API build with #267. The post-#267 services call `ActivationService.record` at seven call sites; a missing table makes every call throw inside the service's own catch, which logs an error per action and records nothing. It cannot break a request — recording is best-effort by construction — so the only cost of applying late is a gap in the funnel plus log noise. Harmless ahead of the deploy: nothing reads or writes the table until that build ships.
* **Checks**: After `db push`, `insert into chapter_activation_milestones (chapter_id, milestone) values ('<real chapter uuid>', 'activation-onboarding-submitted');` succeeds, and running the identical insert a second time fails with a unique violation on `chapter_activation_milestones_chapter_id_milestone_key`. `insert … values ('<uuid>', 'not-a-milestone');` must fail the CHECK. Clean up with `delete from chapter_activation_milestones where chapter_id = '<uuid>';`. Post-deploy, completing the onboarding wizard for a new chapter must leave exactly one `activation-onboarding-submitted` row for it.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback the activation funnel table.

## 2026-08-05: Durable Stripe webhook idempotency — `stripe_webhook_events` (FRA-23)
* **Migration**: `20260805150000_stripe_webhook_events.sql`
* **Purpose**: Replaces `BillingService`'s process-local `Set<string>` of handled Stripe event ids with a persisted claim table plus the `claim_stripe_webhook_event` CAS function. The in-memory set died with the process, so a Render deploy, a crash, or a second API instance let Stripe's replay re-apply an event — double-writing subscription status and re-firing the president's billing alert. `chapters.last_stripe_webhook_at` (FRA-242) does **not** cover this: it treats two events sharing a Stripe second as not-stale by design, and a redelivery carries the same `event.created` as the mark it wrote.
* **Safety**: Purely additive — one new table, one new function, no changes to any existing object. RLS is enabled with **zero policies** (API/service-role only, same posture as `chapter_directory_requests`); the table holds delivery bookkeeping with no `chapter_id`, no FK and nothing member-visible. `security invoker` matches `apply_invoice_payment`: the API always calls it through the service-role client, which bypasses RLS.
* **Order**: Apply **before** deploying the API build with FRA-23 — the post-FRA-23 `BillingService` claims every side-effecting event, and a missing table surfaces as a 500 on `POST /v1/webhooks/stripe`, which Stripe then retries for days. Harmless ahead of the deploy: nothing reads the table until that build ships.
* **Checks**: After `db push`, `select claim_stripe_webhook_event('evt_probe','invoice.paid',300);` returns `(claimed,1)`; calling it a second time returns `(in_flight,1)`; after `update stripe_webhook_events set status='failed' where event_id='evt_probe';` it returns `(claimed,2)`. Clean up with `delete from stripe_webhook_events where event_id = 'evt_probe';`. Post-deploy, replaying a delivered event from the Stripe dashboard must log `Skipping already-processed event …` and leave `chapters` untouched.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback durable Stripe webhook idempotency.

## 2026-08-03: `service` storage bucket for service-hour proofs (FRA-49)
* **Migration**: `20260803231500_service_proof_bucket.sql`
* **Purpose**: Provisions the private `service` storage bucket that holds service-hour proof uploads under `chapters/{chapter_id}/service/{proof_id}/` per `spec/behavior/service-hours.md`. First bucket managed in a migration (the five older buckets were dashboard-created); the row carries `allowed_mime_types` (images + PDF) and `file_size_limit` (25MB) because storage-api enforces those columns on the signed-URL PUT itself — the API's allowlist only gates URL issuance and a signed upload URL cannot pin a content type.
* **Safety**: Additive DML into `storage.buckets` only — no DDL, no data changes, no RLS policies (the bucket is private; all access goes through API-issued signed URLs, which bypass RLS). The whole statement is wrapped in a `DO` block that no-ops when `storage.buckets` doesn't exist, so it replays cleanly on bare Postgres / PGlite. `ON CONFLICT (id) DO UPDATE` re-asserts `public=false` and the constraint columns, so re-running (or a pre-existing hand-made bucket) converges to the intended config.
* **Order**: Apply **before** deploying the API build with FRA-49 — `POST /v1/service-entries/proof-upload-url` mints upload URLs against the bucket, and a missing bucket surfaces as a 500 on that route (entry creation without proof is unaffected). Harmless ahead of the deploy.
* **Checks**: After `db push`, `select id, public, file_size_limit, allowed_mime_types from storage.buckets where id = 'service';` returns 1 row with `public = false`, `file_size_limit = 26214400`, and the five image/PDF MIME types. Post-deploy, requesting an upload URL (member with `service:log`), PUTting a small PNG to it, and creating an entry with the returned path must succeed end to end; PUTting a `text/html` body to a fresh signed URL must be rejected by storage-api.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback the `service` proof bucket.

## 2026-08-03: `chat_message_actions` membership-scoped read RLS (FRA-38)
* **Migration**: `20260803150000_chat_message_actions_membership_rls.sql`
* **Purpose**: Closes a high-severity cross-tenant read leak. The table's `SELECT` policy was `using (auth.role() = 'authenticated')`, so any authenticated user could read every reaction/poll-vote row in every chapter, private DM and role-gated channel — and the web client reads this table **directly under the user's JWT** (a per-channel backfill plus a global Realtime subscription), so RLS was the only gate. Replaces the policy with one scoped `TO authenticated` and gated on a new `SECURITY DEFINER` helper `public.can_read_chat_message(uuid)` that mirrors the canonical `canAccessChannel` predicate. Details in `docs/internal/security/SECURITY_FIXES.md`.
* **Safety**: Non-destructive — one `create or replace function` plus a `drop policy if exists` / `create policy` swap on the same policy name. No columns, no data, no backfill, and **no replica-identity change** (see the migration header for why `FULL` is deliberately *not* set). `security definer` with `search_path` pinned to `public`, EXECUTE revoked from `public`/`anon` and granted to `authenticated`/`service_role`; every role statement — including the policy's `TO authenticated` clause, emitted via `format()` — is guarded on `pg_roles` existence, so the file also applies on bare Postgres / PGlite. INSERT/DELETE policies and the `service_role` write path are untouched, so Edge Function hot-path writes are unaffected.
* **Order**: Standalone — **no coordinated app deploy required**. No application code changes with it; the web backfill and Realtime subscription work under either policy. Safe to apply at any point relative to the API/web rollout.
* **Checks**: After `db push`:
  * `select polname, polroles::regrole[], pg_get_expr(polqual, polrelid) from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'chat_message_actions' and p.polpermissive and p.polcmd in ('r','*');` returns **exactly one** row — `chat_message_actions_select`, `polroles = {authenticated}`, expression containing `can_read_chat_message(message_id)` joined by `AND`. Note `polcmd in ('r','*')`: a `FOR ALL` policy also applies to SELECT and ORs in, so checking `'r'` alone would miss it. Any second permissive row here re-opens the leak.
  * `select prosecdef, proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'can_read_chat_message';` returns `prosecdef = true` and `proconfig = {search_path=public}`.
  * `select has_function_privilege('anon', 'public.can_read_chat_message(uuid)', 'execute');` returns `false`; the same for `authenticated` returns `true`.
  * `select relreplident from pg_class where relname = 'chat_message_actions';` returns `d` (default). `f` means someone re-added `REPLICA IDENTITY FULL` on the disproven rationale.
  * `polroles = {authenticated}` above is worth checking by hand because **CI cannot**: the `TO authenticated` clause is emitted under a `pg_roles` guard, and the PGlite harness has no `authenticated` role, so no automated test exercises it. Without the clause, anon reads can fail with `42501 permission denied for function` instead of returning no rows, depending on plan shape.
  * Post-apply smoke: open the chat page as a normal member — reactions still render on load (backfill) and a reaction added in another session still appears live (Realtime INSERT). If reactions vanish entirely, the policy is denying legitimate reads: roll back per the playbook rather than debugging in production.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback `chat_message_actions` membership-scoped read RLS.

## 2026-08-03: Account deletion — `users.deleted_at` + `anonymize_user` RPC (FRA-40)
* **Migration**: `20260803140000_account_deletion_anonymize_user_rpc.sql`
* **Purpose**: Implements the DB half of individual account deletion per `spec/behavior/data-retention.md`. Adds `users.deleted_at timestamptz` (tombstone marker), the `anonymize_card_content(text, text)` helper, and `anonymize_user(uuid, boolean)` — an atomic function that scrubs the users row in place (email → per-user `@anonymized.invalid` sentinel, display name → "Deleted User", bio/avatar/graduation year/city/company/active chapter → null), deletes current-state rows (members → cascades member_custom_field_values, user_settings, push_tokens, notifications, notification_preferences, chat_notification_preferences, channel_read_receipts, study_sessions), and rewrites the deleted user's display-name snapshots inside task/points/event chat cards — the payload name keys plus the generated `content` string (content keyed on each row's own payload snapshot, word-boundary matched, so renames and similar names are safe; event cards, which carry no payload name, get a structural creator-prefix rewrite) — in a single combined UPDATE that runs on the **first successful scrub only** (snapshots are historical and cannot regress once memberships are gone). It deliberately has **no tombstone early-return** for the users-row scrub: every call re-runs it (preserving the original `deleted_at`), so PII written onto the tombstone during the API's retry window is re-scrubbed, while retries stay cheap because the card scan is first-run-gated. History (point transactions, attendance, chat messages, service entries, poll votes, reactions, invoices) keeps its FKs to the tombstone. `DELETE /v1/users/me` calls it via `AccountDeletionService`.
* **Safety**: Additive DDL — one nullable column (`ADD COLUMN IF NOT EXISTS`, no default, no backfill) plus `create or replace function`. The function itself deletes/overwrites rows **only for the single user id it is invoked with**, only via the API's authenticated self-service route. `security invoker` with EXECUTE revoked from `public`/`anon`/`authenticated` and granted to `service_role`; role statements guarded on `pg_roles` existence, so the file also applies on bare Postgres / PGlite. Refuses the seeded system user id.
* **Order**: Apply **before** deploying the API build with FRA-40 — the new `DELETE /v1/users/me` route calls the function, and a missing function surfaces as a 500. Harmless ahead of the deploy (nothing calls it yet).
* **Checks**: After `db push`, `select proname, prosecdef from pg_proc where proname in ('anonymize_user','anonymize_card_content');` returns 2 rows with `prosecdef = false`; `select has_function_privilege('service_role', 'public.anonymize_user(uuid, boolean)', 'execute');` returns `true` and the same for `anon`/`authenticated` returns `false`; `select column_name from information_schema.columns where table_name = 'users' and column_name = 'deleted_at';` returns 1 row. Post-deploy, deleting a test account must return `{"success":true}`, leave the row with `display_name = 'Deleted User'` and `deleted_at` set, and preserve its point/chat history.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback account deletion.

## 2026-08-03: Invoice payment RPC + idempotency indexes (FRA-15)
* **Migration**: `20260803120000_invoice_payment_rpc_and_indexes.sql`
* **Purpose**: Adds `apply_invoice_payment(uuid, uuid, text, text)` — a compare-and-set that moves an `OPEN` invoice to `PAID` and inserts its `PAYMENT` ledger row (with the Stripe charge id) in one transaction — plus two partial unique indexes on `financial_invoices.stripe_payment_intent_id` and `financial_transactions.stripe_charge_id` (PAYMENT rows). Both the Stripe webhook and the admin manual-PAID path call the function, which is what makes their race safe in both directions per `spec/behavior/billing.md`.
* **Safety**: Additive — one `create or replace function` and two `create unique index if not exists`. No columns, no data changes, no destructive DDL. Both indexed columns were never written before this change set, so the indexes cannot conflict with existing rows. `security invoker`, with EXECUTE revoked from `public`/`anon`/`authenticated` and granted to `service_role`; the role statements are guarded on `pg_roles` existence, so the file also applies on bare Postgres / PGlite.
* **Order**: Apply **before** deploying the API build that contains FRA-15 — the new code calls the function on the webhook path, and a missing function surfaces as a 500 that Stripe retries for up to ~72h. The migration is harmless ahead of the deploy (nothing calls it yet).
* **Checks**: After `db push`, `select proname from pg_proc where proname = 'apply_invoice_payment';` returns 1 row; `select has_function_privilege('service_role', 'public.apply_invoice_payment(uuid, uuid, text, text)', 'execute');` returns `true` and the same for `anon`/`authenticated` returns `false`; `select indexname from pg_indexes where indexname in ('idx_financial_invoices_payment_intent','idx_financial_transactions_payment_charge');` returns both. Post-deploy, a member dues payment should move the invoice to `PAID` and leave exactly one `financial_transactions` row with a non-null `stripe_charge_id`; a webhook redelivery must not add a second.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback the invoice payment RPC + indexes.

## 2026-08-02: Active-chapter JWT claim — `custom_access_token_hook` (FRA-303)
* **Migration**: `20260802120000_active_chapter_jwt_claim.sql`
* **Purpose**: Adds `users.active_chapter_id uuid references chapters(id) on delete set null` and the `public.custom_access_token_hook(event jsonb)` auth hook that stamps it into every issued access token as the top-level `active_chapter_id` claim. This is the authoritative chapter context `ChapterGuard` reconciles against per `spec/behavior/multi-tenancy.md`; before it, the client-supplied `x-chapter-id` header was the only source.
* **Safety**: Additive — one nullable column (`ADD COLUMN IF NOT EXISTS`, no default, no backfill) plus `create or replace function`. The hook body is wrapped in `exception when others then return event`, so a failure degrades to an unmodified token rather than blocking sign-in. Role grants are guarded on `pg_roles` existence, so the file also applies on bare Postgres / PGlite. Two SELECT policies scoped **to `supabase_auth_admin` only** are added on `users` and `members` (both have RLS enabled with no policies); the API uses the service-role key and bypasses RLS, so no other caller's visibility changes.
* **⚠️ Required manual step per hosted environment**: applying the migration does **not** enable the hook. Enable it in the Supabase dashboard (**Authentication → Hooks** → Custom Access Token → `public.custom_access_token_hook`), or via the Management API `PATCH /v1/projects/{ref}/config/auth` with `hook_custom_access_token_enabled: true` and `hook_custom_access_token_uri: "pg-functions://postgres/public/custom_access_token_hook"`. Local is already wired through `[auth.hook.custom_access_token]` in `supabase/config.toml`. **Order does not matter**: until the hook is enabled the claim is simply absent and the `x-chapter-id` fallback carries context, so the migration is safe to promote ahead of the toggle.
* **Status**: enabled on **`frapp-staging`** as of 2026-08-10 (Postgres function, schema `public`, function `custom_access_token_hook`) and verified with a live password-grant sign-in — the decoded access token carried a top-level `active_chapter_id`. **Not enabled on `frapp-prod`**, which is `INACTIVE`; see #805. Note the claim only appears for a user who resolves to a chapter, so on an environment with no `chapters`/`members` rows a correctly-working hook still issues a token with no claim — verifying there requires data that reaches one of the hook's resolution branches.
* **Checks**: After `db push`, `select proname from pg_proc where proname = 'custom_access_token_hook';` returns 1 row; `select has_function_privilege('supabase_auth_admin', 'public.custom_access_token_hook(jsonb)', 'execute');` returns `true` and the same for `anon`/`authenticated` returns `false`. After enabling the hook, sign in as a single-chapter user and decode the access token — `active_chapter_id` must be present. If sign-in breaks, disable the hook in the dashboard first (instant mitigation, no deploy needed), then investigate.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback active-chapter JWT claim.

## 2026-06-04: Terms/Privacy acceptance on `chapters` (FRA-17) + migration-version collision fix (FRA-288)

One additive migration, plus a remediation rename of an already-merged migration.

### 20260604130000_chapter_legal_acceptance.sql
* **Purpose**: Adds `chapters.legal_accepted_at timestamptz`, `legal_policy_version text`, and `legal_accepted_by uuid references users(id) on delete set null` (all nullable). `ChapterOnboardingService` stamps them from the authenticated session actor + server clock at chapter creation, recording the admin's Terms of Service / Privacy Policy acceptance (`spec/behavior/legal.md`, `spec/product/onboarding.md`).
* **Safety**: `ADD COLUMN IF NOT EXISTS` (nullable, no default) — backward-compatible and not lock-heavy. No backfill: chapters created before this shipped keep `NULL` (no explicit consent was captured for them; we don't fabricate one). The FK uses `on delete set null` (matching `audit_log.actor_user_id`), so deleting the accepting user never blocks.
* **Checks**: After `db push`, `select column_name from information_schema.columns where table_name='chapters' and column_name like 'legal_%';` returns 3 rows (`legal_accepted_at`, `legal_accepted_by`, `legal_policy_version`).

### Remediation: `chapter_last_stripe_webhook_at` migration version `20260604120000` → `20260604121000` (FRA-288)
* **Why**: PRs #634 (`20260604120000_add_transfer_presidency_rpc.sql`) and #635 (`20260604120000_chapter_last_stripe_webhook_at.sql`) merged with the **same** version `20260604120000`. Supabase keys `schema_migrations` by version, so applying the second violates `schema_migrations_pkey` — breaking `supabase start` / `db reset` on any fresh DB. #635's file is renamed to a unique later version; #634 keeps `120000`.
* **On-call note**: On a DB that **already applied** the old `20260604120000_chapter_last_stripe_webhook_at.sql`, `supabase db push` sees `20260604121000` as pending and re-runs it. The body is `ADD COLUMN IF NOT EXISTS last_stripe_webhook_at` — a safe no-op — but `supabase migration list` may show the superseded `120000` stripe entry; run `supabase migration repair` only if the CLI reports drift. `frapp-staging` / `frapp-prod` were paused during the collision window (migrations not applied), so they take the corrected sequence cleanly on the next push.
* **Guardrail**: `scripts/check-migration-safety.mjs` now fails on duplicate 14-digit version prefixes (not just duplicate filenames), so this collision class is caught in CI going forward.

**Rollback**: See `DB_ROLLBACK_PLAYBOOK.md` § Rollback Terms/Privacy acceptance columns.

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
* **Superseded by**: `20260604140000_get_points_report_window_filter.sql` (2026-06-04) — replaces the `text` overload with `p_since timestamptz`.

## 2026-06-04: Points report window filter (`get_points_report` → `p_since`)
* **Migration**: `20260604140000_get_points_report_window_filter.sql`
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
