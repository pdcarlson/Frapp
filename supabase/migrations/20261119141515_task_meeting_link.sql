-- Tasks made from minutes name their meeting by id (#5562).
--
-- A task suggested from posted minutes used to carry "From the minutes of
-- <meeting name>." in its description, so a renamed meeting left the old
-- name behind (Paul, 2026-11-19: "can we 'tag' the meeting by meeting id? in
-- case the name changes?"). The task, and a posting up for grabs, now keep
-- the minutes' id, and each screen reads the meeting's name live, under the
-- reader's own right to read those minutes.
--
-- 1. `meeting_id` on tasks and open_tasks. No foreign key: an accept that
--    races the minutes' delete must still make its task (the suggestion
--    service already expects its source to vanish mid-accept), and the
--    screens read the meeting under the reader's rule, so an id whose
--    minutes are gone simply shows nothing.
-- 2. `claim_open_task` carries the posting's meeting to the task it writes.
-- 3. Backfill from the accepted suggestions, then take the old
--    "From the minutes of …" line out of the descriptions now linked.

alter table public.tasks add column if not exists meeting_id uuid;
alter table public.open_tasks add column if not exists meeting_id uuid;

-- Small and sparse: only tasks made from minutes have one.
create index if not exists tasks_meeting_id_idx
  on public.tasks (meeting_id) where meeting_id is not null;
create index if not exists open_tasks_meeting_id_idx
  on public.open_tasks (meeting_id) where meeting_id is not null;

-- Same signature and body as 20261118043407, plus the meeting.
create or replace function public.claim_open_task(
  p_chapter_id uuid,
  p_open_task_id uuid,
  p_assignee_id uuid,
  p_created_by uuid
)
returns setof public.tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_posting public.open_tasks%rowtype;
  v_task_id uuid;
begin
  select * into v_posting
    from public.open_tasks
   where id = p_open_task_id
     and chapter_id = p_chapter_id
   for update;

  if not found then
    raise exception 'no such open task' using errcode = 'P0002';
  end if;
  if v_posting.status <> 'open' then
    raise exception 'Someone already claimed this' using errcode = 'FR409';
  end if;

  insert into public.tasks (
    chapter_id, title, description, assignee_id, created_by, due_date,
    due_at, status, point_reward, points_awarded, proof_kind, meeting_id
  )
  values (
    v_posting.chapter_id, v_posting.title, v_posting.description,
    p_assignee_id, coalesce(p_created_by, v_posting.created_by),
    v_posting.due_date, v_posting.due_at, 'TODO', v_posting.point_reward,
    false, v_posting.proof_kind, v_posting.meeting_id
  )
  returning id into v_task_id;

  insert into public.task_subtasks (task_id, chapter_id, title, position)
  select v_task_id, v_posting.chapter_id, t.title, (t.ord - 1)::int
    from unnest(v_posting.subtask_titles) with ordinality as t(title, ord);

  update public.open_tasks
     set status = 'claimed',
         claimed_task_id = v_task_id,
         claimed_by = p_assignee_id,
         claimed_at = now(),
         updated_at = now()
   where id = v_posting.id;

  return query select * from public.tasks where id = v_task_id;
end;
$$;

-- Backfill: what each accepted task suggestion from minutes became. A task
-- for a group links every copy; a posting links itself and the task it was
-- claimed as. Only a meeting of the same chapter that still exists. Each
-- pass is a plain join on a key (the task's id, then its group's id), so it
-- touches only the linked rows while the column's ALTER holds the table.
with made as (
  select s.chapter_id, s.source_id as meeting_id, s.result_id
    from public.ai_suggestions s
    join public.meetings m
      on m.id = s.source_id and m.chapter_id = s.chapter_id
   where s.kind = 'task'
     and s.status = 'accepted'
     and s.source_type = 'meeting'
     and s.result_id is not null
)
update public.tasks t
   set meeting_id = made.meeting_id
  from made
 where t.id = made.result_id
   and t.chapter_id = made.chapter_id
   and t.meeting_id is null;

-- The other copies of a group whose first copy was the accept's result.
update public.tasks t
   set meeting_id = linked.meeting_id
  from public.tasks linked
 where linked.meeting_id is not null
   and linked.group_id is not null
   and t.group_id = linked.group_id
   and t.chapter_id = linked.chapter_id
   and t.meeting_id is null;

with made as (
  select s.chapter_id, s.source_id as meeting_id, s.result_id
    from public.ai_suggestions s
    join public.meetings m
      on m.id = s.source_id and m.chapter_id = s.chapter_id
   where s.kind = 'task'
     and s.status = 'accepted'
     and s.source_type = 'meeting'
     and s.result_id is not null
)
update public.open_tasks o
   set meeting_id = made.meeting_id
  from made
 where o.id = made.result_id
   and o.chapter_id = made.chapter_id
   and o.meeting_id is null;

update public.tasks t
   set meeting_id = o.meeting_id
  from public.open_tasks o
 where o.claimed_task_id = t.id
   and o.meeting_id is not null
   and t.meeting_id is null;

-- The old line goes from the descriptions now linked: the screens say where
-- the task came from, with the meeting's name as it is now. A description
-- that was only that line becomes empty; one that also held the whole
-- action item (a title cut short) keeps the action item.
update public.tasks
   set description = nullif(
     btrim(regexp_replace(description, '\s*From the minutes of [^\n]*\.\s*$', '')),
     ''
   )
 where meeting_id is not null
   and description ~ 'From the minutes of [^\n]*\.\s*$';

update public.open_tasks
   set description = nullif(
     btrim(regexp_replace(description, '\s*From the minutes of [^\n]*\.\s*$', '')),
     ''
   )
 where meeting_id is not null
   and description ~ 'From the minutes of [^\n]*\.\s*$';

-- A suggestion still waiting carries the same line in its payload; it goes
-- there too, so accepting it later makes a task without it.
update public.ai_suggestions
   set payload = jsonb_set(
     payload,
     '{description}',
     coalesce(
       to_jsonb(nullif(
         btrim(regexp_replace(payload->>'description', '\s*From the minutes of [^\n]*\.\s*$', '')),
         ''
       )),
       'null'::jsonb
     )
   )
 where kind = 'task'
   and source_type = 'meeting'
   and status = 'pending'
   and payload->>'description' ~ 'From the minutes of [^\n]*\.\s*$';
