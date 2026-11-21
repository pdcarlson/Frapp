-- Snooze on Activity (#4982, item 7 of #4402; Shawn, 2026-11-14).
--
-- spec/behavior/activity.md § Snooze owns the rule. A member can hide a row
-- that waits on them until a time they pick; it leaves their list and the
-- tab's badge, and comes back then, unread unless they open it again after
-- that time, the way Gmail's Snooze and Slack's Later work.
--
-- One row per member per item, by the same kind and id as
-- `activity_item_reads`. The items come from several modules, so `item_id`
-- has no foreign key; a row whose item is gone is inert. A snooze that has
-- ended is kept: its `until` is when the row came back, which the unread rule
-- reads. Snoozing an item again replaces it.
--
-- The member's snoozes cascade with their membership (`members` is
-- `unique (user_id, chapter_id)`), so leaving the chapter drops them and
-- account deletion, which deletes the member's `members` rows in
-- `anonymize_user`, drops them with no change to that function.
--
-- RLS on and no policies: API only (service role), like
-- `activity_item_reads`.

create table if not exists public.activity_item_snoozes (
  user_id uuid not null,
  chapter_id uuid not null,
  -- `ACTIVITY_ITEM_KINDS` in the API is the same list, as for reads.
  kind text not null
    check (kind in ('task', 'hours_entry', 'poll', 'event', 'link', 'signup', 'form')),
  item_id uuid not null,
  -- When the row comes back.
  until timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, chapter_id, kind, item_id),
  constraint activity_item_snoozes_member_fkey
    foreign key (user_id, chapter_id)
    references public.members (user_id, chapter_id)
    on delete cascade
);

-- The one read, "this member's snoozes in this chapter that ended recently or
-- haven't", filters on the primary key's leading columns and `until`.
create index if not exists idx_activity_item_snoozes_member_until
  on public.activity_item_snoozes (user_id, chapter_id, until);

alter table public.activity_item_snoozes enable row level security;
