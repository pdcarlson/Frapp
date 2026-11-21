-- The weekly recap push's once-a-week claim (#4985). Before the API sends a
-- member last week's recap for a chapter, it inserts the row for that
-- chapter, member and week with `on conflict do nothing`; only the insert
-- that lands sends, so a member hears once however many API replicas tick.
create table if not exists public.activity_recap_pushes (
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- The first day of the week the push sums up, in the member's own zone.
  week_first_day date not null,
  created_at timestamptz not null default now(),
  primary key (chapter_id, user_id, week_first_day)
);

-- Read and written only by the API's service role: no member policies.
alter table public.activity_recap_pushes enable row level security;

-- Account deletion: `anonymize_user` tombstones the users row rather than
-- deleting it, so the cascade above never fires. A claim records which weeks
-- a member was sent a recap in which chapter, current-state data the scrub
-- drops (spec/behavior/data-retention.md), as `birthday_posts`' trigger does.
create or replace function public.users_clear_activity_recap_pushes_on_tombstone()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.deleted_at is not null then
    delete from public.activity_recap_pushes where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists users_clear_activity_recap_pushes_on_tombstone on public.users;
create trigger users_clear_activity_recap_pushes_on_tombstone
  after update on public.users
  for each row
  when (new.deleted_at is not null)
  execute function public.users_clear_activity_recap_pushes_on_tombstone();

-- A trigger needs no grant, and must not be callable as an RPC (#830).
revoke execute on function public.users_clear_activity_recap_pushes_on_tombstone()
  from public, anon, authenticated;
