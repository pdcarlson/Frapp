-- `get_request_context` no longer answers a deleted account's user row
-- (#5043).
--
-- Since Paul's 2026-11-16 decision, a chapter-scoped read can verify the
-- caller's access token locally instead of asking Supabase Auth
-- (`@VerifySessionLocally()` in the API). Such a token stays valid until it
-- expires even after its account is deleted, so the per-request `users` lookup
-- is what has to refuse it: `anonymize_user` tombstones the row and sets
-- `deleted_at`, and a tombstone is now no user at all. A locally verified read
-- starts this call (`prefetchChapterContext`) like any chapter request, and
-- `ChapterGuard` takes its `user` from the answer. When the call fails, the
-- guard's direct read (`lookupAppUser`) stands in, with the same filter, so
-- both forms refuse a tombstone.
--
-- `create or replace` keeps the function's grants (EXECUTE for `service_role`
-- only, from 20261112151000). Nothing else changes: same arguments, same
-- answer shape, same columns.

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
      and u.deleted_at is null
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
