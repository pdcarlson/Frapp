-- Active-chapter JWT claim (FRA-303).
--
-- spec/behavior/multi-tenancy.md makes the JWT claim the AUTHORITATIVE source of
-- request chapter context: "the JWT claim is authoritative; the `x-chapter-id`
-- request header is accepted only as a fallback ... the header never overrides
-- the JWT." No such claim existed -- there was no auth hook and nothing wrote an
-- active chapter anywhere -- so `ChapterGuard` had only the client-supplied
-- header to go on, and any member could target any chapter they belonged to by
-- editing one header. This migration issues the claim so the guard has something
-- authoritative to reconcile against.
--
-- Two pieces:
--   1. `users.active_chapter_id` -- the persisted selection, set via
--      POST /v1/chapters/:id/activate (membership-validated in the API).
--   2. `custom_access_token_hook` -- stamps that selection into every issued
--      access token as the top-level `active_chapter_id` claim.
--
-- Resolution order inside the hook mirrors the spec: persisted selection first
-- (but only while it is still a live membership, so a revoked member stops
-- getting the claim on their next refresh), else the sole membership when the
-- user has exactly one ("Single-chapter users have their sole chapter
-- auto-resolved server-side"), else no claim at all -- multi-chapter users with
-- no selection must supply context explicitly, which the guard answers with
-- `400 chapter.context.required`.
--
-- SECURITY / OPERATIONAL NOTES
--
-- * No `security definer`. Supabase's auth-hooks security model recommends
--   against it (dashboard-created functions would run as `postgres`); the hook
--   instead runs as `supabase_auth_admin` and is granted exactly the reads it
--   needs. `users` and `members` have RLS enabled with no policies, so
--   `supabase_auth_admin` also needs explicit SELECT policies below -- a missing
--   policy here is the single most common cause of "permission denied" at login.
--
-- * The hook is wrapped in `exception when others then return event`. A Postgres
--   auth hook runs inside the token-issuance transaction and is NOT retryable:
--   any exception blocks EVERY sign-in and EVERY refresh, locking out all users.
--   Degrading to an unmodified token is always preferable -- the guard already
--   treats an absent claim as "fall back to the header", so a failing hook costs
--   authority, not availability.
--
-- * Postgres hooks get a 2s budget. Both reads are single-row lookups on
--   existing indexes (`idx_users_supabase_auth_id`, `idx_members_user_id`).
--
-- * The claim only changes when a token is issued. Callers that change the
--   active chapter must force `supabase.auth.refreshSession()`, or the old claim
--   persists for up to `jwt_expiry` (3600s).
--
-- * Enabling the hook is NOT part of this migration on hosted projects: local
--   uses `[auth.hook.custom_access_token]` in supabase/config.toml, staging and
--   production must be switched on via the dashboard (Authentication -> Hooks)
--   or the Management API. Until then the claim is simply absent and the header
--   fallback carries context, so deploy order does not matter.

alter table users
  add column if not exists active_chapter_id uuid
    references chapters (id) on delete set null;

comment on column users.active_chapter_id is
  'Persisted active chapter, stamped into the access token as the `active_chapter_id` claim by custom_access_token_hook. Null means "auto-resolve if the user has exactly one membership".';

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  v_claims          jsonb;
  v_user_id         uuid;
  v_active          uuid;
  v_membership_count int;
begin
  select u.id, u.active_chapter_id
    into v_user_id, v_active
    from public.users u
   where u.supabase_auth_id = (event->>'user_id')::uuid;

  -- No app-side profile yet (sign-up before the AuthSyncInterceptor runs).
  if v_user_id is null then
    return event;
  end if;

  -- A persisted selection only counts while the membership still exists.
  if v_active is not null then
    if not exists (
      select 1
        from public.members m
       where m.user_id = v_user_id
         and m.chapter_id = v_active
    ) then
      v_active := null;
    end if;
  end if;

  -- Auto-resolve only when the membership is unambiguous.
  if v_active is null then
    select count(*) into v_membership_count
      from public.members m
     where m.user_id = v_user_id;

    if v_membership_count = 1 then
      select m.chapter_id into v_active
        from public.members m
       where m.user_id = v_user_id;
    end if;
  end if;

  if v_active is null then
    return event;
  end if;

  v_claims := event->'claims';
  v_claims := jsonb_set(v_claims, '{active_chapter_id}', to_jsonb(v_active::text));
  return jsonb_set(event, '{claims}', v_claims);
exception
  when others then
    -- Never block token issuance. See the header note.
    return event;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC by default and Supabase additionally grants
-- anon/authenticated, so all three must be revoked. Roles are guarded on
-- existence to keep the migration portable to bare Postgres substrates (e.g.
-- PGlite in CI), matching the convention used by the atomic RPC migrations.
revoke execute on function public.custom_access_token_hook(jsonb) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.custom_access_token_hook(jsonb) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.custom_access_token_hook(jsonb) from authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
    grant select on table public.users to supabase_auth_admin;
    grant select on table public.members to supabase_auth_admin;

    -- RLS is enabled on both tables with no policies, so SELECT grants alone are
    -- not enough. These are scoped to `supabase_auth_admin` only: the API talks
    -- to Postgres with the service-role key (which bypasses RLS entirely), so no
    -- other caller's visibility changes.
    drop policy if exists "auth_admin_can_read_users" on public.users;
    create policy "auth_admin_can_read_users"
      on public.users
      as permissive
      for select
      to supabase_auth_admin
      using (true);

    drop policy if exists "auth_admin_can_read_members" on public.members;
    create policy "auth_admin_can_read_members"
      on public.members
      as permissive
      for select
      to supabase_auth_admin
      using (true);
  end if;
end
$$;
