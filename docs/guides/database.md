# Database & Supabase

This guide documents how we use Supabase Postgres for Frapp: schema, migrations, and conventions.

## 1. Supabase as the database layer

Frapp uses **Supabase Cloud** for staging/production and **Supabase CLI** + Docker for local development.

- Postgres is the single source of truth.
- Supabase provides **Auth**, **Storage**, and **Realtime** on top of Postgres.
- The schema lives in `supabase/migrations/` and is applied via `npx supabase db reset` locally.

## 2. Schema location

- All migrations: `supabase/migrations/*.sql`
- Seed data: `supabase/seed.sql`
- Supabase config: `supabase/config.toml`

To reset your local database:

```bash
npx supabase db reset
```

This drops and recreates the database, applies all migrations, and reruns `seed.sql`.

## 3. Conventions

- **RBAC seed vs existing data:** Default system roles and their `permissions` arrays are defined in `apps/api/src/domain/constants/permissions.ts` and inserted when a chapter is created. Changing that array does **not** rewrite rows for chapters that already exist; use a SQL migration under `supabase/migrations/` when a permission must be backfilled (for example `20260417140000_backfill_polls_view_all_system_roles.sql` for `polls:view_all` on Treasurer and new VP/Secretary roles).

- Primary keys: `uuid` generated via `gen_random_uuid()`
- Timestamps: `created_at TIMESTAMPTZ DEFAULT now()`
- Tenant scoping: nearly every table includes `chapter_id`
- Row-Level Security (RLS): policies scope by `chapter_id` and authenticated user

Examples:

- Core tables: `users`, `chapters`, `members`, `roles`, `invites`
- Backwork: `backwork_departments`, `backwork_professors`, `backwork_resources`
- Points/Events: `point_transactions`, `events`, `event_attendance`
- Chat: `chat_channel_categories`, `chat_channels`, `chat_messages`, `message_reactions`
- Others: `study_sessions`, `service_entries`, `tasks`, `chapter_documents`, `semester_archives`

> **Note:** The canonical description of the data model is in `spec/architecture.md` Section 5. Always update the spec before changing the schema.

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

- `spec/architecture.md` (data model)
- Domain entity & repository interfaces in the API
- Any relevant behavior in `spec/behavior.md`

## 5. RLS and security

We rely on Supabase RLS for defense in depth:

- Policies restrict access by `chapter_id` and membership.
- The API still enforces its own RBAC permissions (roles + permissions catalog).

When adding tables:

- Add appropriate RLS policies in the migration.
- Ensure every query from the API filters on `chapter_id` and respects RLS expectations.

> **Warning:** Never disable RLS in production. Local testing may temporarily relax policies, but staging and prod must always run with RLS enabled.

## 6. Table inventory (high level)

See `spec/architecture.md` §5 for a full table-by-table reference. At a high level:

- **Core**: users, chapters, members, roles, invites
- **Engagement**: events, event_attendance, point_transactions (including `idx_point_transactions_chapter_created_at` for admin audit pagination), study_sessions, service_entries, tasks
- **Content**: backwork_departments, backwork_professors, backwork_resources, chapter_documents
- **Communication**: chat_channel_categories, chat_channels, chat_messages, message_reactions
- **Meta**: semester_archives, financial_invoices, financial_transactions, notifications, notification_preferences
