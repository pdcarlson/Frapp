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
- **Colors must be canonical `#RRGGBB`.** `npm run check:chapter-directory-seed` runs
  in CI as the `chapter-directory-seed` job, because a malformed hex does not fail —
  the accent engine substitutes the house seed (`#F2B72E`), so the chapter gets a
  plausible-looking wrong brand color with no error anywhere. The seed originally
  shipped with 50 of its 100 values missing a leading `#` and nothing noticed (#840).
  `deriveSignetPalette` reports the substitution on `invalidSeed` and the API callers
  log it, but the log is the only signal — nothing rejects the save.

  Each row's `default_colors` holds exactly one key, `accent` — one seed per chapter,
  per `spec/ui/design-system/accent-engine.md` §1. It was a `{ dark, accent }` pair
  until #1225: the #920 slice-9 cutover removed the second brand colour from chapter
  branding and both onboarding wizards stopped prefilling from `dark`, which left a
  required CI gate validating a field nothing read.

  Deployed `chapter_directory` rows written before #1225 may still carry an inert
  `dark`, and **nothing prunes them automatically**. The load SQL replaces
  `default_colors` wholesale, but only for rows the seed owns — its `update` is scoped
  `and d.source = 'seed'`, so a hand-curated or `nic_2024` row keeps its values (the
  `insert` half matches on the natural key without `source`, so such a row is not
  duplicated either). And that SQL only runs where someone applies it: the command
  above prints to stdout, the local bootstrap scripts pipe it in, and the promotion
  path does not. That is all fine — nothing reads the key. Treat it as inert data,
  not as something a deploy will tidy up.

  > The job is listed in `scripts/configure-branch-protection.mjs`, but listing it is
  > not the same as enforcing it: required checks only change when someone runs
  > `npm run configure:branch-protection`. Until that happens this job runs and reports
  > on every PR without blocking a merge — the same rollout state as `secret-scan`,
  > `clean-checkout-typecheck`, and `dependency-audit` (#813).

The current file is a 50-row placeholder covering 41 universities. Growing it to
the full dataset is tracked in #232.

## 3. Conventions

- **RBAC seed vs existing data:** Default system roles and their `permissions` arrays are defined in `apps/api/src/domain/constants/permissions.ts` and inserted when a chapter is created. Changing that array does **not** rewrite rows for chapters that already exist; use a SQL migration under `supabase/migrations/` when a permission must be backfilled (for example `20260417140000_backfill_polls_view_all_system_roles.sql` for `polls:view_all` on Treasurer and for inserting VP/Secretary system roles with `members:view` and `polls:view_all` together so `PollController`’s class-level guard is satisfied). `20260417150000_backfill_members_view_vp_secretary.sql` remains an idempotent repair if a database applied an older revision of that backfill that omitted `members:view` on VP/Secretary. A small unit test in `apps/api/src/domain/constants/permissions.spec.ts` asserts VP/Secretary keep `members:view` alongside `polls:view_all` so they stay aligned with controller guards.

- Primary keys: `uuid` generated via `gen_random_uuid()`
- Timestamps: `created_at TIMESTAMPTZ DEFAULT now()`
- Tenant scoping: nearly every table includes `chapter_id`
- Row-Level Security (RLS): enabled on every table, almost always with **no policies** — default
  deny, with the API (service role) as the enforcing layer. Per-table postures:
  [`docs/internal/security/AUTHORIZATION_MODEL.md`](../internal/security/AUTHORIZATION_MODEL.md)
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
  → "Keeping `database.types.ts` in sync" for the constraints that make
  the typing actually bind (`Row`/`Insert`/`Update` are mapped types so
  GenericSchema stays bound; write methods take `TablesInsert<'table'>` /
  `TablesUpdate<'table'>` instead of `as never`). The client is
  `createClient<Database>(...)` in `supabase.provider.ts` (and the live
  PostgREST test helper). Inject `FrappSupabaseClient` everywhere the
  `SUPABASE_CLIENT` token is taken (repositories, services, guards,
  workers, health) — a bare `SupabaseClient` annotation drops the schema.
  Do not add a generic base repository; keep each repository's query
  logic and only parameterize the write methods.
  `no-as-never.spec.ts` guards the repository folder (file count,
  `FrappSupabaseClient` injection, no `as never`).
- Any relevant behavior under `spec/behavior/`

## 5. RLS and security

We rely on Supabase RLS for defense in depth, but **not** in the "write a policy per table" shape.
The design (canonical: [`docs/internal/security/AUTHORIZATION_MODEL.md`](../internal/security/AUTHORIZATION_MODEL.md)):

- Almost every table is **RLS on, no policies** — default deny for `anon`/`authenticated`
  clients. The API enforces authorization (guards + RBAC) and reaches the database through the
  service-role client, which bypasses RLS; tenant isolation is therefore **application-layer**:
  every API query must filter on `chapter_id`.
- Client-reachable policies exist only where the browser deliberately reads Postgres directly —
  the chat hot path (`chat_message_actions`, `chat_messages` reads scoped through
  `can_read_chat_message`) and a few narrow cases. Do not add a permissive policy for a new
  table unless you are deliberately opening a client-direct path; enable RLS and stop.

When adding tables:

- `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` in the migration — with no policies, unless the
  table is genuinely client-read, in which case follow `AUTHORIZATION_MODEL.md`.
- Ensure every query from the API filters on `chapter_id`.

> **Warning:** Never disable RLS in production. Local testing may temporarily relax policies, but staging and prod must always run with RLS enabled.

## 6. Table inventory (high level)

See `spec/architecture/README.md` §5 for a full table-by-table reference. At a high level:

- **Core**: users, chapters, members, roles, invites
- **Engagement**: events, event_attendance, point_transactions (including `idx_point_transactions_chapter_created_at` for admin audit pagination), study_sessions, service_entries, tasks
- **Content**: backwork_departments, backwork_professors, backwork_resources, chapter_documents
- **Communication**: chat_channel_categories, chat_channels, chat_messages, message_reactions
- **Meta**: semester_archives, financial_invoices, financial_transactions, notifications, notification_preferences
