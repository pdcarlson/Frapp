# Database & Supabase

This guide documents how we use Supabase Postgres for Frapp: schema, migrations, and conventions.

## 1. Supabase as the database layer

Frapp uses **Supabase Cloud** for staging/production and **Supabase CLI** + Docker for local development.

- Postgres is the single source of truth.
- Supabase provides **Auth**, **Storage**, and **Realtime** on top of Postgres.
- The schema lives in `supabase/migrations/`. How a new migration is applied locally:
  [`CONTRIBUTING.md` § Database Migrations](../../CONTRIBUTING.md#database-migrations);
  `npm run supabase -- db reset` is the full rebuild-from-scratch path described below,
  not the way a single migration is applied.

## 2. Schema location

- All migrations: `supabase/migrations/*.sql`
- Seed data: `supabase/seed.sql`, plus `supabase/seed/*.csv` for reference tables (below)
- Supabase config: `supabase/config.toml`

To reset your local database:

```bash
npm run supabase -- db reset
```

This drops and recreates the database, applies all migrations, and reruns `seed.sql`.

> **A `db reset` restores the chapter directory from migrations, not from the CSV.**
> The directory's rows arrive with the migrations that load them
> (`20261107043100_chapter_directory_wikipedia_rows.sql` is the latest), so a reset
> brings back the last shipped load. A CSV changed locally since then reaches the
> database only through the bootstrap scripts: re-run `bash scripts/local-dev-setup.sh --quick`
> (or `bash scripts/cloud-sandbox-up.sh` in a sandbox).

### Reference data: the chapter directory

`chapter_directory` is a global (not chapter-scoped) table the onboarding wizard
searches to autofill a new chapter's identity — Greek letters, org name,
university, founding year, brand colors. It is populated from
`supabase/seed/chapter_directory.csv`:

```bash
npm run build:chapter-directory        # rebuild the CSV from Wikipedia (needs en.wikipedia.org; behind a proxy, NODE_USE_ENV_PROXY=1)
npm run check:chapter-directory-seed   # validate the CSV (no database needed)
npm run load:chapter-directory         # print the load SQL to stdout
```

The CSV is generated, not hand-written (#232). `scripts/chapter-directory/build-from-wikipedia.mjs`
reads the member lists of the NIC, NPC and NPHC plus a few other organizations,
then each organization's "List of … chapters" article (or, with no list, the
chapter tables of its own article), and keeps the chapters marked active at a named
school. Each school is its full name (the school's article title, "Rensselaer
Polytechnic Institute"), spelled one way across organizations, with its short name
and nicknames in `aliases` (`scripts/chapter-directory/school-names.mjs`; adding a
school there is the fix when a search by its common name misses). Organization
nicknames ("FIJI") go in `org_aliases`, in `ORG_ALIASES` in the builder.
`--cached` reuses the pages a previous run saved and fetches only the rest;
`--offline` fetches nothing.
`supabase/seed/chapter_directory.sources.json` records the revision of every
article each row came from, and which organizations were skipped and why. The
first seed, 50 rows written by hand in 2026-05, named chapters that don't exist
("Pi Tau" of Phi Gamma Delta at RPI); the Wikipedia load prunes those.

Both `scripts/cloud-sandbox-up.sh` and `scripts/local-dev-setup.sh` run the load
automatically after migrations apply, via `frapp_load_chapter_directory` in
`scripts/lib/local-seed-data.sh`. Set `FRAPP_SKIP_DIRECTORY_LOAD=1` to skip it.
Hosted projects never ran either script, so their table stayed empty until
`20260907011500_chapter_directory_seed_rows.sql` carried the same generated SQL
as a migration — the one path that reaches staging and production. A changed CSV
ships the same way: `node scripts/load-chapter-directory.mjs --migration` into a new
migration (`--migration` leaves out the `begin`/`commit` that `db push` already
supplies), with promotion-log and rollback-playbook entries; the local bootstrap's
own run then finds nothing left to do.

Three things about it are load-bearing:

- **The loader is idempotent and preserves row ids.** `chapters.directory_id`
  references `chapter_directory(id) on delete set null`, so a loader that deleted
  and re-inserted would silently detach every real chapter from its directory
  entry on each bootstrap. The generated SQL updates in place and inserts only
  what is missing. It is not `ON CONFLICT` because there is no unique constraint
  on the natural key — the only unique index is the random uuid primary key.
- **Updates are scoped to the loader's own sources (`seed`, `wikipedia`).** A row
  curated by hand or arriving from another source is never overwritten by a re-run.
  An owned row the CSV no longer lists is deleted when no chapter links to it. A
  linked one is retired (`source = 'retired'`): kept so the link holds, never
  offered by search, and taken back if the CSV lists it again.
- **Colors must be canonical `#RRGGBB`.** `npm run check:chapter-directory-seed` runs
  in CI as the `chapter-directory-seed` job, because a malformed hex does not fail —
  the accent engine substitutes the [house seed](../../spec/ui/design-system/accent-engine.md#3-default-seed), so the chapter gets a
  plausible-looking wrong brand color with no error anywhere. The seed originally
  shipped with 50 of its 100 values missing a leading `#` and nothing noticed (#840).
  `deriveSignetPalette` reports the substitution on `invalidSeed` and the API callers
  log it, but the log is the only signal — nothing rejects the save.

  Neither wizard reads `default_colors.accent` first any more: `ORG_PROFILES` in
  `@repo/org-archetypes` wins, and the column is only the fallback for an
  organization that file doesn't list ([`branding.md` § Accent Color](../../spec/behavior/branding.md#accent-color)
  says why; the seed's placeholder values are #3373).

  Each row's `default_colors` holds exactly one key, `accent` — one seed per chapter,
  per `spec/ui/design-system/accent-engine.md` §1. It was a `{ dark, accent }` pair
  until #1225: the #920 slice-9 cutover removed the second brand colour from chapter
  branding and both onboarding wizards stopped prefilling from `dark`, which left a
  required CI gate validating a field nothing read.

  Deployed `chapter_directory` rows written before #1225 may still carry an inert
  `dark`, and **nothing prunes them automatically**. The load SQL replaces
  `default_colors` wholesale, but only for rows the seed owns — its `update` is scoped
  to `source in ('seed', 'wikipedia')`, so a hand-curated or `nic_2024` row keeps its values (the
  `insert` half matches on the natural key without `source`, so such a row is not
  duplicated either). And that SQL only runs where someone applies it: the command
  above prints to stdout, the local bootstrap scripts pipe it in, and neither the
  staging nor the production deploy path does. That is all fine — nothing reads the key. Treat it as inert data,
  not as something a deploy will tidy up.

  > The job is listed in `scripts/ci/lib/required-checks.mjs`, but listing it is
  > not the same as enforcing it: required checks only change when an admin runs
  > `npm run configure:branch-protection` (a human step; an agent session runs
  > `npm run configure:branch-protection:verify`, which writes nothing). Whether the
  > live ruleset requires it yet is a provider question, not something this guide records.

The CSV is a placeholder subset, not the full dataset; growing it is tracked in #232.

## 3. Conventions

- **RBAC seed vs existing data:** Default system roles and their `permissions` arrays are defined in `apps/api/src/domain/constants/permissions.ts` and inserted when a chapter is created. Changing that array does **not** rewrite rows for chapters that already exist; use a SQL migration under `supabase/migrations/` when a permission must be backfilled (for example `20260417140000_backfill_polls_view_all_system_roles.sql` for `polls:view_all` on Treasurer and for inserting VP/Secretary system roles with `members:view` and `polls:view_all` together so `PollController`’s class-level guard is satisfied). `20260417150000_backfill_members_view_vp_secretary.sql` remains an idempotent repair if a database applied an older revision of that backfill that omitted `members:view` on VP/Secretary. A small unit test in `apps/api/src/domain/constants/permissions.spec.ts` asserts VP/Secretary keep `members:view` alongside `polls:view_all` so they stay aligned with controller guards.

- Primary keys: `uuid` generated via `gen_random_uuid()`
- Timestamps: `created_at TIMESTAMPTZ DEFAULT now()`
- Tenant scoping: nearly every table includes `chapter_id`
- Row-Level Security (RLS): enabled on every table, almost always with **no policies** — default
  deny, with the API (service role) as the enforcing layer. Per-table postures:
  [`docs/security/authorization-model.md`](../security/authorization-model.md)
- **Atomic multi-row writes:** operations that must be all-or-nothing across tables live in a
  `plpgsql` function migration and are invoked via `supabase.rpc(...)` from a repository (a function
  body runs in a single implicit transaction). Example: `confirm_task_completion` (migration
  `20260602210000_add_confirm_task_completion_rpc.sql`) confirms a task and inserts its point-ledger
  row together, with a `WHERE points_awarded = false` compare-and-set so concurrent confirms cannot
  double-award. See also the read-side `get_points_report`. Canonical behavior: `spec/behavior/points.md`.
- **Every new function pins `search_path`:** declare `set search_path = public, pg_temp` on any
  function you add to `public`. A `security definer` one also revokes EXECUTE `from public`,
  `from anon` **and** `from authenticated`, then grants `service_role`: Supabase's default
  privileges grant every client role directly, and a definer function bypasses RLS, so a grant
  left in place lets any caller read across chapters. Only a function an RLS policy or Realtime
  check calls as the signed-in user keeps `authenticated`, and that is a recorded decision, not a
  default. The `pglite-migrations` job fails each of these misses. The rule and the accepted list:
  [`authorization-model.md` § Who may call a `SECURITY DEFINER` function](../security/authorization-model.md#who-may-call-a-security-definer-function).

Examples:

- Core tables: `users`, `chapters`, `members`, `roles`, `invites`
- Backwork: `backwork_departments`, `backwork_professors`, `backwork_resources`
- Points/Events: `point_transactions`, `events`, `event_attendance`
- Chat: `chat_channel_categories`, `chat_channels`, `chat_messages`, `message_reactions`
- Others: `study_sessions`, `service_entries`, `tasks`, `chapter_documents`, `semester_archives`

> **Note:** The canonical description of the data model is [`spec/architecture/README.md` § Data Model](../../spec/architecture/README.md#5-data-model-supabase-postgres). A schema change that alters a table or relationship it describes updates it in the same change.

## 4. Adding a new table

1. Create a new migration:

```bash
npm run supabase -- migration new add_polls
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
npm run supabase -- db push --local
```

   Use `npm run supabase -- db reset` only when you want the full rebuild described in
   § 2 Schema location — it drops the reference data with it.

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
  `TablesUpdate<'table'>` and reach PostgREST uncast). The client is
  `createClient<Database>(...)` in `supabase.provider.ts` (and the live
  PostgREST test helper). Inject `FrappSupabaseClient` everywhere the
  `SUPABASE_CLIENT` token is taken (repositories, services, guards,
  workers, health) — a bare `SupabaseClient` annotation drops the schema.
  Do not add a generic base repository; keep each repository's query
  logic and only parameterize the write methods.
  `no-as-never.spec.ts` guards every `*.repository.ts` under
  `apps/api/src`, wherever it lives (repository count,
  `FrappSupabaseClient` injection, and no cast, `@ts-expect-error`, or
  erased `.from()`/client binding on a write path). It names its own
  gaps in its docblock — read them there before reading a green run as
  proof.
- Any relevant behavior under `spec/behavior/`

## 5. RLS and security

We rely on Supabase RLS for defense in depth, but **not** in the "write a policy per table" shape.
The design (canonical: [`docs/security/authorization-model.md`](../security/authorization-model.md)):

- Almost every table is **RLS on, no policies** — default deny for `anon`/`authenticated`
  clients. The API enforces authorization (guards + RBAC) and reaches the database through the
  service-role client, which bypasses RLS; tenant isolation is therefore **application-layer**:
  every API query must filter on `chapter_id`.
- Client-reachable policies exist only where the browser deliberately reads Postgres directly
  (the chat hot path); `authorization-model.md` holds the per-table inventory and the policy
  details. Do not add a permissive policy for a new table unless you are deliberately opening a
  client-direct path; enable RLS and stop.

When adding tables:

- `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` in the migration — with no policies, unless the
  table is genuinely client-read, in which case follow `authorization-model.md`.
- Ensure every query from the API filters on `chapter_id`.

> **Warning:** Never disable RLS in production. Local testing may temporarily relax policies, but staging and prod must always run with RLS enabled.

## 6. Table inventory (high level)

See `spec/architecture/README.md` §5 for a full table-by-table reference. At a high level:

- **Core**: users, chapters, members, roles, invites
- **Engagement**: events, event_attendance, point_transactions (including `idx_point_transactions_chapter_created_at` for admin audit pagination), study_sessions, service_entries, tasks
- **Content**: backwork_departments, backwork_professors, backwork_resources, chapter_documents
- **Communication**: chat_channel_categories, chat_channels, chat_messages, message_reactions
- **Meta**: semester_archives, financial_invoices, financial_transactions, notifications, notification_preferences
