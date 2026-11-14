-- An event's agenda and attachments (#4934).
--
-- WHAT CHANGES
--
-- `events` gains two columns, both JSON arrays the API validates and writes
-- whole on `PATCH /v1/events/:id` (who may write and read is the event's own
-- rule: `events:update` writes, whoever can see the event reads):
--
--   agenda       [{ id, text, done }]: the meeting's ordered list of short
--                items, at most 30 (EVENT_AGENDA_MAX in @repo/validation).
--   attachments  [{ id, kind: 'link', url, title }
--                 | { id, kind: 'document', document_id, title }]: a titled
--                link, or one of the chapter's Chapter Files documents, at
--                most 10 (EVENT_ATTACHMENTS_MAX).
--
-- Both belong to one meeting, not to a series: a new occurrence starts with
-- none, and a series edit never copies them. So that a series edit which
-- rebuilds its upcoming meetings (#4620) doesn't drop them,
-- `delete_replaced_occurrences` now copies each old meeting's agenda and
-- attachments onto the meeting that replaces it, in the same transaction as
-- the excuses it already carries.
--
-- Existing rows read as empty lists. Nothing else changes.

alter table public.events
  add column if not exists agenda jsonb not null default '[]'::jsonb,
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.events
  drop constraint if exists events_agenda_is_list,
  add constraint events_agenda_is_list check (
    jsonb_typeof(agenda) = 'array' and jsonb_array_length(agenda) <= 30
  ),
  drop constraint if exists events_attachments_is_list,
  add constraint events_attachments_is_list check (
    jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 10
  );

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

  -- A meeting's agenda and attachments are its own (#4934), so a rebuilt
  -- meeting takes over the one it replaces.
  update public.events e
     set agenda = o.agenda,
         attachments = o.attachments
    from unnest(p_from_ids, p_to_ids) as m(from_id, to_id)
    join public.events o
      on o.id = m.from_id
     and o.chapter_id = p_chapter_id
   where e.id = m.to_id
     and e.chapter_id = p_chapter_id;

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
