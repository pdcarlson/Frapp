-- Two gaps in what a deleted account takes with it (#4504 items 2 and 3).
-- Both were found by the final review of the AI build-out and matter only
-- once AI is on for a chapter.
--
-- 1. A transcript could outlive its uploader as another officer's draft.
--    Officer A uploads a recording, officer B drafts minutes from its
--    transcript, A deletes their account. The recording's row went (it is
--    A's), but B's `meeting_drafts.notes` held the same transcript until the
--    minutes posted or 30 days passed. `spec/behavior/meetings.md` says the
--    transcript goes with the uploader's account.
--
--    The draft does not record where its notes came from (the transcript
--    reaches it through the officer's notes box), so this takes the draft of
--    every meeting whose current recording the deleted account uploaded.
--    That can remove a draft whose notes B typed by hand; B drafts again.
--    Losing an unposted draft is the cheap side of that choice.
--
-- 2. A report could outlive a quoted member who deleted their account in
--    the same instant. `ai_reports.quoted_user_ids` is an array with no
--    foreign key, so the insert check and the account's delete trigger could
--    each miss the other's uncommitted change. The check now locks the
--    users it reads `for share`, which waits for an account deletion in
--    flight (and makes one that starts later wait for the report), so one of
--    the two always sees the other. `for key share` would not do: an update
--    of `deleted_at` does not conflict with it.
--
-- Locks. Two function bodies are replaced; no table is altered and no
-- trigger is re-created, so nothing here takes more than the catalog locks
-- `create or replace function` needs. The new `for share` holds a row lock
-- on a handful of `users` rows for the length of one report insert.
--
-- Safe to apply twice.

-- 1. ------------------------------------------------------------------------

create or replace function public.meeting_recordings_drop_for_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Before the recordings go, while they still say which meetings they were.
  delete from public.meeting_drafts d
   using public.meeting_recordings r
   where r.uploaded_by = new.id
     and d.meeting_id = r.meeting_id;
  delete from public.meeting_recordings where uploaded_by = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_recordings_drop_for_deleted_user()
  from public, anon, authenticated;

-- 2. ------------------------------------------------------------------------

create or replace function public.ai_reports_refuse_deleted_users()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Ordered, so two reports quoting the same members lock them the same way.
  perform 1
    from public.users u
   where u.id = new.reported_by or u.id = any (new.quoted_user_ids)
   order by u.id
     for share;
  if exists (
    select 1
    from public.users u
    where (u.id = new.reported_by or u.id = any (new.quoted_user_ids))
      and u.deleted_at is not null
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function public.ai_reports_refuse_deleted_users()
  from public, anon, authenticated;
