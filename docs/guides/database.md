# Database & Supabase

This guide documents how we use Supabase Postgres for Frapp: schema, migrations, and conventions.

## 1. Supabase as the database layer

Frapp uses **Supabase Cloud** for staging/production and **Supabase CLI** + Docker for local development.

- Postgres is the single source of truth.
- Supabase provides **Auth**, **Storage**, and **Realtime** on top of Postgres.
- The schema lives in `supabase/migrations/` and is applied via `npx supabase db reset` locally.

## 2. Schema location

- All migrations: `supabase/migrations/*.sql`
- Seed data: `supabase/seed.sql`, plus `supabase/seed/*.csv` for reference tables (below)
- Supabase config: `supabase/config.toml`

To reset your local database:

```bash
npx supabase db reset
```

This drops and recreates the database, applies all migrations, and reruns `seed.sql`.

> **A `db reset` drops the reference data too.** `seed.sql` is the only thing the
> CLI reruns; the CSV-backed reference tables below are loaded by the bootstrap
> scripts, not by the CLI. After a reset, re-run `bash scripts/local-dev-setup.sh --quick`
> (or `bash scripts/cloud-sandbox-up.sh` in a sandbox) to get them back. This is the
> same footgun as the Postgres ACL repair, and it reappears the same way.

### Reference data: the chapter directory

`chapter_directory` is a global (not chapter-scoped) table the onboarding wizard
searches to autofill a new chapter's identity — Greek letters, org name,
university, founding year, brand colors. It is populated from
`supabase/seed/chapter_directory.csv`:

```bash
npm run check:chapter-directory-seed   # validate the CSV (no database needed)
npm run load:chapter-directory         # print the load SQL to stdout
```

Both `scripts/cloud-sandbox-up.sh` and `scripts/local-dev-setup.sh` run the load
automatically after migrations apply, via `frapp_load_chapter_directory` in
`scripts/lib/local-seed-data.sh`. Set `FRAPP_SKIP_DIRECTORY_LOAD=1` to skip it.

Three things about it are load-bearing:

- **The loader is idempotent and preserves row ids.** `chapters.directory_id`
  references `chapter_directory(id) on delete set null`, so a loader that deleted
  and re-inserted would silently detach every real chapter from its directory
  entry on each bootstrap. The generated SQL updates in place and inserts only
  what is missing. It is not `ON CONFLICT` because there is no unique constraint
  on the natural key — the only unique index is the random uuid primary key.
- **Updates are scoped to `source = 'seed'`.** A row curated by hand or arriving
  from another source is never overwritten by a re-run.
- **Colors must be canonical `#RRGGBB`.** `npm run check:chapter-directory-seed`
  runs in CI as a blocking job because a malformed hex does not fail — `derivePalette`
  substitutes platform bronze (`#7A5A2F`), so the chapter gets a plausible-looking
  wrong brand color with no error anywhere. The seed originally shipped with 50 of
  its 100 values missing a leading `#` and nothing noticed (#840). `derivePalette`
  now reports the substitution on `DerivePaletteResult.invalidInputs`, and both API
  callers log it.

The current file is a 50-row placeholder covering 41 universities. Growing it to
the full dataset is tracked in #232.

## 3. Conventions

- **RBAC seed vs existing data:** Default system roles and their `permissions` arrays are defined in `apps/api/src/domain/constants/permissions.ts` and inserted when a chapter is created. Changing that array does **not** rewrite rows for chapters that already exist; use a SQL migration under `supabase/migrations/` when a permission must be backfilled (for example `20260417140000_backfill_polls_view_all_system_roles.sql` for `polls:view_all` on Treasurer and for inserting VP/Secretary system roles with `members:view` and `polls:view_all` together so `PollController`’s class-level guard is satisfied). `20260417150000_backfill_members_view_vp_secretary.sql` remains an idempotent repair if a database applied an older revision of that backfill that omitted `members:view` on VP/Secretary. A small unit test in `apps/api/src/domain/constants/permissions.spec.ts` asserts VP/Secretary keep `members:view` alongside `polls:view_all` so they stay aligned with controller guards.

- Primary keys: `uuid` generated via `gen_random_uuid()`
- Timestamps: `created_at TIMESTAMPTZ DEFAULT now()`
- Tenant scoping: nearly every table includes `chapter_id`
- Row-Level Security (RLS): policies scope by `chapter_id` and authenticated user
- **Atomic multi-row writes:** operations that must be all-or-nothing across tables live in a
  `plpgsql` function migration and are invoked via `supabase.rpc(...)` from a repository (a function
  body runs in a single implicit transaction). Example: `confirm_task_completion` (migration
  `20260602210000_add_confirm_task_completion_rpc.sql`) confirms a task and inserts its point-ledger
  row together, with a `WHERE points_awarded = false` compare-and-set so concurrent confirms cannot
  double-award. See also the read-side `get_points_report`. Canonical behavior: `spec/behavior/points.md`.

Examples:

- Core tables: `users`, `chapters`, `members`, `roles`, `invites`
- Backwork: `backwork_departments`, `backwork_professors`, `backwork_resources`
- Points/Events: `point_transactions`, `events`, `event_attendance`
- Chat: `chat_channel_categories`, `chat_channels`, `chat_messages`, `message_reactions`
- Others: `study_sessions`, `service_entries`, `tasks`, `chapter_documents`, `semester_archives`

> **Note:** The canonical description of the data model is in `spec/architecture/README.md` Section 5. Always update the spec before changing the schema.

## 4. Adding a new table

1. Create a new migration:

```bash
npx supabase migration new add_polls
```

2. Edit the generated SQL file in `supabase/migrations/`:

```sql
create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id),
  channel_id uuid not null references public.chat_channels(id),
  question text not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

alter table public.polls enable row level security;
```

3. Apply the migration locally:

```bash
npx supabase db reset
```

4. Update:

- `spec/architecture/README.md` (data model)
- Domain entity & repository interfaces in the API
- `apps/api/src/infrastructure/supabase/database.types.ts` — add a
  `TableDefinition<YourRow>` entry so queries against the new table are
  type-checked. The file is hand-maintained and composed from the domain
  entities; **do not** overwrite it with `supabase gen types` output. See
  [`.claude/skills/api-development/SKILL.md`](../../.claude/skills/api-development/SKILL.md)
  → "Keeping `database.types.ts` in sync" for the two constraints that make
  the typing actually bind.
- Any relevant behavior under `spec/behavior/`

## 5. RLS and security

We rely on Supabase RLS for defense in depth:

- Policies restrict access by `chapter_id` and membership.
- The API still enforces its own RBAC permissions (roles + permissions catalog).

When adding tables:

- Add appropriate RLS policies in the migration.
- Ensure every query from the API filters on `chapter_id` and respects RLS expectations.

> **Warning:** Never disable RLS in production. Local testing may temporarily relax policies, but staging and prod must always run with RLS enabled.

## 6. Table inventory (high level)

See `spec/architecture/README.md` §5 for a full table-by-table reference. At a high level:

- **Core**: users, chapters, members, roles, invites
- **Engagement**: events, event_attendance, point_transactions (including `idx_point_transactions_chapter_created_at` for admin audit pagination), study_sessions, service_entries, tasks
- **Content**: backwork_departments, backwork_professors, backwork_resources, chapter_documents
- **Communication**: chat_channel_categories, chat_channels, chat_messages, message_reactions
- **Meta**: semester_archives, financial_invoices, financial_transactions, notifications, notification_preferences
