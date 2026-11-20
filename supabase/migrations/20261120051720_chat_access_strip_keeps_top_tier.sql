-- A deleted role, tier or group no longer leaves a channel's list empty.
--
-- Until now `chat_access_strip_entry` (20261111233000) took the deleted
-- entry off every who-can-see and who-can-post list, and a list that held
-- only that entry was left empty, which admits nobody but `*`. On staging on
-- 2026-11-20 deleting a tier hid Devs-discussion and Dev Log from everyone
-- but the President. The API refuses an empty list on every write, so an
-- empty list is only ever this trigger's leftover.
--
-- Now a list the delete would empty falls back to the chapter's top tier
-- (its lowest `position`): the officers still see the channel and can pick
-- who else should. Not null, which would open the channel to the whole
-- chapter, and not a refusal, which would block deleting a role over a
-- channel the officer may not even manage. A chapter with no tier left
-- keeps the old behavior (an empty list).
--
-- Lists already left empty by the old trigger get the same fallback.

create or replace function public.chat_access_strip_entry()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text := tg_argv[0] || ':' || old.id::text;
  v_fallback text[];
begin
  -- After delete, a deleted tier is already gone from role_tiers.
  select array['tier:' || t.id::text]
    into v_fallback
    from public.role_tiers t
   where t.chapter_id = old.chapter_id
   order by t.position
   limit 1;
  v_fallback := coalesce(v_fallback, '{}'::text[]);

  update public.chat_channels
     set who_can_see = case when v_key = any (who_can_see)
                            then coalesce(nullif(array_remove(who_can_see, v_key), '{}'::text[]), v_fallback)
                            else who_can_see end,
         who_can_post = case when v_key = any (who_can_post)
                             then coalesce(nullif(array_remove(who_can_post, v_key), '{}'::text[]), v_fallback)
                             else who_can_post end
   where chapter_id = old.chapter_id
     and (v_key = any (who_can_see) or v_key = any (who_can_post));
  update public.chat_channel_categories
     set who_can_see = case when v_key = any (who_can_see)
                            then coalesce(nullif(array_remove(who_can_see, v_key), '{}'::text[]), v_fallback)
                            else who_can_see end,
         who_can_post = case when v_key = any (who_can_post)
                             then coalesce(nullif(array_remove(who_can_post, v_key), '{}'::text[]), v_fallback)
                             else who_can_post end
   where chapter_id = old.chapter_id
     and (v_key = any (who_can_see) or v_key = any (who_can_post));
  return old;
end;
$$;

revoke execute on function public.chat_access_strip_entry()
  from public, anon, authenticated;

-- Repair lists the old trigger already emptied.
with top_tier as (
  select distinct on (chapter_id) chapter_id, 'tier:' || id::text as entry
    from public.role_tiers
   order by chapter_id, position
)
update public.chat_channels c
   set who_can_see = case when cardinality(c.who_can_see) = 0
                          then array[t.entry] else c.who_can_see end,
       who_can_post = case when cardinality(c.who_can_post) = 0
                           then array[t.entry] else c.who_can_post end
  from top_tier t
 where t.chapter_id = c.chapter_id
   and (cardinality(c.who_can_see) = 0 or cardinality(c.who_can_post) = 0);

with top_tier as (
  select distinct on (chapter_id) chapter_id, 'tier:' || id::text as entry
    from public.role_tiers
   order by chapter_id, position
)
update public.chat_channel_categories c
   set who_can_see = case when cardinality(c.who_can_see) = 0
                          then array[t.entry] else c.who_can_see end,
       who_can_post = case when cardinality(c.who_can_post) = 0
                           then array[t.entry] else c.who_can_post end
  from top_tier t
 where t.chapter_id = c.chapter_id
   and (cardinality(c.who_can_see) = 0 or cardinality(c.who_can_post) = 0);
