## Supabase migration review expectations

- Treat every migration as production-impacting, even when the SQL looks small.
- Flag destructive statements such as `DROP`, `DELETE`, `TRUNCATE`, or backward-incompatible schema changes unless rollback guidance is documented in `docs/internal/DB_ROLLBACK_PLAYBOOK.md`.
- Verify every new table enables row-level security and that migrations preserve the current API contract.
- Call out downtime risks, lock-heavy operations, or data backfill steps that should be staged separately.
