-- One round trip for what a chapter route's guards read about the caller
-- (#3583, #4342).
--
-- Before any handler runs, `ChapterGuard` and `PermissionsGuard` need the
-- caller's `users.id`, the chapter's subscription state and module toggles, the
-- caller's membership row in that chapter, and the roles it names. The API
-- starts those reads while `auth.getUser` is still checking the session
-- (`prefetchChapterContext`), but each read needs the one before it: user,
-- then membership, then roles. Production on 2026-11-12, after v0.27.0: the
-- three PostgREST calls had p50s of 91, 127 and 105 ms, so the chain took about
-- 320 ms while the session check it overlaps took 134 ms, and every
-- chapter-scoped request waited on it.
--
-- This returns all four in one call, as one jsonb object:
--
--   user     {"id": ...} or null       (users by supabase_auth_id)
--   chapter  {"subscription_status", "past_due_since", "enabled_modules"}
--            or null
--   member   the members row for (user, chapter), every column, or null
--   roles    the roles rows whose id is in member.role_ids and whose
--            chapter_id is the chapter, every column; [] without a member
--
-- Each part is the same row set, filters and columns the guard's own query
-- reads, so the API can hand the answer to the code that would have made those
-- reads. It decides nothing: whether the caller may proceed is still the
-- guards' call, and only after the session check has passed for this same
-- user. `members` is `unique (user_id, chapter_id)` and `users.supabase_auth_id`
-- is unique, so each scalar subquery yields at most one row. `role_ids` is
-- `text[]`; casting it to `uuid[]` compares the way PostgREST's `.in('id', …)`
-- does (case-insensitively, and failing on an entry that is not a uuid, which
-- the API then answers by reading each row itself). Production had no such
-- entry on 2026-11-12. There the body ran in under 1 ms warm.
--
-- Security invoker, EXECUTE for `service_role` only: the API's client is the
-- only caller, and it already reads these tables directly.

create or replace function public.get_request_context(
  p_auth_id    uuid,
  p_chapter_id uuid
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with app_user as (
    select u.id
    from users u
    where u.supabase_auth_id = p_auth_id
  ),
  membership as (
    select m.*
    from members m
    join app_user u on m.user_id = u.id
    where m.chapter_id = p_chapter_id
  )
  select jsonb_build_object(
    'user', (select jsonb_build_object('id', u.id) from app_user u),
    'chapter', (
      select jsonb_build_object(
        'subscription_status', c.subscription_status,
        'past_due_since', c.past_due_since,
        'enabled_modules', c.enabled_modules
      )
      from chapters c
      where c.id = p_chapter_id
    ),
    'member', (select to_jsonb(m) from membership m),
    'roles', (
      select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
      from roles r
      join membership m on r.id = any (m.role_ids::uuid[])
      where r.chapter_id = p_chapter_id
    )
  );
$$;

revoke execute on function public.get_request_context(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.get_request_context(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.get_request_context(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_request_context(uuid, uuid) to service_role;
  end if;
end
$$;
