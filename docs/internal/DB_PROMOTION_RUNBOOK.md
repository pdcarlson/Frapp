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

## 2025-02-26: Add `get_points_report` RPC
* **Migration**: `20250226120000_add_get_points_report_rpc.sql`
* **Purpose**: Creates an RPC for faster points report aggregation.
* **Checks**: Verify the RPC exists using `select has_function_privilege('get_points_report(uuid, uuid, text)', 'execute');`.

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
* **Purpose**: Append `members:view` to Vice President and Secretary so `PermissionsGuard` on poll/member controllers succeeds alongside `polls:view_all`.
* **Checks**: After `db push`, e.g. `select count(*) from public.roles where is_system and name in ('Vice President', 'Secretary') and 'members:view' = any (permissions);` should equal twice the number of chapters with those rows (or verify zero rows missing the permission). Rollback: `DB_ROLLBACK_PLAYBOOK.md` § Rollback `backfill_members_view_vp_secretary`.
