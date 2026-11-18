-- Nudge cards from more than the member's own tasks (#5464, epic #4777;
-- Paul, 2026-11-18).
--
-- spec/behavior/ai.md § Nudges owns the rules. The card on Activity now picks
-- from events, sign-ups, mentions, announcements, new minutes, the study goal
-- and an officer's queue as well as the member's own tasks, and it shows
-- whether or not AI is available: without AI it carries no generated words.
--
-- 1. `task_id` becomes nullable, and `subject_key` names what the card is
--    about for every kind: the task's id for a task card, the event's or the
--    sign-up message's id, or a channel and its latest message for a mention
--    or an announcement, so a card waved off comes back only when something
--    new arrives. A card is raised once per subject and kind, as before.
-- 2. `kind` takes the new kinds (`MEMBER_NUDGE_KINDS` in `@repo/validation`).
-- 3. `written_by` takes `plain`: a card that never asked the model, because
--    AI is off for this member or this server, or its kind is never written.
-- 4. `body` may be null while showing: a plain card has no sentence.
--    The words are still deleted when the card closes.
--
-- Existing rows: every one is a task card, so its `subject_key` is its task.

alter table public.member_nudges
  add column if not exists subject_key text;

update public.member_nudges
   set subject_key = task_id::text
 where subject_key is null;

alter table public.member_nudges
  alter column subject_key set not null,
  alter column task_id drop not null;

alter table public.member_nudges
  drop constraint if exists member_nudges_once_per_task_kind;

alter table public.member_nudges
  drop constraint if exists member_nudges_once_per_subject_kind;
alter table public.member_nudges
  add constraint member_nudges_once_per_subject_kind
  unique (chapter_id, user_id, kind, subject_key);

alter table public.member_nudges
  drop constraint if exists member_nudges_kind_check;
alter table public.member_nudges
  add constraint member_nudges_kind_check check (kind in (
    'task_due_soon', 'task_overdue', 'task_sent_back', 'task_praise',
    'event_soon', 'mention_unread', 'announcement_unread', 'signup_open',
    'officer_queue', 'minutes_new', 'study_behind'
  ));

-- A task card still names its task.
alter table public.member_nudges
  drop constraint if exists member_nudges_task_kinds_name_a_task;
alter table public.member_nudges
  add constraint member_nudges_task_kinds_name_a_task check (
    kind not like 'task\_%' or task_id is not null
  );

alter table public.member_nudges
  drop constraint if exists member_nudges_written_by_check;
alter table public.member_nudges
  add constraint member_nudges_written_by_check
  check (written_by in ('ai', 'fixed', 'plain'));

alter table public.member_nudges
  drop constraint if exists member_nudges_words_only_while_showing;
alter table public.member_nudges
  add constraint member_nudges_words_only_while_showing check (
    (status = 'showing' and title is not null and closed_at is null)
    or (status <> 'showing' and title is null and body is null
        and start_here is null and closed_at is not null)
  );
