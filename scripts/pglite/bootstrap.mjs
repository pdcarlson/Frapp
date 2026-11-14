// What a bare Postgres needs before `supabase/migrations/` applies to it the
// way it applies to hosted Supabase. Two harnesses run it: the PGlite gate
// (`scripts/pglite/run.mjs`) and the two-connection lock harness
// (`scripts/db-race/`), which applies the migrations to a stock Postgres
// container in CI.

// Supabase's `auth.*` functions, stubbed so policy DDL parses. These are the
// DEFAULTS: the black-box PGlite tiers (`tiers/chat-*.mjs`) replace
// `auth.uid()` and `auth.role()` per scenario to impersonate a signed-in or
// anonymous client, and read the tables through non-owner probe roles granted
// `authenticated` or `anon`. So the PGlite gate verifies enforcement, not only
// presence; what stays with the NestJS Jest tier is a real GoTrue-minted JWT
// (claims beyond `sub`/`role`), per ADR-11/ADR-12.
export const AUTH_STUBS_SQL = `
  create schema if not exists auth;
  create or replace function auth.uid()  returns uuid language sql as $$ select null::uuid $$;
  create or replace function auth.role() returns text language sql as $$ select 'service_role'::text $$;
  create or replace function auth.jwt()  returns jsonb language sql as $$ select '{}'::jsonb $$;
`;

// Supabase's four roles, created BEFORE the migrations apply. Migrations wrap
// policy, grant and revoke statements in `if exists (select 1 from pg_roles
// where rolname = '<role>')`, the repo's dominant idiom for anything that
// targets a Supabase role, because the roles exist on hosted Supabase but not
// in a bare Postgres. Without a role here, every block guarded on it is skipped
// silently, so the harness validates a schema the hosted project does not run.
//
// That was a live false-PASS, not a theoretical one (#423): a permissive
// `create policy ... to authenticated using (true)` written in that idiom left
// the PGlite gate green while handing every signed-in client every row of the
// table. Creating `authenticated` is what makes the black-box tiers see the
// policies they exist to check, and it exercises the `to authenticated` clause
// itself (`v_role_clause`).
//
// The other three close the same class for their own guards (#1557): about 35
// blocks guard on `anon` and 34 on `service_role`. A `revoke ... from anon`
// naming the wrong function signature is the case that matters: with the role
// absent the statement never ran, the gate stayed green, and `supabase db
// push` aborted on the hosted project, where the role exists.
// `supabase_auth_admin` guards the custom-access-token hook's grants and its
// two `auth_admin_can_read_*` policies, which now exist here too.
//
// Attributes follow the local Supabase image's `pg_roles`, except LOGIN, which
// nothing here uses: `service_role` alone bypasses RLS, `supabase_auth_admin`
// is NOINHERIT and CREATEROLE, and neither client role is a member of the
// other. The last is the one that matters, because a policy binds every
// member of the roles it names.
export const SUPABASE_ROLES_SQL = `
  create role authenticated nologin;
  create role anon nologin;
  create role service_role nologin bypassrls;
  create role supabase_auth_admin nologin noinherit createrole;
`;

// Supabase's default privileges for objects the migration role creates in
// `public`, as hosted's `pg_default_acl` has them (and the local image's, read
// 2026-11-07): tables, sequences and functions all go to `anon`,
// `authenticated` and `service_role` directly, with no PUBLIC entry on
// functions (#3052, #830). Without them a function here was callable by `anon`
// only through PUBLIC, so a migration that revoked PUBLIC alone, or a
// drop/recreate that forgot its `revoke ... from anon`, passed the PGlite gate
// while the hosted project kept a direct `anon` grant. That is how three
// definer functions stayed callable with the publishable key. The grant
// assertions in `rls-smoke.mjs` and the tiers read the result; the hosted-side
// `has_function_privilege` checks in the promotion log stay as confirmation.
// Table grants do not open a table: every `public` table enables RLS, which
// `rls-smoke.mjs` asserts, so a grant without a policy still reads no rows.
export const DEFAULT_PRIVILEGES_SQL = `
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant usage, select, update on sequences to anon, authenticated, service_role;
  alter default privileges in schema public
    grant execute on functions to anon, authenticated, service_role;
`;
