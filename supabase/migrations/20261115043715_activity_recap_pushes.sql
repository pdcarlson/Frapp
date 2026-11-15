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
