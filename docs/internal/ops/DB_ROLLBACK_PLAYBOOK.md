# DB Rollback Playbook

## Every migration owes a recipe here

`check:migration-safety` asserts **per-migration** coverage in this file *and*
in [`DB_PROMOTION_RUNBOOK.md`](DB_PROMOTION_RUNBOOK.md) — both, not either. It
reads the entry **shape**, so naming a migration in prose does not satisfy it.
Any of these counts, anywhere in the file:

```
* **Migration**: `<migration>.sql`
## Rollback <what> (<migration>.sql)
## Rollback <what> (<14-digit version>)
## Rollback <what> (<version-prefix>*)
```

The bullet is the usual form and conventionally opens a `## Rollback <what>`
recipe, but neither the heading nor the position is required — the line shape
alone is what is read. The list marker may be `*` or `-`, and a heading may
carry a trailing issue ref after the parenthetical.

A recipe heading may name its subject by bare version rather than filename
(`## Rollback account deletion (20260803140000)`), and the glob form covers a
chunk applied together (`## Rollback Chunk 02 migrations (20260523*)`). Both
are real entries — reading only the filename form once put **eleven** fully
documented migrations on the allowlist as debt they had already paid.

A migration with no reversible DDL still
gets a recipe — say so in an `* **Action**:` bullet; "not reversible, restore
from backup" is a legitimate recipe and the honest one.

Migrations that predate the gate are grandfathered in `UNLEDGERED` in
[`scripts/check-migration-safety.mjs`](../../../scripts/check-migration-safety.mjs).
That list is **shrink-only** and enforced by a version ceiling, so a migration
created after the gate cannot be added to it.

## Automated Migration Context

Migrations are now applied automatically in the deploy pipeline (see `.github/workflows/deploy-api.yml`):
- **Staging:** Runs automatically on merge to `main` (no approval needed)
- **Production:** Never automatic. `deploy-production.yml` applies migrations for one named commit, and **pauses on the `production` environment's required reviewer** before it applies (`docs/internal/ci-cd/AGENT_INFRA.md` § GitHub environments and bootstrap secrets). That approval is the only human gate since #1340 retired the `main` → `production` promotion PR. Before applying, the workflow rehearses the migration against production's live applied state with `check-migration-replay.mjs`. The code-free path — apply migrations without shipping code — is now the same workflow run with `scope: migrations-only`, so it rehearses too; the separate `Migrate production` workflow that skipped the rehearsal (and SHA validation, and the guardrail preflight, and the working-tree fence) has been deleted. (The old justification for saying the environment did not gate anything — Enterprise-only environment rules *on private repos* — was corrected 2026-08-21: this repo is public. See `docs/internal/ci-cd/AGENT_INFRA.md` § GitHub environments and bootstrap secrets.)

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
3. Deploy that commit to production once verified (**Deploy production**, with the SHA).

> **Deploying an OLDER commit — the deployable window.** `Deploy production`
> refuses a SHA whose required checks are not green, and the required list is
> today's. A check run cannot exist on a commit whose tree never defined the job
> that emits it, so every check added to `CI_CHECKS`/`DOCS_CHECKS`/`DRIFT_CHECKS`
> used to make every older commit undeployable with `never reported: <check>` —
> which lands on exactly this step, the one you reach for when something is
> already wrong.
>
> It was not hypothetical: `web-production-build` (#1374) made `971d7d5`, the
> commit production's API was running at the time, un-redeployable.
> `scripts/ci/validate-deploy-sha.mjs` now intersects the required list with the
> job ids the deployed commit's own workflows define, and reports the difference
> as *not applicable* rather than missing. The run log names them — a commit
> predating a gate was never judged by it, and if that matters for the rollback
> you are doing, the log is where you find out.
>
> **The other door: a cancelled check.** A commit can also be refused with its
> required checks *present* but concluded `cancelled` — correctly, because a
> cancelled check asserted nothing. The cause was concurrency: a workflow keying
> `group` on `github.ref` with an unguarded `cancel-in-progress: true` puts every
> push to `main` in one group, since `github.ref` is `refs/heads/main` for all of
> them, so two merges minutes apart meant the earlier commit's run was cancelled
> by the later one's and nothing re-ran it. `.github/workflows/ci.yml`,
> `.github/workflows/docs.yml`, `.github/workflows/links.yml` and
> `.github/workflows/migration-drift-gate.yml` now carry
> `cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}`, so main push runs
> no longer cancel each other. **On a commit that predates that fix, the remedy
> is a re-run, not a code change:** re-run that commit's workflow run from the
> Actions UI (GitHub keeps them 30 days), then retry the deploy. The failure
> message reports cancelled checks apart from genuine failures and names this
> remedy, so you should not have to reach this page to find it.

### 2) Full rollback to backup/snapshot

Use when:
- destructive migration caused data loss/corruption,
- service remains broken after attempted forward-fix,
- unacceptable blast radius.

Action:
1. Freeze writes (maintenance mode if needed).
2. Restore the most recent offsite dump — see [Restoring from an offsite dump](#restoring-from-an-offsite-dump). **There is no Supabase snapshot to restore instead**; see Backup reality below.
3. Re-deploy API once DB state is consistent.
4. Execute incident postmortem.

## Backup reality

Established from the Supabase Management API and Supabase's own documentation on
2026-08-27 (#852), not assumed:

| Fact | Value |
| --- | --- |
| Org | `Frapp Live` (`iouzvaszrnjlndtmookt`) |
| **Plan** | **`free`** — holds *both* `frapp-staging` and `frapp-prod` |
| `frapp-staging` | `hnoyzpidbmizhbqaiity`, `us-east-1`, Postgres 17.6.1.063 |
| `frapp-prod` | `unttyvyfezddlyafcydh`, `us-east-2`, Postgres 17.6.1.063 |

> **Rotating either project is a four-place change.** The ref is recorded in
> [`.github/environments.json`](../../../.github/environments.json) as well as in Infisical, in this table, and in
> [`CLOUD_SANDBOX.md`](../environment/CLOUD_SANDBOX.md)'s egress allowlist. `scripts/run-migration.mjs`
> compares the injected `SUPABASE_PROJECT_REF` against the committed file and **refuses to run** when they
> disagree — deliberately, so a staging label can never write to production — so a rotation that updates
> Infisical and not the file blocks every production migration, and `migration-order` fails every
> migration-bearing PR against the dead ref. Update the file in the same change.
| Supabase daily backups | **None available.** [Pro/Team/Enterprise only](https://supabase.com/docs/guides/platform/backups) |
| Point-in-Time Recovery | **Not available.** Paid add-on, Pro and above |

Supabase's guidance for the free tier is to do exactly what this repo now does:

> We recommend that free tier plan projects regularly export their data using the
> Supabase CLI `db dump` command and maintain off-site backups.

Two consequences worth stating plainly:

- **The nightly offsite dump is not defence-in-depth. It is the only source of a
  restorable backup either project has.** For `frapp-staging` that has been true
  since 2026-08-27. For `frapp-prod` the jobs were added on 2026-09-06 (#1435) and
  **a production dump exists only from the first successful scheduled run onward
  — check the `production/` prefix in the bucket, not this sentence**; a
  production **restore** has not been rehearsed (see the rehearsal log). If the
  workflow is not running, there is no recovery path from data loss beyond
  replaying migrations into an empty database.
- Free-tier projects may have up to 7 daily backups taken internally, but
  Supabase makes them accessible **only on upgrade**, and states it "might no
  longer make daily backups for free projects in the future". That is not
  something a recovery plan can depend on. Upgrading the org to Pro is the
  single change that would most improve this posture.

## Backups: what exists

| | |
| --- | --- |
| Producer | [`.github/workflows/db-backup.yml`](../../../.github/workflows/db-backup.yml) — nightly 06:30 UTC, plus `workflow_dispatch` |
| Script | [`scripts/db-backup.sh`](../../../scripts/db-backup.sh) |
| Contents | three gzipped SQL files — roles, schema, data — plus a manifest carrying a SHA-256 per file |
| Scope | **Both projects** since 2026-09-06. `frapp-staging` under the `staging/` prefix (jobs `backup-staging`, `backup-staging-storage`, `environment: staging`) and `frapp-prod` under `production/` (jobs `backup-production`, `backup-production-storage`). The production jobs run under a **`production-backup`** GitHub environment with **no protection rules** — a `schedule:` job naming `production` would suspend on ADR-19's required-reviewer gate every night (#1435, the design trap this resolves). Both environments share one code path: the [`db-offsite-backup`](../../../.github/actions/db-offsite-backup/action.yml) and [`storage-offsite-backup`](../../../.github/actions/storage-offsite-backup/action.yml) composite actions, each of which asserts the injected project ref / URL against `.github/environments.json` before touching anything, so a dump can never be filed under the wrong label. Still open: #1403 (Supabase Pro / PITR) and #1421 (an offsite restore rehearsed at least once) |
| Destination | A private Cloudflare R2 bucket, outside Supabase on purpose — Supabase deletes its own backups with the project. Provisioned 2026-08-27 (#1287): scoped API token (object read/write on that one bucket), `BACKUP_S3_*` secrets in Infisical `staging` at `/` — see [`ENV_REFERENCE.md`](../environment/ENV_REFERENCE.md) § Offsite Backup Secrets. The production jobs read the same four from `staging` (injected first) and their source credentials from `prod` (injected second); copying `BACKUP_S3_*` into `prod` makes the first injection redundant, nothing more. Storage mirrors: `storage/` (staging) and `storage-production/` |
| Retention | `BACKUP_RETENTION_DAYS`, default 30, pruned by the same workflow |
| First verified run | [2026-08-27, run 1](https://github.com/pdcarlson/Frapp/actions/runs/33116113194) — upload plus independent read-back listing all 4 objects |

If the `BACKUP_S3_*` secrets ever go missing the workflow still **fails loudly
before dumping** rather than going green. A backup job that reports success
while writing no backup is the failure mode this whole runbook exists to
prevent.

### What this backup does not cover

- **Storage objects — covered now, but by the *other* job.** Per Supabase,
  "Database backups do not include objects you store via the Storage API, as the
  database only includes metadata about these objects", so the dump above still
  cannot carry them. #1290 closed that gap with a second job in the same
  workflow, writing to the same R2 bucket under a `storage/` prefix. **A full
  recovery needs both halves**: restoring the database alone gives you rows
  referencing files, and restoring Storage alone gives you files nothing points
  at. See *Restoring Storage objects* below.
- **The `storage` schema itself**, deliberately: bucket rows are provisioned by
  this repo's own `supabase/migrations/*_bucket.sql`, so they come back when
  migrations run. Including them made the restore abort on `buckets_pkey`.
- **`auth.schema_migrations`**, deliberately: GoTrue's own ledger, populated on
  every project, so restoring it aborts on `schema_migrations_pkey`.
- **Custom role passwords.** Supabase excludes them from `--role-only` dumps.
  Reset them by hand after a restore if any exist.

## Restoring from an offsite dump

```bash
# 1. Fetch the dump you want (labels are UTC and sort chronologically).
aws s3 cp "s3://$BACKUP_S3_BUCKET/staging/<label>/" ./restore/ \
  --endpoint-url "$BACKUP_S3_ENDPOINT" --recursive

# 2. Restore. Verifies checksums and preconditions before touching the target.
scripts/db-restore.sh --backup-dir ./restore --db-url "<target-url>" --force
```

**The target must be a Supabase-provisioned database** — a freshly created
project, or a reset local stack. These dumps are *not* self-contained:
`supabase db dump` excludes Supabase-managed schemas, so the schema dump references
`auth`, `storage` and `extensions` without creating them, and restoring into a
bare `CREATE DATABASE` dies partway through. The restore script checks this up front
rather than letting you discover it mid-replay.

`--force` is required for any non-local target. That is not ceremony: the script
replaces the contents of the database it is pointed at, and the difference
between a rehearsal and an outage is one mistyped host.

## Restoring Storage objects

Storage is backed up by the `backup-staging-storage` and `backup-production-storage`
jobs in [`db-backup.yml`](../../../.github/workflows/db-backup.yml), which run
[`scripts/storage-backup-run.mjs`](../../../scripts/storage-backup-run.mjs) through
the [`storage-offsite-backup`](../../../.github/actions/storage-offsite-backup/action.yml)
action. **The two environments live under two prefixes — `storage/` is staging,
`storage-production/` is production** — and every command below takes the prefix
explicitly (`--prefix`). Restoring `storage/` into `frapp-prod` would overlay the
staging corpus onto production; read the prefix twice.
Rationale for every design choice is in the header of
[`scripts/storage-backup.mjs`](../../../scripts/storage-backup.mjs).

### What is offsite, and in what shape

Unlike the database dump, this is a **mirror, not a dated snapshot**. Objects sit
at a stable key so a restore can address one file without unpacking a nightly
archive:

```
s3://<BACKUP_S3_BUCKET>/storage/manifest.json                      # staging
s3://<BACKUP_S3_BUCKET>/storage/<bucket>/<object path>
s3://<BACKUP_S3_BUCKET>/storage-production/manifest.json           # production
s3://<BACKUP_S3_BUCKET>/storage-production/<bucket>/<object path>
```

The manifest object at the top of that prefix is the index: one record per
object with its size, etag, `updated_at`, when it was first backed up, and
`deleted_at` if it has since been removed from Storage.

### Deleted objects are still restorable — that is the point

A plain mirror would drop the backup copy the moment a file left Storage, which
would make "someone deleted it, get it back" impossible. Instead a deletion is
**tombstoned**: the object stays in R2 and the manifest records `deleted_at`. It
is pruned only once it is older than `BACKUP_RETENTION_DAYS` (default 30).

**So the retention window is the recovery window.** A file deleted 31 days ago is
gone; one deleted yesterday is one command away.

### If the backup job fails saying it would delete too much

The job refuses to proceed when a run would tombstone more than half of a corpus
of 20 or more objects. That is not a real mass deletion in almost every case --
it is a **short listing**: a permissions change, a renamed bucket, or a partial
API failure that still answered `200`. From inside the job those look identical
to everyone deleting everything, and the difference would otherwise only surface
a month later when retention began pruning.

Nothing is written offsite when this fires, so the previous backup is intact.
Check what Storage actually returns before doing anything else. If the deletion
is genuine (a chapter offboarded, a bucket deliberately emptied), re-run with
`STORAGE_BACKUP_ALLOW_MASS_DELETE=true`.

### Restore

Needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and the four `BACKUP_S3_*`
values in the environment (all live in Infisical `staging` at `/`), plus
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION=auto` set
from the `BACKUP_S3_*` pair, exactly as the workflow does it.

```bash
# See what would be restored, changing nothing.
node scripts/storage-backup-run.mjs restore --dry-run

# One file — the usual case.
node scripts/storage-backup-run.mjs restore \
  --bucket documents --path "chapter-1/bylaws.pdf"

# A whole bucket.
node scripts/storage-backup-run.mjs restore --bucket chat-archive

# Everything.
node scripts/storage-backup-run.mjs restore
```

Restores are **idempotent** (`x-upsert`), so a run that dies halfway is safe to
repeat. They write *into* Storage, so run the dry run first.

### Order, when restoring both halves

Restore the **database first, Storage second**. Bucket rows come from this repo's
own `supabase/migrations/*_bucket.sql`, so the buckets must exist before objects
can be written into them — a Storage restore against a database that has not been
migrated fails on the missing bucket.

### Rehearsing it

A copy nobody has restored from is not a backup. The drill is automated: Actions
→ **Nightly Backup** → *Run workflow* → tick **`storage_rehearsal`**. It writes a
canary object, backs it up, deletes it from Storage, restores it from R2, and
asserts the bytes match byte-for-byte, then cleans up after itself. It only ever
touches its own canary under `documents/_backup-rehearsal/`, and deletes it
again on the way out. (`documents` rather than `reports` because every bucket
here pins `allowed_mime_types` and `reports` permits only `application/pdf`.)

Record each run in the rehearsal log below.

## Rehearsal log

A backup you have never restored is a rumor. Re-run
[`scripts/db-restore-rehearsal.sh`](../../../scripts/db-restore-rehearsal.sh)
after changing any dump flag or the restore order — it backs up the local stack,
drops the application schema, restores from the dump alone, and diffs row counts
table-by-table, exiting non-zero on any drift.

| Date | Result | Notes |
| --- | --- | --- |
| 2026-08-27 | **PASS** | 24 tables identical row-for-row. `auth.users` restored with `encrypted_password` intact. Took five iterations; each failure was a real defect in the recipe (see #852). Local stack, Postgres 17.6 — same major/minor as staging. Not yet rehearsed against a real Supabase project — unblocked since 2026-08-27, when #1287 provisioned the offsite bucket. |

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

- file the incident notes as a **GitHub issue** — work status is not a doc
  ([`../DOCUMENTATION_CONVENTIONS.md`](../DOCUMENTATION_CONVENTIONS.md#where-a-fact-lives) § Where a fact lives)
- create/update postmortem entry with timeline and root cause
- add preventive checks to migration or CI workflow

## Rollback `idx_audit_log_chapter_action_created_at`

* **Migration**: `20260906120000_audit_log_chapter_action_created_at_idx.sql`
* **Action**: `DROP INDEX IF EXISTS idx_audit_log_chapter_action_created_at;`
* **Note**: Additive index only — no column, constraint or data change, so
  dropping it loses nothing but the optimization. `GET /v1/audit-log`'s `action`
  filter keeps returning identical rows; it falls back to scanning the chapter's
  history in `created_at` order and discarding non-matching rows, which is what
  it did before this migration. The other three indexes on the table are
  untouched, so the actor filter, the date window and the newest-first ordering
  are unaffected. **No API rollback is needed or implied** — nothing in the
  application references the index by name.

## Rollback the ops-setup nudge dismissals

* **Migration**: `20260905030000_member_dismissed_ops_nudges.sql`
  (renamed from `20260905020000_` before merge: #1735 landed
  `20260905020000_point_transactions_client_message_id.sql` on `main` first, and
  Supabase keys `schema_migrations` by the 14-digit prefix, so two files cannot
  share one. Nothing had applied this migration yet, so the rename is free.)
* **Action**: `ALTER TABLE members DROP COLUMN IF EXISTS dismissed_ops_nudges;`
  **Redeploy the web app at the pre-#492 revision first.** The API degrades gracefully
  without it — `mapMembershipSummary` normalizes a missing value to `[]` and
  `MemberService.dismissOpsNudge` reads through `?? []` — but `PATCH
  /v1/members/me/ops-nudges/dismiss` 500s on the write, so with the old column gone and
  the new web build still deployed, every officer's Dismiss click fails silently and the
  card returns on the next refetch. Reads keep working throughout; only the dismissal
  write is lost.
* **Note**: Purely additive — one `text[] not null default '{}'` column. No existing
  column, row, policy, or function is touched, so nothing that predates the migration
  can be lost and rolling back cannot corrupt anything. What it removes is the memory of
  which suggestions an officer has already closed: every eligible chapter's officers see
  the Dues nudge again. Annoying, not damaging, and no data outside this column depends
  on it.
* **Data caveat**: the column is the *only* record of a dismissal — there is no second
  copy and no way to recompute it, because "this officer chose to close this card" is
  not derivable from any other state. Dropping it is therefore lossy in a way the
  additive-column rollbacks above are not, and re-applying the migration brings every
  member back at `'{}'`. If the dismissals matter, snapshot first:
  `CREATE TABLE members_dismissed_ops_nudges_backup AS SELECT id, dismissed_ops_nudges
  FROM members WHERE dismissed_ops_nudges <> '{}';` — that predicate keeps the snapshot
  to the rows that actually carry a choice. Restore with an `UPDATE ... FROM` on `id`.
  The loss is one UI preference per officer, so prefer simply not rolling this back:
  hiding the card is a web-side change (stop rendering `OpsSetupNudge`) that needs no
  migration at all.

## Rollback the chat-archive upload quota

* **Migration**: `20260905010000_discord_import_archive_quota.sql`
* **Action**: `DROP FUNCTION IF EXISTS discord_import_register_files(uuid, uuid, jsonb, bigint, bigint);` and, if you want the index gone too,
  `DROP INDEX IF EXISTS public.idx_discord_import_files_chapter_bytes;`.
  **Redeploy the API at the pre-#1243 revision first, and understand that this one is
  not optional.** The function does not merely *check* the quota, it performs the
  manifest upsert — both import paths register through it and there is no unguarded
  insert left in the repository. With it gone, `POST /v1/discord-imports/{id}/upload-urls`
  500s and the bot worker fails every slice, so **no Discord import can register a file
  at all** by either route. Dropping the index alone is safe at any time and only costs
  the quota sum a heap fetch per row.
* **Note**: Purely additive — one new function, one new index. No table, column, row,
  policy, or existing function body is touched, so nothing that predates the migration
  can be lost, and rolling back cannot corrupt anything. What it removes is the ceiling
  itself: with no quota, one chapter can again register unbounded bytes into
  `chat-archive`, which has no reaper other than the admin's own per-import purge
  (#1246). Prefer raising `MAX_ARCHIVE_IMPORT_BYTES` / `MAX_ARCHIVE_CHAPTER_BYTES` in
  `packages/validation/src/upload-allowlists.ts` — a one-line application change, no
  migration — over rolling this back.
* **Data caveat**: the function writes, so this is not a pure read to drop. It upserts
  `discord_import_files` rows with a **monotonic** `byte_size` (a re-registered path may
  raise its recorded size, never lower it). Rolling back to a plain upsert makes that
  column writable downward again, which is what let a caller erase the accounting for
  objects still in the bucket. No snapshot is needed before dropping and nothing needs
  restoring on re-apply — the totals are recomputed from the manifest on every call —
  but any row whose size was lowered while the old path was live stays lowered.
* **If the quota misfires in production**, the fast forward-fix is the constants, not
  this migration. A chapter wrongly refused reads either `limit for one import` or
  `Delete an old import` in the 400; the first names `MAX_ARCHIVE_IMPORT_BYTES` and the
  second `MAX_ARCHIVE_CHAPTER_BYTES`. Both ship with the API, so the fix is a normal
  deploy.

## Rollback the orphan-president claim flow

* **Migration**: `20260901183000_orphan_president_claim.sql`
* **Action**: `ALTER TABLE chapters DROP COLUMN IF EXISTS needs_president;` drops the flag column; the `claim_presidency` function can be dropped separately if desired (`DROP FUNCTION IF EXISTS claim_presidency(uuid, uuid, text, text);`) but doing so with the column still present is harmless — the function simply becomes unreachable. **Redeploy the API at the pre-#349 revision first**: with the column gone, `RbacService.flagIfPresidentRemoved`'s write fails — `MemberService.remove` has no catch around that call and 500s on every President removal even though the member is already deleted, while `AccountDeletionService.deleteAccount` catches it per-chapter (best-effort by design) and merely logs, so account deletion itself keeps working. Both new `/v1/roles/*` endpoints (`presidency-claim-status`, `claim-presidency`) also read the column and 500 outright without it.
* **Note**: Purely additive — one `boolean not null default false` column plus one new function; no existing column, row, policy, or function body is touched, so nothing that predates the migration can be lost. Dropping it removes the ability to recover a chapter that loses its President outside a voluntary `transfer_presidency` — such a chapter would then have no path back to having a President at all short of a manual `UPDATE members ... role_ids = array_append(...)` by an operator with direct database access. Prefer a forward fix over rolling this back.
* **Data caveat**: `needs_president` is pure derived state (recomputable from "does any member hold the wildcard-carrying President role?"), not a record of anything that happened — no snapshot is needed before dropping, and nothing needs restoring on re-apply. A chapter that was correctly flagged and then had the column dropped simply loses that flag; if it still has no President when the column is re-added, nothing re-flags it automatically (the flag is set only at the moment a President is removed, not on a schedule) — an operator would need to set it by hand: `UPDATE chapters SET needs_president = true WHERE id = '<chapter_id>';`.

## Rollback the `security definer` search_path pin

* **Migration**: `20260827190000_secdef_search_path_pg_temp.sql`
* **Read this first**: rolling this back **reintroduces a security defect** (#985). The
  migration adds nothing and changes no function body — it only appends `pg_temp` to
  the `search_path` of seven `security definer` functions, four of which are
  authorization code (`can_read_chat_message` backs chat RLS; the three
  `realtime_can_read_*_scope` functions gate realtime delivery). Reverting restores the
  state where a caller-created temp table shadows the real table inside those functions
  while they run with the definer's privileges. There is almost never a reason to do
  this; prefer a forward fix.
* **Action**: no function body is needed. `ALTER FUNCTION` changes the setting alone,
  which is why this rollback is trivial and total:
  ```sql
  ALTER FUNCTION public.can_read_chat_message(uuid)            SET search_path TO 'public';
  ALTER FUNCTION public.realtime_can_read_chapter_scope(uuid)  SET search_path TO 'public';
  ALTER FUNCTION public.realtime_can_read_event_scope(uuid)    SET search_path TO 'public';
  ALTER FUNCTION public.realtime_can_read_user_scope(uuid)     SET search_path TO 'public';
  ALTER FUNCTION public.realtime_notify_event_attendance()     SET search_path TO 'public';
  ALTER FUNCTION public.realtime_notify_events()               SET search_path TO 'public';
  ALTER FUNCTION public.realtime_notify_notifications()        SET search_path TO 'public';
  ```
  Re-applying is the same statements with `TO 'public', 'pg_temp'`. Both directions were
  exercised on the local stack.
* **Order**: **no coordination required — deploy in either order.** This is the rare
  purely-additive-to-a-setting change: signatures, return types, and bodies are all
  untouched, so `create or replace` kept every dependent RLS policy and trigger
  resolving, and no API revision can observe the difference. There is no window in which
  a running API sees a shape it does not expect, in either direction.
* **Data caveat**: none. Nothing is written, dropped, or backfilled.
* **CI will stop you.** `scripts/check-pglite-migrations.mjs` asserts every
  `security definer` function in `public` pins `pg_temp` **last** (the
  `=== security definer search_path ===` tier), so a rollback committed as a *migration*
  fails the `pglite-migrations` job by design. An emergency `ALTER` applied directly to a
  hosted database is not caught by CI — if you do that, file the follow-up immediately,
  because the next `db reset` silently re-applies the fix and the two environments drift.
* **Note on order within the pin**: `pg_temp` must be **last**. `search_path = pg_temp,
  public` is not a partial fix, it is the original bug spelled explicitly — the guard
  rejects it for that reason.

## Rollback the `chapter_points_config` table

* **Migration**: `20260902170001_chapter_points_config.sql`
* **Action**:
  ```sql
  DROP TABLE IF EXISTS chapter_points_config;
  ```
  The `updated_at` trigger is defined *on* the table, so it goes with it — no
  separate `DROP TRIGGER`. `update_updated_at()` is shared and must stay.
* **Order**: **redeploy the API first**, to a build from before the migration.
  The two read paths do not degrade the same way, and only one of them is safe:
  * `PointsService.adjustPoints` reads through `ChapterPointsConfigService.getConfig`,
    which **fails open** — it logs a warning and applies the documented defaults
    (50 adjustments/hour, flag at ±100), exactly the constants the service
    hardcoded before [#394](https://github.com/pdcarlson/Frapp/issues/394). Points
    adjustment keeps working through the drop.
  * `GET /chapters/:id/config` reads through `getConfigOrThrow`, which **fails
    closed** by design (it is also the baseline a config PATCH merges onto, so it
    must not invent a prior state). A dropped table is a read error, so that
    endpoint returns **500** — and it backs the whole web Settings page, not just
    points.

  So dropping under a running *post*-migration API leaves the ledger working and
  Settings broken. A build from before the migration never reads the table at all
  and is unaffected either way.
* **One caveat, and it is a security one, not a data one**: the fallback is to the
  *looser* defaults. A chapter that had tightened its limits (say 5 adjustments an
  hour) silently returns to 50/hr and a ±100 flag threshold the moment the table
  goes. Rolling this back **relaxes an anti-fraud control**, so if the rollback is
  itself a response to abuse, restrict `points:adjust` or watch
  `#chapter-audit` until the table is back.
* **Data caveat**: the configured limits themselves are lost. There is no source
  to re-derive them from, but they are recoverable by hand — every change was
  written to `chapter_audit_log` under `action = 'chapter_config_updated'` with a
  `points` key in its `diff`, so the last known value per chapter can be read back
  out of the audit trail.

## Rollback the points ledger idempotency key

* **Migration**: `20260905020000_point_transactions_client_message_id.sql`
* **Action**:
  ```sql
  ALTER TABLE point_transactions DROP COLUMN client_message_id;
  ```
  Dropping the column also drops `idx_point_transactions_dedupe`, which is
  defined on it — no separate `DROP INDEX` needed.
* **Order**: **roll the API back first, then the migration.** This is the one
  coordination point, and it is the opposite of a purely additive column: a
  build from after this migration names `client_message_id` — both in
  `findByClientMessageId` and, unconditionally, in the insert payload
  `adjustPoints` sends — so it errors once the column is gone, where an older
  build never mentions it and is unaffected. Reverting the code first costs
  nothing; reverting the schema first breaks **every** manual point adjustment
  until the deploy catches up, not only the chat-originated ones: the insert
  carries the column name whether or not a key was supplied, so the dashboard
  dialog fails identically and is **not** a working fallback.
* **Data caveat**: rolling back does not corrupt the ledger — the key is
  metadata about *how* a row arrived, never part of the balance — but it
  restores the duplicate-grant exposure of #1719 for as long as it is off. Any
  keys recorded in the meantime are lost, so a retry spanning the rollback
  would be able to double-grant.

## Rollback the `chapter_documents` metadata columns

* **Migration**: `20260831220000_chapter_documents_metadata.sql`
* **Action**:
  ```sql
  ALTER TABLE chapter_documents
    DROP COLUMN content_type,
    DROP COLUMN byte_size,
    DROP COLUMN document_type,
    DROP COLUMN effective_date;
  ```
  Dropping the columns also drops `chapter_documents_byte_size_nonneg`, which is
  defined on `byte_size` — no separate `DROP CONSTRAINT` needed.
* **Order**: no coordination required — the four columns are purely additive and
  nullable. A running API build from before this migration selects `*` and simply
  never reads the new keys; a build from after this migration reverted still reads
  `null` for them (the service already treats every one of the four as optional).
* **Data caveat**: the four columns are populated only for documents uploaded
  after this migration landed. Rolling back loses that metadata for any document
  uploaded in between — there is no source to re-derive it from (the client
  supplied `content_type`/`byte_size` at upload time; `document_type`/
  `effective_date` were free-text form input). Confirm nothing downstream (a
  retrieval index, a report) depends on that window's values before dropping.

## Rollback the chat author fields

* **Migration**: `20260823120000_chat_message_authors.sql`
* **Action**:
  ```sql
  -- 1. the index shape (safe any time)
  DROP INDEX IF EXISTS public.idx_chat_messages_author_external;
  DROP INDEX IF EXISTS public.idx_chat_messages_dedupe;
  CREATE UNIQUE INDEX idx_chat_messages_dedupe
    ON public.chat_messages (channel_id, sender_id, client_message_id)
    WHERE client_message_id IS NOT NULL;

  -- 2. the constraint
  ALTER TABLE public.chat_messages DROP CONSTRAINT IF EXISTS chat_messages_author_present;

  -- 3. the columns
  ALTER TABLE public.chat_messages
    DROP COLUMN IF EXISTS author_name,
    DROP COLUMN IF EXISTS author_avatar_path,
    DROP COLUMN IF EXISTS author_external_id;

  -- 4. the NOT NULL — READ THE CAVEAT FIRST
  ALTER TABLE public.chat_messages ALTER COLUMN sender_id SET NOT NULL;
  ```
* **Order**: **redeploy the API first.** `ChatMessage.sender_id` is `string | null`
  on the post-change revision and both clients resolve the label through
  `resolveAuthorLabel`; dropping the columns under a running API is survivable
  (they are all optional reads) but re-adding `NOT NULL` under one that permits
  nulls is not.
* **Step 4 fails if any imported row exists**, and that is the useful behaviour:
  `SET NOT NULL` scans the table and raises `23502` on the first null sender. If
  it fails, the archive is still in the database and the rollback is incomplete
  by definition — decide whether to delete the imported rows
  (`DELETE FROM chat_messages WHERE kind = 'imported';`, which cascades to
  `chat_message_attachments`) or to stop at step 3 and leave the column nullable.
  **Leaving it nullable is almost always right**: a nullable column with no null
  rows costs nothing and breaks nothing.
* **Data caveat**: dropping `author_name` is **not recoverable by re-applying**.
  It is the only attribution an imported message has — there is no `users` row to
  join back to, which is the whole reason the column exists. Re-running the
  importer from the original DiscordChatExporter export is the only way back.
* **The dedupe-index bullet that used to live here is superseded.** It said
  dropping `NULLS NOT DISTINCT` while imported rows exist would let the next
  importer run insert the whole archive again. That stopped being true when
  `20260824120000_discord_import.sql` moved the importer onto its own
  `external_message_id` column and its own index: imported rows no longer set
  `client_message_id` at all, so this index does not govern them either way. The
  index whose loss duplicates an archive is now
  **`idx_chat_messages_external_dedupe`** — see *Rollback the Discord importer*
  below. The recreate above is safe as written.

## Rollback the Discord connect confirmation

* **Migration**: `20260824150000_discord_connect_confirm.sql`
* **Action**:
  ```sql
  DROP INDEX IF EXISTS public.idx_discord_oauth_states_confirm_token;
  ALTER TABLE public.discord_oauth_states
    DROP COLUMN IF EXISTS pending_guild_id,
    DROP COLUMN IF EXISTS pending_guild_name,
    DROP COLUMN IF EXISTS pending_guild_icon,
    DROP COLUMN IF EXISTS pending_discord_user_id,
    DROP COLUMN IF EXISTS pending_discord_username,
    DROP COLUMN IF EXISTS pending_permissions,
    DROP COLUMN IF EXISTS pending_scopes,
    DROP COLUMN IF EXISTS confirm_token,
    DROP COLUMN IF EXISTS confirm_expires_at,
    DROP COLUMN IF EXISTS confirmed_at;
  ```
* **Order**: **redeploy the API first**, and understand what you are removing
  before you do. These columns are not bookkeeping — they are the confirmation
  step, and the confirmation step is the control that keeps one chapter from
  reading another Discord server's history.
* **This rollback re-opens a known cross-tenant hole.** Without the confirm
  step, the OAuth callback binds a guild to whichever chapter minted the
  `state` — and minting one is an ordinary action for any `channels:manage`
  holder in any chapter. An officer can then send their own authorize link to an
  admin of any Discord server, and if that person clicks through Discord's
  genuine consent screen, their server is readable by the sender's chapter.
  Every Discord-side check still passes; that is what makes it a confused-deputy
  bug rather than a broken check. **If you roll this back, unset
  `DISCORD_CLIENT_ID` / `DISCORD_CLIENT_SECRET` in the same change** so
  `GET /v1/discord/availability` answers `false` and the connect flow is
  unreachable. The DiscordChatExporter upload path is unaffected either way.
* **Nothing already connected is lost.** `discord_connections` is a separate
  table and is untouched — existing links keep working and imports keep running.
  Only *new* connections are affected.
* **In-flight handshakes are collateral, and cheap.** Any admin mid-connect
  loses their click and retries; every row here is single-use and dead within
  fifteen minutes anyway.

## Rollback the Discord bot connection

* **Migration**: `20260824140000_discord_bot_connection.sql`
* **Action**:
  ```sql
  -- 1. the connection tables (safe any time; nothing else references them)
  DROP TABLE IF EXISTS public.discord_oauth_states;
  DROP TABLE IF EXISTS public.discord_connections;

  -- 2. the per-channel bot columns
  DROP INDEX IF EXISTS public.idx_discord_import_channels_order;
  ALTER TABLE public.discord_import_channels
    DROP COLUMN IF EXISTS cursor_before_snowflake,
    DROP COLUMN IF EXISTS parent_discord_channel_id,
    DROP COLUMN IF EXISTS position;

  -- 3. the source discriminator — READ THE CAVEAT FIRST
  ALTER TABLE public.discord_imports
    DROP CONSTRAINT IF EXISTS discord_imports_source_check;
  ALTER TABLE public.discord_imports DROP COLUMN IF EXISTS source;
  ```
* **Order**: **redeploy the API first.** `DiscordImportWorkerService.sweepImports`
  reads `job.source` on every tick to decide which slice runs, and
  `DiscordExportWorkerService` reads `discord_connections` on every slice.
  Dropping either under a running worker fails the sweep once a minute, forever.
* **Step 3 is the one that bites, and it is worse than it looks.** `source` is
  what tells the sweeper a job reads Discord rather than an uploaded export.
  Drop it while a bot import is `ready` or `running` and the column's absence
  does not stop the job — it makes every remaining tick hand that job to
  `runImportSlice`, which looks for uploaded export parts, finds none, and marks
  the import `completed` having imported nothing further. A half-imported
  channel is then indistinguishable from a finished one. **Cancel or purge every
  `source = 'bot'` import before rolling this back**:
  `SELECT id, status FROM discord_imports WHERE source = 'bot' AND status IN ('ready','running');`
* **Losing `discord_connections` does not lose imported history.** It only
  forgets which Discord server a chapter linked, so no *further* bot import can
  start. Messages already imported are ordinary `kind = 'imported'` rows and are
  purged the same way as any other import — see *Rollback the Discord importer*
  below. Reconnecting is one pass through the wizard, so this table is cheap to
  lose and is deliberately not backed up separately.
* **`discord_oauth_states` is disposable by construction.** Every row is
  single-use and expires within 15 minutes; dropping it mid-flight costs at most
  one admin an in-progress "Connect Discord" click, which they retry.
* **Data caveat**: dropping `cursor_before_snowflake` loses per-channel resume
  position, not data. A resumed import re-reads the channel from its newest
  message; `idx_chat_messages_external_dedupe` makes the replayed rows a no-op,
  so the cost is Discord API calls and wall-clock, never duplicate messages.
  Dropping `parent_discord_channel_id` is worse in kind: thread rows then have
  no parent to inherit a destination from, and a re-run resolves each thread
  independently — which, under `create_new`, mints one identically-named channel
  per thread (`chat_channels` has no unique `(chapter_id, name)`). **Do not drop
  it while a bot import is mid-flight.**
* **The bot itself is not rolled back by any of this.** The Signet Discord
  application stays installed in every chapter's server until someone removes it
  there, and `DISCORD_BOT_TOKEN` keeps working. If the rollback is a response to
  a security incident, rotate the token in Infisical — that is what actually
  revokes access, not this migration.

## Rollback the Discord importer

* **Migration**: `20260824120000_discord_import.sql`
* **Action**:
  ```sql
  -- 1. the job tables (safe any time; nothing else references them)
  DROP TABLE IF EXISTS public.discord_import_files;
  DROP TABLE IF EXISTS public.discord_import_channels;
  DROP TABLE IF EXISTS public.discord_imports;

  -- 2. the indexes
  DROP INDEX IF EXISTS public.idx_chat_messages_discord_import;
  DROP INDEX IF EXISTS public.idx_chat_messages_external_dedupe;

  -- 3. the column — READ BOTH CAVEATS FIRST
  ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS external_message_id;
  ```
* **Order**: **redeploy the API first.** The importer writes
  `external_message_id` on every row it inserts; dropping the column under a
  running importer fails every insert mid-archive and leaves a half-imported
  channel behind.
* **Step 3 destroys re-run idempotency, and this is the one that bites.** The
  column is the *only* thing that makes a second import of the same export a
  no-op. Drop it while an archive is in the database and the next run inserts
  every message a second time, silently — `client_message_id` will not catch it,
  because imported rows do not set it. If any imported row exists, stop at step
  2 and leave the column: a nullable column costs nothing.
* **Losing the job tables loses the purge.** `discord_imports` is what
  `DELETE /v1/discord-imports/{id}` walks to find the messages and the storage
  objects belonging to one import. Dropping it strands both — the rows stay
  readable in chat, and the `chat-archive` objects are orphaned with nothing left
  to name them (no chapter-deletion path exists, and nothing else sweeps that
  bucket). **Purge any unwanted imports before rolling this back**, not after.
* **Data caveat**: `metadata->>'discord_import_id'` survives on the message rows
  independently of these tables, so a hand-written purge is still possible:
  `DELETE FROM chat_messages WHERE kind = 'imported' AND metadata->>'discord_import_id' = '<id>';`
  cascades to `chat_message_attachments`. The storage objects under
  `chapters/<chapter>/chat-archive/imports/<id>/` must be deleted separately —
  no cascade reaches storage.

## Rollback chat attachments

* **Migration**: `20260823121000_chat_message_attachments.sql`
* **Action**: `DROP TABLE IF EXISTS public.chat_message_attachments;`
* **Order**: **redeploy the API first.** `ChatService.sendMessage` writes
  attachment rows and `GET /v1/channels/{id}/messages/{messageId}/attachments`
  reads them; dropping the table under a running post-change API makes any send
  carrying a file 500 and the attachments route 500 on every call.
* **The body rewrite is reversible, and this is how.** The migration stripped
  `📎 <name> (<storagePath>)` out of `chat_messages.content` after copying the
  filename and path into rows. Re-append them **before** dropping the table:
  ```sql
  UPDATE chat_messages m
  SET content = btrim(m.content || E'\n' || x.sigils)
  FROM (
    SELECT a.message_id,
           string_agg('📎 ' || a.filename || ' (' || a.storage_path || ')', E'\n'
                      ORDER BY a.created_at) AS sigils
    FROM chat_message_attachments a
    GROUP BY a.message_id
  ) x
  WHERE m.id = x.message_id;

  UPDATE chat_messages
  SET metadata = metadata - 'attachment_count'
  WHERE metadata ? 'attachment_count';
  ```
  Rows written *after* the migration are also restored by this — they were never
  in the sigil format, but the pre-change composer produced exactly that format,
  so the result is what a pre-change client would have sent.
* **Data caveat**: dropping the table without running the restore above loses the
  link between every message and its file. **The objects themselves are not
  touched** — they stay in the `chat` bucket under
  `chapters/{chapter_id}/chat/{channel_id}/{…}/{filename}` — so nothing is
  destroyed, but nothing points at them either.
* **Lighter option**: the table is additive and read only through one route. To
  stop attachments being written without touching the schema, redeploy the API at
  the pre-change revision; existing rows are then simply unread.

## Rollback chat message search

* **Migration**: `20260823122000_chat_message_search_vector.sql`
* **Action**:
  ```sql
  DROP INDEX IF EXISTS public.idx_chat_messages_content_search;
  ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS content_search;
  ```
* **Order**: **redeploy the API first, then the database.** `SearchService`
  queries the column by name via `.textSearch('content_search', …)`, so dropping
  it under a running post-change API turns `GET /v1/search` into a 500 on every
  request — PostgREST `42703 column "content_search" does not exist`. The
  pre-change revision uses `ILIKE` and does not reference the column at all.
* **Note**: **nothing is lost.** The column is `GENERATED ALWAYS ... STORED` and
  derived entirely from `content`, so re-applying the migration reconstructs it
  exactly. This is the cheapest rollback in this file to reverse.
* **Locks**: dropping the column is a catalog operation and does not rewrite the
  heap. **Re-applying is the expensive direction** — the generated column
  materialises per row under ACCESS EXCLUSIVE. If the archive has already been
  imported, treat a re-apply as a scheduled maintenance window, not a hotfix.
* **Lighter option**: if the problem is search *results* rather than the schema
  (stemming surprises, an unexpected match), revert only the service change and
  leave the column and index in place. They cost writes on insert and nothing on
  read, and they will be needed again.

## Rollback the chat per-kind notification upsert target

* **Migration**: `20260902170000_chat_notif_prefs_kind_upsert_target.sql`
* **Action**:
  ```sql
  DROP INDEX IF EXISTS public.idx_chat_notif_prefs_kind_unique;
  ```
* **Order**: **redeploy the API first, then the database.** Same shape as the
  channel entry below. The index exists so
  `PUT /v1/channels/notification-preferences/kinds/:kind` can name it as an
  `ON CONFLICT` target; dropping it under a running post-change API makes every
  per-kind write fail with `42P10 there is no unique or exclusion constraint
  matching the ON CONFLICT specification`. The pre-change revision has no
  per-kind write path at all and does not reference it.
* **Note**: **nothing is lost, and no constraint is loosened.** Additive, and it
  duplicates for the `kind` arm only an invariant `idx_chat_notif_prefs_unique`
  (20260527120000) already enforces on both arms. Dropping it leaves the
  original expression index in place, so a duplicate (user, chapter, kind)
  preference row still cannot be created. Channel-scoped writes are unaffected —
  they target `idx_chat_notif_prefs_channel_unique`, a different index.
* **Locks**: `create index` holds SHARE on `chat_notification_preferences` for
  its duration; the table holds at most one row per user per scope key they have
  deliberately configured, so it is small everywhere. Dropping is a catalog
  operation.
* **Why a third index**, when one already looks close enough: the channel index
  is on `scope_id`, which is NULL on every `kind` row, and unique indexes treat
  NULLs as distinct — so it constrains the kind arm not at all and cannot be an
  `ON CONFLICT` target for it. `check:pglite-migrations` asserts both plain
  indexes exist with the right shape, so the *migration set* is gated rather
  than resting on a one-time manual observation: deleting or weakening either
  migration file fails CI.
* **That gate does not watch a live database.** It replays
  `supabase/migrations/*.sql` into a fresh in-process PGlite, so a `DROP INDEX`
  executed against staging or production is invisible to it — CI stays green
  while the endpoint 500s. Performing the rollback above therefore requires
  reverting the API yourself, in the stated order; nothing will catch it for
  you.

## Rollback the chat-mute upsert target

* **Migration**: `20260829011200_chat_notif_prefs_channel_upsert_target.sql`
* **Action**:
  ```sql
  DROP INDEX IF EXISTS public.idx_chat_notif_prefs_channel_unique;
  ```
* **Order**: **redeploy the API first, then the database.** The index exists so
  `PUT /v1/channels/:id/notification-preference` can name it as an `ON CONFLICT`
  target; dropping it under a running post-change API makes every mute write
  fail with `42P10 there is no unique or exclusion constraint matching the ON
  CONFLICT specification`. The pre-change revision has no write path at all and
  does not reference it.
* **Note**: **nothing is lost, and no constraint is loosened.** This index is
  additive and duplicates, for the `channel` arm only, an invariant that
  `idx_chat_notif_prefs_unique` (20260527120000) already enforces on both arms.
  Dropping it leaves the original expression index in place, so a duplicate
  (user, chapter, channel) preference row still cannot be created.
* **Locks**: `create index` holds SHARE on `chat_notification_preferences` for
  its duration; the table holds at most one row per user per channel they have
  deliberately configured, so it is small everywhere. Dropping is a catalog
  operation.
* **Why it exists at all**, since a second unique index on nearly the same
  columns looks redundant: the original is an *expression* index
  (`coalesce(scope_id::text, scope_kind)`), and PostgREST's `on_conflict` takes
  column names only. There is no way to target the original from the API. The
  alternatives were a read-then-write in the service, which races two concurrent
  mutes into a duplicate-key error, or an RPC wrapping the expression form.

## Rollback backwork/events/members search vectors

* **Migration**: `20260829002000_search_vectors_backwork_events_members.sql`
* **Action**:
  ```sql
  DROP INDEX IF EXISTS public.idx_backwork_resources_search;
  DROP INDEX IF EXISTS public.idx_events_search;
  DROP INDEX IF EXISTS public.idx_users_display_name_search;
  ALTER TABLE public.backwork_resources DROP COLUMN IF EXISTS search_vector;
  ALTER TABLE public.events             DROP COLUMN IF EXISTS search_vector;
  ALTER TABLE public.users              DROP COLUMN IF EXISTS display_name_search;
  ```
  Dropping a column drops its index too; the explicit `DROP INDEX` lines are for
  a partial apply where the column never landed.
* **Order**: **redeploy the API first, then the database** — same rule and same
  reason as the chat entry above. `SearchService` names all three columns
  (`.textSearch('search_vector', …)` for backwork and events,
  `.textSearch('users.display_name_search', …)` for members), so dropping them
  under a running post-change API turns `GET /v1/search` into a 500 on every
  request: PostgREST `42703 column "…" does not exist`. The pre-change revision
  uses `ILIKE` and references none of them.
* **Note**: **nothing is lost.** All three are `GENERATED ALWAYS ... STORED` and
  derived entirely from columns that remain (`title`/`course_number`,
  `name`/`description`, `display_name`), so re-applying reconstructs them
  exactly.
* **Member search is the one behavioural difference to expect on rollback.** The
  pre-change revision fetches the whole chapter roster and filters it in memory
  (#1085). Rolling back restores that cost, so a rollback on a large chapter
  makes member search slow rather than broken — do not read the latency as a
  failed rollback.
* **Locks**: dropping is a catalog operation and does not rewrite the heap.
  **Re-applying is the expensive direction** — each generated column materialises
  per row under ACCESS EXCLUSIVE, and the GIN build that follows holds SHARE.
  `users` is the one to schedule around: it is **global**, so its rewrite blocks
  writes for every chapter at once, not just the one that prompted the rollback.
* **Lighter option**: if the problem is search *results* rather than the schema
  (stemming surprises — `Budget` matches `Budgetson` but `udgets` no longer
  does), revert only the service change and leave the columns and indexes in
  place. They cost writes on insert and nothing on read, and they will be needed
  again.
* **If you roll back the service but keep the schema**, also revert
  `EVENT_SEARCH_COLUMNS` / `BACKWORK_SEARCH_COLUMNS` together with it: the
  `check-pglite-migrations.mjs` landmark asserts those lists match their table's
  columns minus the tsvector, so a half-revert fails that gate.

## Rollback the imported-kind semantics

* **Migration**: `20260823123000_chat_imported_kind_semantics.sql`
* **Action**: restore the previous function body and policy, both of which are
  the versions in `20260816190000_chat_unread_and_mentions.sql` and
  `20260816140000_realtime_carrier_repair.sql` respectively. Copy them from those
  files rather than retyping — the grant block and the `search_path` pin matter.
* **Order**: no coordinated redeploy needed; nothing in the API reads either the
  function body or the policy text.
* **⚠️ Do not roll this back while imported rows exist in a chapter people are
  using.** Both halves are guardrails, and both fail loudly in the same
  direction:
  * Restoring the old unread function re-introduces `m.sender_id <> p_user_id`,
    which excludes imported rows only as an artefact of `NULL <> uuid` being
    NULL. That still *works*, so this half is safe — but it is the trap the
    migration exists to remove, so re-read the promotion entry before deciding
    the null-safety looks wrong.
  * Restoring the old policy removes `kind <> 'imported'`, which is the Realtime
    fan-out control. Every archived message in the database immediately becomes
    eligible to be delivered as a `postgres_changes` frame — not retroactively
    (Realtime reads the WAL, not the table), but any subsequent write or
    re-import fans out per row to every connected client with no batching.
* **Verification after rollback**:
  `select pg_get_expr(polqual, polrelid) from pg_policy p join pg_class c on c.oid=p.polrelid where c.relname='chat_messages';`
  should be back to two conjuncts, and
  `npm run check:pglite-migrations` will fail its tightened landmark — which is
  correct and is your signal that the rollback also needs the landmark relaxed.
* **Lighter option**: to stop *only* the badge behaviour without touching the
  policy, `create or replace` the function with just the `kind` clause removed.
  The two rules are independent by design.

## Rollback the chat-archive bucket

* **Migration**: `20260823124000_chat_archive_bucket.sql`
* **Action**:
  ```sql
  -- Only when the bucket is empty; Storage refuses to drop a bucket with objects.
  DELETE FROM storage.buckets WHERE id = 'chat-archive';
  ```
* **Order**: no coordinated redeploy required *if the bucket is unused*. Once an
  import has run, the objects in it are the only copy of the archive's media —
  `chat_message_attachments.external_url` is **always null** for imported rows (the importer never contacts Discord, so there is no CDN link to keep) and the only recovery handle is `discord_import_files` plus the admin's original export — so
  treat deletion as destructive.
* **Note**: additive bucket only. Nothing else references it, and the live `chat`
  bucket is untouched. Re-applying the migration recreates it with the same id
  and constraints; the objects are not restored by that.
* **Also revert `supabase/config.toml`** if you are rolling back the whole slice:
  the global local-stack `[storage] file_size_limit` was raised from `26214400`
  to `104857600`. Leaving it raised is harmless — every member-upload bucket is
  still pinned to 25 MB by its own `allowed_mime_types`/`file_size_limit` columns
  and by `MAX_UPLOAD_BYTES` in `@repo/validation`.
* **Lighter option**: to stop new writes without deleting anything, revert the API
  and leave the bucket in place. An unused private bucket costs storage for what
  is in it and nothing else.

## Rollback the Realtime carrier repair

* **Migration**: `20260816140000_realtime_carrier_repair.sql`
* **Action**: everything this migration creates is additive and separately droppable. Full revert:
  ```sql
  -- 1. stop the change pings
  DROP TRIGGER IF EXISTS realtime_notify_notifications    ON public.notifications;
  DROP TRIGGER IF EXISTS realtime_notify_events           ON public.events;
  DROP TRIGGER IF EXISTS realtime_notify_event_attendance ON public.event_attendance;
  DROP FUNCTION IF EXISTS public.realtime_notify_notifications();
  DROP FUNCTION IF EXISTS public.realtime_notify_events();
  DROP FUNCTION IF EXISTS public.realtime_notify_event_attendance();

  -- 2. de-authorise the private topics
  DROP POLICY IF EXISTS "realtime_messages_scoped_select" ON realtime.messages;
  DROP FUNCTION IF EXISTS public.realtime_can_read_user_scope(uuid);
  DROP FUNCTION IF EXISTS public.realtime_can_read_chapter_scope(uuid);
  DROP FUNCTION IF EXISTS public.realtime_can_read_event_scope(uuid);

  -- 3. un-publish chat and re-close the table
  ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_messages;
  ALTER PUBLICATION supabase_realtime DROP TABLE public.chat_message_actions;
  DROP POLICY IF EXISTS "chat_messages_select" ON public.chat_messages;
  ```
  **Order matters in one direction only, and it is the harmless one.** Rolling the database back without redeploying the web app does not error: the three dashboard subscriptions simply stop receiving pings (a private channel with no authorising policy is denied), and chat's `postgres_changes` handler goes quiet. That is *precisely* the pre-migration behavior — see the note below — so a DB-only rollback degrades to "realtime never worked", which is where `main` sat before this landed. There is no 500, no broken route, and no user-visible error; only staleness until a manual refresh.
* **Note**: **rolling back does not re-open a vulnerability — it narrows access.** The only widening this migration performs is the `chat_messages_select` policy, which lets the browser read `chat_messages` scoped to channel membership (mirroring the precedent `chat_message_actions` already set). Dropping it returns the table to default-deny. The `realtime.messages` policy is likewise purely additive: that table had RLS on with *no* policy, denying every private channel, and this migration grants exactly three topic families. Nothing predating the migration can be lost — no column, constraint, or row is touched anywhere.
* **Prefer a roll-forward fix anyway.** Reverting restores the #867 defect in full: every `postgres_changes` subscription in the product receives nothing, in every environment, and does so *silently* — the channel joins, reports `SUBSCRIBED`, and never fires, which is indistinguishable from an idle one. That silence is what hid the bug from the first deploy until 2026-08-16. If you roll this back, say so loudly somewhere a human reads, because nothing in the app will tell you.
* **Data caveat**: none. This migration stores no data. `realtime.messages` rows are ephemeral broadcast envelopes, partitioned by day and pruned by Realtime itself, and the pings carry only `{table, op}` — no row content — so there is nothing to snapshot before dropping and nothing to reconstruct after re-applying. Re-applying is fully idempotent: every block is guarded (`pg_publication_tables` membership, `pg_policies` existence, `create or replace` on the functions, `drop trigger if exists` before each `create trigger`).
* **Partial rollback to avoid**: dropping `chat_messages_select` while leaving `chat_messages` in the publication. Realtime enforces RLS per subscriber, so the table stays replicated but every subscriber is denied — the WAL work is done and thrown away. If you want chat off, drop it from the publication too.

## Rollback the ping-swallow warning

* **Migration**: `20260901170000_realtime_ping_swallow_warning.sql`
* **Read this first**: rolling this back **reintroduces the silent-swallow gap** (#978). The
  migration changes nothing about the swallow's guarantee (writes still succeed when
  `realtime.send` fails) or the trigger signatures — it only replaces `null;` with a `raise
  warning` carrying the table, topic and `SQLERRM` inside each of the three ping triggers'
  exception handlers. Reverting restores the state where a sustained `realtime.send` failure
  (partition lag, a Realtime grant change) is invisible until someone reports "the dashboard
  feels stale". There is almost never a reason to do this; prefer a forward fix.
* **Action**: `create or replace` back to a bare swallow:
  ```sql
  CREATE OR REPLACE FUNCTION public.realtime_notify_notifications() ... AS $$
  ...
  exception when others then
    null;
  end;
  ...
  ```
  (same shape for `realtime_notify_events` and `realtime_notify_event_attendance`; copy the
  bodies from `20260827190000_secdef_search_path_pg_temp.sql`, which has the last `null;`-only
  definitions.)
* **Order**: no coordination required — deploy in either order. Signature, return type and the
  swallow's write-survival guarantee are all unchanged, so no running API can observe the
  difference either way.
* **Data caveat**: none. Nothing is written, dropped, or backfilled; `raise warning` does not
  affect the surrounding transaction.
* **CI will stop you.** `scripts/check-pglite-migrations.mjs`'s "Functional smoke" tier asserts
  each of the three ping tables raises an observable `WARNING` when `realtime.send` fails (PGlite
  has no `realtime` schema, so every write there already exercises the swallow) — a rollback
  committed as a *migration* fails the `pglite-migrations` job by design.

## Rollback the chat unread/mention slice

* **Migration**: `20260816190000_chat_unread_and_mentions.sql`
* **Action**: everything it adds is separately droppable.
  ```sql
  -- 1. the read path (drop this AFTER the API is back on a pre-C1 revision)
  DROP FUNCTION IF EXISTS public.get_channel_unread_counts(uuid, uuid);

  -- 2. the index
  DROP INDEX IF EXISTS public.idx_channel_read_receipts_user;

  -- 3. the column — see the data caveat before running this one
  ALTER TABLE public.chat_messages DROP COLUMN IF EXISTS mentions;
  ```
* **Order**: **redeploy the API first, then the database. Do not skip this.** This is the coordinated shape, not the additive one, and the column matters more than the function:
  * **`chat_messages.mentions` is written on every send.** `ChatService.sendMessage` includes `mentions` in every insert unconditionally, and `editMessage` in every update. Dropping the column under a running C1 API therefore fails **every chat message in the product, chapter-wide**, with PostgREST `42703 column "mentions" does not exist` — not a degraded badge, a dead send button.
  * `GET /v1/channels/unread` calls the function directly, so dropping that turns the route into a 500 on every request. This is the smaller half: as of this migration the endpoint exists but no client consumes it yet (the mobile channel list and the web badge land later in C1).

  Roll the API back to a pre-C1 revision first and both disappear with it; then the DB drop is unobserved. If you only remember one thing here: the "no client consumes it yet" note applies to the *endpoint*, never to the column.
* **Note**: the `mentions` half degrades gracefully in *both* directions, which is worth knowing before you panic. The push worker reads `row.mentions ?? []`, so a missing column simply means no message is ever treated as a mention — the same behavior the product had before this migration, since the worker was previously casting over a column that never existed and always resolving to empty. Dropping the column cannot therefore break push; it only returns the `mentions` tier to never firing.
* **Data caveat**: **dropping the column is not recoverable by re-applying.** `mentions` is resolved at send time against chapter membership as it stood at that moment, so re-adding the column gives every historical message an empty array. The raw `@`-text survives in `content`, so a backfill is *possible*, but it would resolve against today's membership — a member who has since left, been renamed, or whose display name now collides with another's would resolve differently or not at all. If you only need to stop a bad mention resolution rather than remove the feature, `UPDATE chat_messages SET mentions = '{}'` on the affected rows and leave the schema alone.
* **Lighter option**: to stop the badges without touching the schema, revert the client. The counts are read-only and computed on demand — no writes, no background job, nothing accruing — so an unused function and an unread column cost essentially nothing to leave in place. There is no index on `chat_messages` to pay for — see below.
* **Do not "restore" an index on `chat_messages.mentions`.** An earlier draft of this migration created a GIN index there and it was removed deliberately, so its absence is not an oversight to correct during a rollback. The mention tally is computed inside an aggregate `filter (where ...)`, which is not a row-selection predicate, so the planner cannot consult an index for it at all — the plan is a seq scan with the index present and without it. Adding one back buys nothing and costs write amplification on the product's hottest insert path. If a future *row-predicate* query needs it (a "my mentions" inbox), it must be spelled `mentions @> array[$1]`, which GIN can serve; the equivalent-looking `$1 = any (mentions)` cannot and seq-scans regardless.

## Rollback the activation funnel table

* **Migration**: `20260809001500_chapter_activation_milestones.sql`
* **Action**: `DROP TABLE IF EXISTS chapter_activation_milestones;`
* **Order**: Unusually, **no coordinated redeploy is required**. `ActivationService.record` wraps its whole body in a catch and every one of the seven call sites ignores the result, so a missing table degrades to "no milestones recorded, one logged error per action" rather than a failed checkout, invite, or message send. Redeploy the API at the pre-#267 revision if you want the log noise to stop.
* **Note**: Additive table only; nothing else references it, so dropping loses just the funnel ledger. **The loss is not recoverable by re-applying** — the table records *when a chapter first did something*, and that history cannot be reconstructed after the fact (the source events are spread across `chapters`, `invites`, `chat_messages` and Stripe, and none of them record "this was the first"). If the concern is a single wrong row rather than the feature, delete that row instead: the next matching action will re-record the milestone naturally.
* **Lighter option**: to stop emission without touching the schema, unset `POSTHOG_API_KEY` — the no-op provider takes over and the rows keep accruing for later analysis.

## Rollback durable Stripe webhook idempotency

* **Migration**: `20260805150000_stripe_webhook_events.sql`
* **Action**: Redeploy the API at the pre-FRA-23 revision **first** — the post-FRA-23 `BillingService` claims every side-effecting event and 500s on `POST /v1/webhooks/stripe` if the table or function is gone, which makes Stripe retry the same events for days. Then `DROP FUNCTION IF EXISTS public.claim_stripe_webhook_event(text, text, integer); DROP TABLE IF EXISTS stripe_webhook_events;`.
* **Note**: Additive table + function only; nothing else references them, so dropping loses only the delivery ledger. Behaviour reverts to the in-memory `Set` — dedup within one process, and a replay after any restart re-applies the event. No backfill on re-apply; the table refills from the next deliveries.
* **Lighter option — usually the right one**: if the goal is just to unstick a specific event rather than remove the feature, do not drop anything. `update stripe_webhook_events set status = 'failed' where event_id = 'evt_…';` makes it immediately re-claimable on Stripe's next retry, and `select event_id, event_type, status, attempts, last_error from stripe_webhook_events where status <> 'processed' order by claimed_at desc;` lists everything currently stuck or failing.

## Rollback study-session pause + grace window

* **Migration**: `20260807150000_study_session_pause_grace.sql`
* **Action**: drop both columns; each is referenced only by the study feature.
  ```sql
  ALTER TABLE study_sessions  DROP COLUMN IF EXISTS paused_at;
  ALTER TABLE study_geofences DROP COLUMN IF EXISTS pause_grace_minutes;
  ```
  **Redeploy the API at the pre-FRA-232 revision first.** The post-FRA-232 `StudyService` *inserts* `paused_at` on every `startSession` and selects it on every heartbeat, and `createGeofence` inserts `pause_grace_minutes` — with the columns gone, starting a session and creating a study zone both 500 outright. `POST /v1/study-sessions/pause` and `/resume` disappear with that redeploy, and the web study page calls them on every tab hide/show, so roll the web app back in the same window or members see a paused session they cannot resume.
* **Note**: Additive DDL only (two nullable-or-defaulted columns); no existing column, constraint, index, or policy is altered, and `PAUSED_EXPIRED` was already permitted by the original `status` CHECK, so that constraint is untouched by both apply and rollback. Rolling back **re-opens the hole this migration closed** (FRA-232): with no pause signal the server cannot distinguish "app backgrounded" from "heartbeat in flight" and credits the whole gap between heartbeats as foreground study time, so members earn points for time they were not studying. Prefer a roll-forward fix.
* **Data caveat**: `paused_at` is live state, not history — dropping it strands any session that is paused *at that moment*. Those rows keep `status = 'ACTIVE'`, so the one-active-session rule blocks the member from starting a new session, and with the column gone nothing can ever expire them. Settle them **before** dropping:
  ```sql
  -- Inspect first; then close them out as if the grace window lapsed.
  SELECT id, user_id, chapter_id, total_foreground_minutes, paused_at
    FROM study_sessions WHERE paused_at IS NOT NULL AND status = 'ACTIVE';
  UPDATE study_sessions
     SET status = 'PAUSED_EXPIRED', end_time = paused_at
   WHERE paused_at IS NOT NULL AND status = 'ACTIVE';
  ```
  The `status = 'ACTIVE'` filter is load-bearing, not defensive: a session that ended as `EXPIRED` from the paused branch (an out-of-polygon fix on an implicit or explicit resume, `#313`) keeps its `paused_at` (nothing clears it, and the row is never re-read because `findActiveByUserAndChapter` filters on `ACTIVE`). Without the filter this statement rewrites those finished sessions to `PAUSED_EXPIRED` and backdates their `end_time` — verified by running the unfiltered form against a live database.
  Points for those sessions are **not** awarded by this statement — the award runs in application code. Reconcile manually against `point_transactions` if any settled session cleared its zone's `min_session_minutes`.
  Historical rows already in a terminal state lose nothing: `total_foreground_minutes`, `end_time`, and `status` (including `PAUSED_EXPIRED`) all survive, so past sessions and awarded points stay intact and readable. `pause_grace_minutes` is per-zone config; on re-apply every zone returns to the default 5 and any chapter that had tuned its window must set it again — snapshot `select id, chapter_id, name, pause_grace_minutes from study_geofences` first if any zone has been customized.

## Rollback ROLE_GATED `required_permissions`

* **Migration**: `20260807220000_role_gated_required_permissions.sql`
* **Action**: there is no DDL to undo — the migration only populates an existing nullable column and replaces one function. To restore the previous read semantics, re-apply the **prior** definition of `public.can_read_chat_message` from `20260803150000_chat_message_actions_membership_rls.sql` verbatim (it is `create or replace`, so re-running that file's function block is the rollback). The backfilled `required_permissions` values can stay: under the old predicate an explicit `{members:view}` behaves the same as the empty list it replaced, since every seeded role holds `members:view`.
  **Redeploy the API at the pre-FRA-321 revision first**, or the app-layer predicate keeps denying empty-gated channels while the SQL one allows them — the same split this migration exists to prevent, just inverted.
  To revert only the seeded `#alumni` marker and re-open alumni posting to every ROLE_GATED channel, drop the marker and redeploy the old code: `update chat_channels set required_permissions = array['members:view']::text[] where type = 'ROLE_GATED' and 'alumni:post' = any (required_permissions);`
* **⚠️ Note**: Rolling back **re-opens the vulnerability** (FRA-321): a ROLE_GATED channel with no `required_permissions` becomes readable by every chapter member, and — because the pre-FRA-321 posting rule keys on channel *type* — writable by alumni, including a chapter's `#exec-board`. Prefer a roll-forward fix. Nothing predating the migration can be lost: no column, constraint, policy, or row is dropped.
* **Data caveat**: the two `UPDATE`s only touch rows whose `required_permissions` is null or empty, so a chapter that had already configured a channel is never overwritten and re-applying is idempotent. What a drop/re-apply cycle cannot reconstruct is *which* channel was the alumni channel: step 1 matches on `name = 'alumni'`, so a chapter that renamed it gets `{members:view}` from step 2 and loses alumni posting there until an officer with `channels:manage` adds `alumni:post` back. Snapshot `select id, chapter_id, name, type, required_permissions from chat_channels where type = 'ROLE_GATED'` first if any chapter has renamed or hand-tuned a role-gated channel. The Alumni role grant (step 3) is guarded by an `any(permissions)` check and is likewise idempotent; to undo it, `update roles set permissions = array_remove(permissions, 'alumni:post') where system_key = 'ALUMNI';`

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
* **⚠️ Note**: Additive DDL only — no existing table's data is touched, so nothing that predates the migration can be lost. But **redeploy the API at the pre-FRA-24 revision first**, or disable the sweeps. `ScheduledJobsService` claims a row before *every* unit of work, and `ScheduledJobsRepository` treats an unexpected insert error as "not claimed", so with the table gone **all three claim-based sweeps silently stop doing anything** (report retention takes no claim and is unaffected) — reminders send nothing, and attendance auto-absent stops marking. They fail safe (no crash, no double-send) but they also fail *quietly*: the only signal is a `dispatch claim failed` line per item. Auto-absent is not exempt — it claims under `entity_type = 'EVENT'` so it runs once per event instead of once per replica per hour.
* **Data caveat**: the rows are delivery bookkeeping — which reminder has already gone out for which invoice/task. Dropping the table erases that memory, so **re-applying the migration and re-enabling the sweeps re-sends every reminder still inside the 7-day `OVERDUE_LOOKBACK_DAYS` window** (and any invoice/task due the next day). Members see duplicates for anything in that window; older items stay silent because the lookback bound excludes them. If that matters, snapshot the table before dropping and restore it alongside the re-apply.

## Rollback pre-event reminder dispatch support

* **Migration**: `20260902040000_event_reminder_dispatch_threshold.sql`
* **Action**: the migration widens one `CHECK` constraint on the existing `scheduled_notification_dispatches` table and adds **no** index and no column. Reverting narrows the constraint back:
  ```sql
  DELETE FROM scheduled_notification_dispatches WHERE threshold = 'EVENT_REMINDER'; -- see data caveat
  ALTER TABLE scheduled_notification_dispatches DROP CONSTRAINT scheduled_notification_dispatches_threshold_check;
  ALTER TABLE scheduled_notification_dispatches ADD CONSTRAINT scheduled_notification_dispatches_threshold_check CHECK (threshold IN ('DUE_SOON', 'OVERDUE', 'AUTO_ABSENT', 'EXPIRED'));
  ```
  The narrowed `CHECK` will reject the `ADD CONSTRAINT` outright while any `threshold = 'EVENT_REMINDER'` row still exists, hence the `DELETE` first. Note the constraint above must be re-added with `'EXPIRED'` still in it — narrowing all the way back to the original three values would break the poll-expiry sweep as well; roll that back separately and in order if you intend to revert both.
* **No index to drop.** Unlike the poll-expiry rollback above, there is nothing to `DROP INDEX` here. The sweep reads `events.start_time`, which `idx_events_start_time` already covers from `00000000000000_initial_schema.sql` — **do not drop it**; it predates this feature and `EventService.findByChapter`/`findChildren` order on that column.
* **⚠️ Note**: Additive DDL only — no existing constraint value, table, or row is removed by the forward migration, so nothing that predates it can be lost. **Redeploy the API at the pre-#391 revision first**, or disable `ScheduledJobsService.handleEventReminderSweep` — with the narrowed `CHECK` back in place, `claimDispatch('EVENT', …, 'EVENT_REMINDER', …)` fails the insert (constraint violation, not `23505`) and `ScheduledJobsRepository` treats that as "not claimed", so the reminder sweep fails safe (no crash, no double-send) but silently stops reminding anyone — the only signal is a `dispatch claim failed` line per event. The auto-absent sweep is unaffected: it claims under the same `entity_type = 'EVENT'` but the untouched `'AUTO_ABSENT'` threshold.
* **Data caveat**: the deleted rows record which events have already had a reminder sent. Unlike the invoice/task sweeps there is **no lookback window here** — the sweep only ever looks 30 minutes *forward* — so re-applying the migration and re-enabling the sweep re-sends a reminder only for events that are still more than zero and at most 30 minutes from starting at that moment. In practice that is at most a handful of events and is self-limiting; there is no risk of a backlog blast. Snapshot the `threshold = 'EVENT_REMINDER'` rows first only if you care about the audit trail.

## Rollback poll-expiry dispatch support

* **Migration**: `20260902010000_poll_expiry_dispatch.sql`
* **Action**: the migration widens two `CHECK` constraints on the existing `scheduled_notification_dispatches` table and adds one partial index on `chat_messages`. Reverting narrows the constraints back and drops the index:
  ```sql
  DELETE FROM scheduled_notification_dispatches WHERE entity_type = 'POLL' OR threshold = 'EXPIRED'; -- see data caveat
  ALTER TABLE scheduled_notification_dispatches DROP CONSTRAINT scheduled_notification_dispatches_entity_type_check;
  ALTER TABLE scheduled_notification_dispatches ADD CONSTRAINT scheduled_notification_dispatches_entity_type_check CHECK (entity_type IN ('INVOICE', 'TASK', 'EVENT'));
  ALTER TABLE scheduled_notification_dispatches DROP CONSTRAINT scheduled_notification_dispatches_threshold_check;
  ALTER TABLE scheduled_notification_dispatches ADD CONSTRAINT scheduled_notification_dispatches_threshold_check CHECK (threshold IN ('DUE_SOON', 'OVERDUE', 'AUTO_ABSENT'));
  DROP INDEX IF EXISTS idx_chat_messages_poll_expires_at;
  ```
  The narrowed `CHECK`s will reject the rollback outright while any `entity_type = 'POLL'` or `threshold = 'EXPIRED'` row still exists, hence the `DELETE` first.
* **Note**: Additive DDL only — no existing constraint value, table, or row is removed by the forward migration, so nothing that predates it can be lost. **Redeploy the API at the pre-#404 revision first**, or disable `ScheduledJobsService.handlePollExpirySweep` — with the narrowed `CHECK` back in place, `claimDispatch('POLL', …, 'EXPIRED', …)` fails the insert (constraint violation, not `23505`) and `ScheduledJobsRepository` treats that as "not claimed," so the poll-expiry sweep fails safe (no crash, no double-post) but silently stops announcing expired polls — the only signal is a `dispatch claim failed` line per poll.
* **Data caveat**: same shape as the base `scheduled_notification_dispatches` rollback above — the deleted rows are delivery bookkeeping for which expired polls have already been announced. Re-applying the migration and re-enabling the sweep re-announces every poll still inside the 24-hour `POLL_EXPIRY_LOOKBACK_HOURS` window; polls that expired earlier stay silent. Snapshot the `entity_type = 'POLL'` rows before deleting if that matters.

## Rollback custom-role member assignment

* **Migration**: `20260804230000_member_custom_role_ids.sql`
* **Action**: `ALTER TABLE members DROP COLUMN IF EXISTS custom_role_ids;` — but redeploy the API at the pre-FRA-229 revision **first**: the post-FRA-229 `ChapterGuard` `select`s the column on every request and errors if it is gone.
* **Note**: Purely additive (`uuid[] not null default '{}'`). Dropping it loses only which members hold which `chapter_custom_roles` — the roles themselves, their capabilities, and all live-role assignments are untouched, and enforcement falls back to exactly the pre-bridge behavior (custom roles present but presentation-only). No backfill is needed on re-apply; assignments would have to be redone by hand.

## Rollback the dashboard-created bucket declarations

* **Migration**: `20260808204500_declare_dashboard_created_buckets.sql`
* **⚠️ Never delete these buckets.** This is the one bucket migration that does **not** own its buckets. `branding`, `profiles`, `documents`, `backwork` and `chat` were created by hand in the dashboard long before it and already hold live member uploads — logos, profile photos, chapter documents, Backwork resources, chat attachments. The migration only *constrains* rows it did not create, so emptying or deleting a bucket here destroys real chapter data and is never a rollback step (contrast the `reports` and `service` sections below, whose migrations did create their buckets).
* **What it actually changed**: three columns per bucket — `public → false`, `allowed_mime_types` → that bucket's API-side allowlist, `file_size_limit → 26214400`. Nothing else, and no object was touched.
* **Action — no deploy required, and no API rollback is ever needed.** Reverse only the column that is causing trouble:
  * Uploads rejected as the wrong type or too large: `update storage.buckets set allowed_mime_types = null, file_size_limit = null where id = '<bucket>';`
  * An image or file that used to load over a public URL now 404s: `update storage.buckets set public = true where id = '<bucket>';` — **but treat this as an incident, not a fix.** It means something was reading that bucket without a signed URL, which `spec/architecture/README.md` §7 says nothing should do. Restore availability if you must, then find the reader and move it onto a signed URL.
* **Note**: The API is indifferent to all three columns — it only ever mints signed URLs, and `IStorageProvider` has no `getPublicUrl` method — so no API revision pairs with this migration in either direction. Re-applying is safe and idempotent at any time: the `on conflict (id) do update` re-asserts all three columns onto whatever rows exist, which is also what makes it self-healing if someone changes a bucket in the dashboard again.
* **Tightening caveat**: a MIME allowlist constrains only *future* uploads; objects already stored outside the allowlist keep serving. So a rollback is never needed to protect existing files — only to unblock new uploads.
* **Comment-only follow-up (Wave 1 item 2):** header comments now cross-reference `@repo/validation` upload kinds (`image` / `document`) instead of per-service constant names. No DDL change; the rollback steps above are unchanged. Application-layer MIME checks read the shared module; bucket columns still enforce on the PUT.

## Rollback the generated-reports bucket

* **Migration**: `20260805133000_reports_bucket.sql`
* **Action**: Nothing schema-side is usually needed — the row is pure additive config. If the bucket must actually go: first redeploy the API at the pre-FRA-19 revision (otherwise `POST /v1/reports/*?format=pdf` 500s on upload; `format=json` and `format=csv` are unaffected and keep working either way), then empty and remove the bucket **through the Storage API, never raw SQL** — `supabase.storage.emptyBucket('reports')` then `supabase.storage.deleteBucket('reports')` (dashboard: Storage → reports → Empty bucket → Delete). Deleting `storage.objects` rows with SQL removes only metadata and strands the file bytes in the backing store with nothing left to find them by.
* **Note**: Report PDFs are disposable derived artifacts — every one can be regenerated from live data, and nothing in the database references them, so deleting them loses no chapter data. Any signed URL already handed out keeps working until its hour is up or the object is removed, whichever comes first. To only loosen the constraints instead, `update storage.buckets set allowed_mime_types = null, file_size_limit = null where id = 'reports';` — no deploy required. Old exports are reaped automatically: an hourly sweep deletes anything past 24h, and account deletion clears the departing member's chapters' report prefixes outright (`spec/behavior/data-retention.md`). Both live in the API, so rolling the API back to a pre-#694 revision stops the reaping and the bucket resumes growing — empty it by hand via the Storage API if that rollback is held for long.
* **Comment-only follow-up (Wave 1 item 2):** header comments now point at `MAX_UPLOAD_BYTES` in `@repo/validation` for the 25 MB cap. This bucket is still not a member-upload kind. No DDL change; rollback unchanged.

## Rollback the service-proof bucket

* **Migration**: `20260803231500_service_proof_bucket.sql`
* **Action**: Nothing schema-side is usually needed — the row is pure additive config. If the bucket must actually go: first redeploy the API at the pre-FRA-49 revision (otherwise `POST /v1/service-entries/proof-upload-url` 500s), then empty and remove the bucket **through the Storage API, never raw SQL** — `supabase.storage.emptyBucket('service')` then `supabase.storage.deleteBucket('service')` (dashboard: Storage → service → Empty bucket → Delete). Deleting `storage.objects` rows with SQL removes only metadata and strands the file bytes in the backing store with nothing left to find them by.
* **Note**: Deleting the bucket destroys every uploaded proof object; entries keep their `proof_path` strings and `GET /v1/service-entries/{id}/proof-url` returns 404 for them afterwards. To only loosen the upload constraints instead, `update storage.buckets set allowed_mime_types = null, file_size_limit = null where id = 'service';` — no deploy required.
* **Comment-only follow-up (Wave 1 item 2):** header comments now require the MIME list to stay in lockstep with kind `proof` in `@repo/validation`. No DDL change; rollback unchanged.

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

## Rollback default invite role (20260902170002)
* **Migration**: `20260902170002_chapter_default_invite_role.sql`
* **Action**: Run
  ```sql
  DROP INDEX IF EXISTS idx_chapters_default_invite_role_id;
  ALTER TABLE chapters DROP COLUMN IF EXISTS default_invite_role_id;
  ```
* **Note**: Additive nullable FK to `roles(id)`; dropping it loses only each chapter's chosen default invite role. No invite data is affected — `invites.role` stores the resolved role **name**, so tokens already issued keep the role they were created with. Drop the index first: `on delete set null` uses it on role deletes.
* **⚠ Roll the API back first.** `ChapterConfigService.getConfig` names the column in its `select`, so dropping it under a deployed API breaks `GET /v1/chapters/:id/config` for **every** chapter, taking the whole web dashboard's settings surface with it. Since [#1626](https://github.com/pdcarlson/Frapp/issues/1626) that surfaces as a **500** carrying the real `42703` (undefined column), with an error log and a Sentry capture — before that fix it was a 404 that masked the cause, so on-call notes predating this may tell you to watch for the wrong status. Deploy an API build that predates this change before running the DDL, or run both together in a maintenance window.
* **Invites are not affected by the drop.** `InviteService.resolveInviteRole` reads the chapter through `IChapterRepository.findById`, which is `select('*')` and never names the column, so after the drop `default_invite_role_id` simply reads `undefined → null` and invites fall back to the seeded Member role — the pre-#422 behavior. Only the config route breaks, which is why the rollback is a settings-surface outage rather than an invite outage.

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

## Rollback `rollover_semester` RPC
* **Migration**: `20260829000000_rollover_promote_new_members.sql`
* **Action**: Run `DROP FUNCTION IF EXISTS rollover_semester(uuid, text, date, date, text, text);`
* **Note**: Additive function only — dropping it loses no data. Unlike the other RPCs here, a bare drop does **not** break the ordinary path: a rollover without pledge promotion never calls this function and still goes through `semester_archives.insert`. Only the optional New Member → Member promotion is lost. The API calls it from `SupabaseSemesterArchiveRepository.createWithPromotion`, so deploy an API revision that stops offering the promotion toggle before dropping the function, or a rollover requesting promotion will fail. **Already-applied promotions are not reverted by dropping the function** — the role changes are ordinary `members.role_ids` writes; reversing one means putting the New Member role back on the affected members, and there is no record of who was promoted, so capture that before rolling forward if it matters.

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
* **⚠ Roll the API back first** — despite the heading, `get_poll_vote_option_totals` is no longer list-only. Since [#568](https://github.com/pdcarlson/Frapp/issues/568) it also backs `GET /v1/polls/{messageId}`, and `PollService.getPoll` deliberately does **not** swallow an aggregate failure (a detail view showing every option at zero is indistinguishable from a real result), so dropping the function under a running post-#568 API makes **every poll detail request 500**, not just degrade the chapter list. `listPolls` alone degrades gracefully (catches, logs `vote tallies omitted`, renders zeros). Redeploy the API at the pre-#568 revision, or forward-fix, rather than a bare drop.

## Rollback locking EXECUTE on `get_points_report`/poll-vote-aggregate RPCs to `service_role`
* **Migration**: `20260901173000_lock_down_public_rpc_execute.sql`
* **Action**: Run:
  ```sql
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      GRANT EXECUTE ON FUNCTION get_points_report(uuid, uuid, timestamptz) TO anon;
      GRANT EXECUTE ON FUNCTION get_poll_vote_option_totals(uuid[]) TO anon;
      GRANT EXECUTE ON FUNCTION get_poll_user_votes_for_messages(uuid[], uuid) TO anon;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      GRANT EXECUTE ON FUNCTION get_points_report(uuid, uuid, timestamptz) TO authenticated;
      GRANT EXECUTE ON FUNCTION get_poll_vote_option_totals(uuid[]) TO authenticated;
      GRANT EXECUTE ON FUNCTION get_poll_user_votes_for_messages(uuid[], uuid) TO authenticated;
    END IF;
  END
  $$;
  ```
* **Note**: Grant-only change, no data loss and no function body change — restores the pre-migration Postgres-default EXECUTE-to-PUBLIC behavior for `anon`/`authenticated`. Should not be needed: all three RPCs are `security invoker` (RLS still applies under the caller's own privileges) and both callers (`ReportService.getPointsReport`, `SupabasePollVoteRepository`) already go through the API's `service_role` client, which keeps EXECUTE regardless. Only relevant if some other caller was found to invoke these RPCs directly as `anon`/`authenticated` (e.g. via PostgREST) after this migration shipped — confirm that caller's actual need before rolling back, since re-opening the grant is exactly the convention gap #678 closed.

## Rollback `get_points_leaderboard` RPC
* **Migration**: `20260906120001_get_points_leaderboard.sql`
* **Action**: `DROP FUNCTION IF EXISTS get_points_leaderboard(uuid, timestamptz, timestamptz);`
* **Note**: Additive only — one new `security invoker` function, no table, column, row or existing-function change, so there is no data loss on drop. **A bare drop breaks `GET /v1/points/leaderboard` outright**, so this needs a forward-fix rather than a straight rollback: the API calls it from `SupabasePointTransactionRepository.leaderboard` on every leaderboard request, and #522 deleted the previous in-Node path (`IPointTransactionRepository.findByChapter`) in the same change per the cutover discipline — there is no fallback branch left to take. Deploy an API revision that restores the `findByChapter` + reduce-in-Node aggregation **before** dropping the function, or every leaderboard request 500s. **Three surfaces break, not one** — size the blast radius on all of them: the web Points page, the web Members directory, and the **mobile Tasks tab's house-rank card**, which is on every member's home screen rather than an officer-only screen. The balance summary and the Audit tab keep working (they read `findByUser` and `findByChapterFiltered`, which this migration does not touch). Ordering aside, the RPC is pure read: dropping and recreating it at any time is safe for data. The migration creates no index, so there is nothing else to undo.

## Rollback `get_points_report` RPC `p_until` bound
* **Migration**: `20260902010001_get_points_report_until.sql` (supersedes `20260604140000_get_points_report_window_filter.sql`)
* **Action**: Run `DROP FUNCTION IF EXISTS get_points_report(uuid, uuid, timestamptz, timestamptz);`, then recreate the 3-arg `(uuid, uuid, timestamptz)` overload from `20260604140000`, and re-apply its EXECUTE lock-down (revoke from `public`/`anon`/`authenticated`, grant to `service_role`) per `20260901173000`.
* **Note**: Additive/no data loss — the migration drops the 3-arg overload and recreates the RPC with an added `p_until timestamptz` upper bound (#377), used to filter to one specific archived semester's `[start_date, end_date]` calendar-day range rather than only "since the latest archive, through now". The API calls the new 4-arg overload from `ReportService.getPointsReport` on every path (the `window`-based path always passes `p_until: null`; the new `semester_archive_id` path passes a real bound), so a forward-fix — deploy an API revision that reverts to the prior 3-arg call — is required before dropping the 4-arg overload, or every points report request fails. The migration also re-applies the EXECUTE lock-down to the new signature, since `DROP FUNCTION` removes the old signature's grants along with it; a rollback that skips re-applying the lock-down leaves the recreated 3-arg function on Postgres's EXECUTE-to-PUBLIC default.

## Rollback Group DM leave + archive (20260901180000)
* **Migration**: `20260901180000_chat_channels_archived_at.sql`
* **Action**:
  ```sql
  DROP FUNCTION IF EXISTS leave_group_dm(uuid, uuid, uuid);
  ALTER TABLE chat_channels DROP COLUMN IF EXISTS archived_at;
  ```
* **Note**: Additive only — a new nullable `archived_at` column plus a new RPC, no changes to any existing column or row. The API calls the RPC from `SupabaseChatChannelRepository.leaveGroupDm`, so a forward-fix (rather than a bare drop) is required to keep `POST /v1/channels/:id/leave` working: deploy an API revision that stops offering the leave endpoint before dropping the function — otherwise every leave request 500s. Drop the function before the column (the function's body references it). **Data loss on drop**: any channel already archived loses that state — its `archived_at` timestamp is discarded, and it silently reappears in every member's active channel list (`ChannelAccessService.filterAccessibleChannels`/`filterAccessibleChannelIds` both key off this column) even though its membership was already reduced to <= 1 by a completed leave. The membership reduction itself (`member_ids`) is untouched by this rollback and is not restored — a Group DM that shrank to one member before the rollback stays at one member after it, just no longer marked archived.

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

## Rollback service-hours config + leaderboard (20260809124500)

Purely additive DDL — one table, one index, one read-only function (#273).
Nothing existing is altered, so a schema rollback loses only what the migration
itself introduced:

```sql
DROP FUNCTION IF EXISTS get_service_leaderboard(uuid, date, date);
DROP INDEX IF EXISTS idx_service_entries_chapter_status_date;
DROP TABLE IF EXISTS chapter_service_config;
```

**Order matters for the function and the table**: drop them only alongside (or
after) deploying an API build without #273. `GET /v1/service-entries/leaderboard`
calls the function and does not tolerate a missing relation, so dropping the
function while the current build is serving turns that route into a 500.

The **table** is read by two paths, and they do not degrade the same way — the
same split the points-config rollback above spells out:

* `ServiceEntryService.approve` reads through `ChapterServiceConfigService.getConfig`,
  which **fails open** — it logs a warning and applies the default 60 min/point.
  Approvals keep working through the drop, at the wrong rate.
* `GET /chapters/:id/config` reads `chapter_service_config` inline and **fails
  closed** since [#1626](https://github.com/pdcarlson/Frapp/issues/1626) (it is
  also the baseline a config PATCH merges onto, so it must not invent a prior
  state). A dropped table is a read error, so that endpoint returns **500** —
  and it backs the whole web Settings page, not just service hours.

So dropping the table under a running *post*-migration API leaves approvals
working (at the wrong rate) and Settings broken. **Redeploy the API first**, to
a build from before the migration, exactly as for `chapter_points_config`.

**Data caveat — rolling back silently changes point awards.** Any chapter that
configured a non-default rate loses it: approvals revert to 60 minutes per
point. Points already awarded are **not** recomputed (the ledger is
append-only and the system never auto-reverses — see
`spec/behavior/service-hours.md` → Edge Cases), so pre-rollback awards keep
whatever rate produced them. Capture the rates before dropping if you intend to
restore them:

```sql
SELECT chapter_id, minutes_per_point FROM chapter_service_config
 WHERE minutes_per_point <> 60;
```

Dropping `idx_service_entries_chapter_status_date` is always safe — it is a
pure performance index, and the older `idx_service_entries_chapter` still
covers chapter-scoped reads.

## Rollback chapter document folders (20260809120000)

Additive DDL: one new table, no changes to any existing table (#274).

```sql
DROP TABLE IF EXISTS chapter_document_folders;
```

**Order matters**: drop the table only alongside (or after) deploying an API
build without #274. `ChapterDocumentService.listFolders` / `createFolder` /
`updateFolder` / `deleteFolder` all query it, and `confirmUpload` writes to it
on every upload that names a folder — so with the table gone, the current build
returns a 500 on document *upload*, not just on the folder routes.

**No data loss on the documents themselves.** `chapter_documents.folder` is the
free-text column it has always been and this migration never touches it: the
folders table is a *sidecar* holding the name and `sort_order`. Dropping it
loses only the ordering officers configured and any folder that was created but
never filled — every document keeps its folder name and stays filterable by
`GET /v1/documents?folder=`, which is exactly the pre-#274 behavior.

**Re-applying is safe and self-healing.** The migration's backfill re-derives
one row per `distinct (chapter_id, folder)` from `chapter_documents`, so folders
in active use come back on their own; it is `ON CONFLICT DO NOTHING`, so
re-running it against a populated table inserts nothing and cannot fail. What
does *not* come back is `sort_order` (every re-derived folder returns at `0`,
ordering by name) and any empty folder, which has no document to be derived
from. If either matters, snapshot before dropping:

```sql
SELECT chapter_id, name, sort_order FROM chapter_document_folders ORDER BY 1, 3, 2;
```

## Rollback event check-in geofence (20260817170000)

Additive DDL: two nullable columns on `events` plus one CHECK constraint, no
changes to any existing column (#994).

```sql
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_check_in_zone_shape;
ALTER TABLE events DROP COLUMN IF EXISTS check_in_zone;
ALTER TABLE events DROP COLUMN IF EXISTS check_in_zone_name;
```

**Order matters, but less than usual.** `AttendanceService.checkIn` reads
`event.check_in_zone` on every check-in, and `EventService.create` writes both
columns on every event create — so with the columns gone, the current build
returns errors on *event creation* as well as check-in. Drop them only alongside
or after deploying a build without #994.

**Dropping is a security regression, not just a feature rollback.** The zone is
the anti-proxy control for check-in (`spec/ui/mobile/patterns.md` § QR check-in):
without it, a member who receives a forwarded code can check in from anywhere.
The rotating token still applies where a client sends one, but it is explicitly
not an access control. Prefer clearing zones over dropping the columns:

```sql
UPDATE events SET check_in_zone = NULL, check_in_zone_name = NULL;
```

**Snapshot before dropping** — a polygon is hand-drawn per event and cannot be
re-derived from anything else in the schema:

```sql
SELECT id, chapter_id, name, check_in_zone, check_in_zone_name
  FROM events WHERE check_in_zone IS NOT NULL ORDER BY start_time DESC;
```

**Re-applying is safe.** Both `ADD COLUMN` statements are `IF NOT EXISTS`, so the
migration is idempotent; the CHECK constraint is not, so re-running against a
table that still carries it needs the `DROP CONSTRAINT` above first.

## Rollback personal message bookmarks (20260902120000)

Additive DDL: one new table plus two indexes, no changes to any existing table
or column (#462).

```sql
DROP TABLE IF EXISTS public.chat_message_bookmarks;
```

**Order matters, and it is wider than the feature.** Two consumers, not one:

1. `ChatBookmarkService` reads and writes this table on every `/v1/bookmarks*`
   request, and the web chat shell loads the list on every chat page view. With
   the table gone the Bookmarks panel renders its error state; the timeline
   keeps working, because bookmark state is a separate query from messages.
2. **`anonymize_user` deletes from this table** (migration `20260902160000`).
   plpgsql resolves the relation at execution time, so dropping the table while
   that function definition is installed makes every `anonymize_user` call raise
   `42P01` — and `DELETE /v1/users/me` stops working entirely. That is an
   outage of the account-deletion path, not a degraded panel.

So the order is: **revert `anonymize_user` to its `20260803140000` definition
first** (see the entry below), deploy a build without #462, and only then drop
the table. Dropping first takes account deletion down with it.

**Dropping destroys member data that cannot be re-derived.** A bookmark is a
member's own private note-to-self; nothing else in the schema records it, and
`chat_messages` carries no trace of who saved what (deliberately — see the
migration's own comment on why the privacy guarantee lives in the absence of a
policy). Prefer leaving the table in place if the rollback is only about hiding
the feature: the surface is client-side, so a build without #462 simply stops
reading it.

**Snapshot before dropping:**

```sql
SELECT id, user_id, message_id, chapter_id, created_at
  FROM public.chat_message_bookmarks ORDER BY created_at DESC;
```

**Re-applying is safe.** `CREATE TABLE IF NOT EXISTS`, both indexes
`IF NOT EXISTS`, and `ENABLE ROW LEVEL SECURITY` is idempotent — so the
migration re-runs cleanly against a database that already has it.

**RLS note for anyone auditing after a restore.** The table enables RLS with
**zero policies**, which is correct and matches `channel_read_receipts`,
`message_reactions` and `poll_votes`. It is not a missing-policy defect: the API
reaches the table only through the service-role client, and the absence of a
client-reachable policy is what makes "not even a channel admin can see who
bookmarked what" hold structurally. Do not "fix" it by adding one.

## Rollback anonymize_user bookmark purge (20260902160000)

Function-only change (#462): `create or replace function anonymize_user(...)`
adding one `delete from chat_message_bookmarks where user_id = p_user_id;`
alongside the existing per-user purges.

To roll back, re-apply the previous definition from
`20260803140000_account_deletion_anonymize_user_rpc.sql` — the whole function
body is in that file, and `create or replace` makes replaying it idempotent:

```sql
-- Re-run the CREATE OR REPLACE block from
-- supabase/migrations/20260803140000_account_deletion_anonymize_user_rpc.sql
```

**Rolling this back is a data-retention regression, not a feature rollback.**
Without the purge line, a deleted member's bookmark rows survive account
deletion carrying `(user_id, message_id, chapter_id, created_at)` — which is
exactly the "who saved what" that `spec/behavior/chat/README.md` promises nobody
can see. The FK's `on delete cascade` does **not** cover it: `anonymize_user`
tombstones the `users` row rather than deleting it, so nothing ever cascades.
Only roll back alongside dropping `chat_message_bookmarks` itself.

**Re-applying is safe** and idempotent; the extra delete is a no-op on a user
with no bookmarks, and re-running the whole function on an already-tombstoned
user is the documented retry path.
