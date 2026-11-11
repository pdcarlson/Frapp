-- Events record who made them (#3897, step 4 of the Activity series).
--
-- spec/behavior/activity.md § Made by you owns the rule: the Activity page
-- lists the upcoming events a member made, so they can find one again to
-- edit it. Nothing recorded an event's creator before this; the creator's id
-- went to the announcement and was never stored.
--
-- Additive only:
--
-- 1. `events.created_by` (nullable, FK to `users (id)`, on delete set null).
--    `POST /v1/events` fills it with the caller, and a recurring series'
--    generated occurrences copy it from their head. Existing events, the
--    demo seed and any row written outside that route have none, so they
--    stay out of "Made by you". Account deletion tombstones the `users` row
--    in place (`anonymize_user`), so the `on delete set null` covers only a
--    hard delete of the row, which no product path does.
-- 2. An index on `(chapter_id, created_by, start_time)` for rows that have a
--    creator, the read "my events that have not ended yet" uses.
--
-- `events` writes go through the API (service role); this adds no policy.

alter table public.events
  add column if not exists created_by uuid;

-- `not valid`, then validated, the shape the other foreign keys added to
-- existing tables use. Every existing row is null, so validation scans
-- nothing it can reject.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'events_created_by_fk'
  ) then
    alter table public.events
      add constraint events_created_by_fk
      foreign key (created_by) references public.users (id)
      on delete set null
      not valid;
  end if;
end
$$;

alter table public.events validate constraint events_created_by_fk;

create index if not exists events_chapter_created_by_start_idx
  on public.events (chapter_id, created_by, start_time)
  where created_by is not null;
