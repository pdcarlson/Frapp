# DB Rollback Playbook

## Automated Migration Context

Migrations are now applied automatically in the deploy pipeline (see `.github/workflows/deploy-api.yml`):
- **Staging:** Runs automatically on merge to `main` (no approval needed)
- **Production:** Requires manual approval in GitHub Actions before applying

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

## Rollback `get_points_report` RPC
* **Migration**: `20250226120000_add_get_points_report_rpc.sql`
* **Action**: Run `DROP FUNCTION IF EXISTS get_points_report(uuid, uuid, text);`

## Rollback `idx_point_transactions_chapter_created_at`
* **Migration**: `20260417120000_point_transactions_chapter_created_at_idx.sql`
* **Action**: `DROP INDEX IF EXISTS idx_point_transactions_chapter_created_at;`
* **Note**: Safe additive change only; dropping removes the performance optimization for chapter-scoped transaction lists.

## Rollback `backfill_polls_view_all_system_roles`
* **Migration**: `20260417140000_backfill_polls_view_all_system_roles.sql`
* **Action (best-effort):** Remove appended permission and inserted roles, then restore `display_order` for system roles that were shifted by +2:
  1. `delete from public.roles where name in ('Vice President', 'Secretary') and is_system = true;`
  2. `update public.roles set permissions = array_remove(permissions, 'polls:view_all') where is_system = true and name = 'Treasurer' and not ('*' = any (permissions));`
  3. For each chapter that no longer has a Vice President row, decrement `display_order` by 2 on system roles with `display_order >= 5` (Member and below in the default ordering). Prefer restoring from a snapshot if unsure.
* **Note:** This migration is data-only; rollback is manual because removing `polls:view_all` from Treasurer may have been intentional pre-migration state.
