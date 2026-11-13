-- A series edit carries its upcoming excuses over to the rebuilt meetings (#4620).
--
-- WHAT CHANGES
--
-- A series edit that changes its times or repeat rule rebuilds the upcoming
-- occurrences: the API inserts new rows, then deletes the old ones. Before
-- this, that delete cascaded every excuse on the old rows away
-- (`event_excuses.event_id` is `on delete cascade`), along with an approved
-- excuse's EXCUSED row in `event_attendance`, and nobody was told.
--
-- `delete_replaced_occurrences` does the delete instead, in one transaction
-- with the carry-over:
--
--   1. For each (from, to) pair the API matched, an approved excuse's EXCUSED
--      attendance row moves to the new meeting, then every excuse on the old
--      meeting does (pending, approved and declined alike: a decision already
--      made stays made).
--   2. The excuses still on an old row (no new meeting replaced it) are read,
--      pending and approved only, and returned, so the API can tell those
--      members to send their excuse again.
--   3. The old rows are deleted.
--
-- All or nothing: if any step fails, the old rows keep their excuses and the
-- API's recovery deletes the new rows it inserted, exactly as before.
--
-- Only the service role (the API) may call it, like the other excuse
-- functions (20261113040003_event_excuses.sql).

create or replace function public.delete_replaced_occurrences(
  p_chapter_id uuid,
  p_old_ids uuid[],
  p_from_ids uuid[],
  p_to_ids uuid[]
)
returns setof public.event_excuses
language plpgsql
volatile
security invoker
set search_path = public, pg_temp
as $$
begin
  if coalesce(array_length(p_from_ids, 1), 0)
     <> coalesce(array_length(p_to_ids, 1), 0) then
    raise exception 'from and to must pair up'
      using errcode = '22023';
  end if;

  -- Both ends of every pair are this chapter's events, and only an old row
  -- being deleted is carried from.
  if exists (
    select 1
      from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
     where not (m.from_id = any(p_old_ids))
        or not exists (
          select 1 from public.events e
           where e.id = m.to_id and e.chapter_id = p_chapter_id
        )
  ) then
    raise exception 'every pair must carry from an old occurrence to one of the chapter''s events'
      using errcode = '22023';
  end if;

  -- An approved excuse's EXCUSED row first, while the excuse still says which
  -- member it belongs to on the old meeting.
  update public.event_attendance a
     set event_id = m.to_id
    from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
   where a.event_id = m.from_id
     and a.status = 'EXCUSED'
     and exists (
       select 1 from public.event_excuses x
        where x.event_id = m.from_id
          and x.user_id = a.user_id
          and x.chapter_id = p_chapter_id
          and x.status = 'APPROVED'
     );

  update public.event_excuses x
     set event_id = m.to_id
    from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
   where x.event_id = m.from_id
     and x.chapter_id = p_chapter_id;

  return query
    select x.*
      from public.event_excuses x
     where x.event_id = any(p_old_ids)
       and x.chapter_id = p_chapter_id
       and x.status in ('PENDING', 'APPROVED');

  delete from public.events
   where id = any(p_old_ids)
     and chapter_id = p_chapter_id;
end;
$$;

revoke execute on function public.delete_replaced_occurrences(uuid, uuid[], uuid[], uuid[]) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.delete_replaced_occurrences(uuid, uuid[], uuid[], uuid[]) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.delete_replaced_occurrences(uuid, uuid[], uuid[], uuid[]) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.delete_replaced_occurrences(uuid, uuid[], uuid[], uuid[]) to service_role;
  end if;
end
$$;
