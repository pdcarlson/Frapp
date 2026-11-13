-- Member nudges (#4781, the member step of #4777; Paul, 2026-11-13).
--
-- spec/behavior/ai.md § Nudges owns the rules. Frapp picks one moment worth
-- a member's attention (a task coming due that isn't started, one past due,
-- one an officer sent back, or one they finished and deserve a word for),
-- and the AI writes one short card about it for that member's Activity.
--
-- 1. `member_nudges`: one row per card. A member has at most one showing at
--    a time (the partial unique index), and a task is raised once per kind
--    (the unique constraint), so a dismissed card never comes back for the
--    same thing. The card's words are kept only while it shows: closing a
--    card sets `title`, `body` and `start_here` to null (the check), and the
--    row stays as the record that the task was raised.
-- 2. `member_nudge_settings`: the member's own switch, and the quiet stretch
--    that "Fewer like this" starts.
-- 3. `anonymize_user` also deletes the member's cards and settings.
--
-- RLS on and no policies on both tables: API only (service role), like
-- `activity_item_reads`, the other per-member Activity state.

-- 1. ------------------------------------------------------------------------

create table if not exists public.member_nudges (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  -- Why the card exists. `MEMBER_NUDGE_KINDS` in `@repo/validation` is the
  -- same list.
  kind text not null
    check (kind in ('task_due_soon', 'task_overdue', 'task_sent_back', 'task_praise')),
  -- The task the card is about. A deleted task takes its card with it.
  task_id uuid not null references public.tasks (id) on delete cascade,
  title text,
  body text,
  -- "A suggested place to start": one sentence, or null when the card has
  -- none (praise never does).
  start_here text,
  -- `ai`: the model wrote the words. `fixed`: its words failed a check, or
  -- it could not be reached, and the card carries Frapp's fixed sentence.
  written_by text not null check (written_by in ('ai', 'fixed')),
  status text not null default 'showing'
    check (status in ('showing', 'dismissed', 'done', 'expired')),
  -- Set with `dismissed`: `not_now`, `fewer` or `thanks` (a praise card).
  dismiss_reason text
    check (dismiss_reason is null or dismiss_reason in ('not_now', 'fewer', 'thanks')),
  -- The first time the card was on the member's screen.
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  closed_at timestamptz,
  constraint member_nudges_once_per_task_kind unique (user_id, task_id, kind),
  constraint member_nudges_words_only_while_showing check (
    (status = 'showing' and title is not null and body is not null and closed_at is null)
    or (status <> 'showing' and title is null and body is null
        and start_here is null and closed_at is not null)
  )
);

-- One card at a time.
create unique index if not exists member_nudges_one_showing
  on public.member_nudges (chapter_id, user_id)
  where status = 'showing';

-- "This member's recent cards", for the weekly and daily limits.
create index if not exists member_nudges_member_recent
  on public.member_nudges (chapter_id, user_id, created_at desc);

alter table public.member_nudges enable row level security;

-- 2. ------------------------------------------------------------------------

create table if not exists public.member_nudge_settings (
  user_id uuid not null references public.users (id) on delete cascade,
  chapter_id uuid not null references public.chapters (id) on delete cascade,
  -- The member's switch. No row means on.
  enabled boolean not null default true,
  -- No new card before this moment ("Fewer like this").
  quiet_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

alter table public.member_nudge_settings enable row level security;

-- 3. Account deletion purges the member's cards and settings ----------------

-- `anonymize_user` is redefined in full from `20261112165040_ai_consent.sql`;
-- the only change is the `member_nudges` and `member_nudge_settings` deletes.
-- Same signature, so its grants are kept. Those rows' `user_id` cascade never
-- fires, because the `users` row is tombstoned in place, not deleted.
create or replace function anonymize_user(
  p_user_id uuid,
  p_rescan_cards boolean default false
)
returns setof users
language plpgsql
security invoker
-- Pinned explicitly: the PGlite search_path guard (#830) fails this
-- redefinition without it.
set search_path = public, pg_temp
as $$
declare
  v_user users;
  v_was_tombstoned boolean;
begin
  if p_user_id = '00000000-0000-0000-0000-000000000000'::uuid then
    raise exception 'anonymize_user: refusing to anonymize the system user'
      using errcode = 'invalid_parameter_value';
  end if;

  -- #2878: the link lock of every chapter the member linked in, taken BEFORE
  -- the user row below, in the order the import trigger and the link
  -- functions take them (link lock, then a key-share on `users` through the
  -- sender foreign key). Taken after, the two would deadlock. Holding it, an
  -- import batch whose trigger already attached a row to the member commits
  -- before the scrub reads, and one that has not yet read the link finds it
  -- gone. A link made in a chapter not listed here waits on the user row and
  -- then refuses the tombstone (`link_discord_author`). The one window left,
  -- an import in such a chapter attaching a row between that link committing
  -- and this scrub, is closed by the deletion flow's second, converging call
  -- (`AccountDeletionService`, `p_rescan_cards`), which runs this scrub again.
  perform pg_advisory_xact_lock(discord_author_link_lock_key(l.chapter_id))
     from (
       select distinct chapter_id from discord_author_links
        where user_id = p_user_id
        order by chapter_id
     ) l;

  select * into v_user from users where id = p_user_id for update;
  if not found then
    return; -- unknown user: empty result, the API maps this to 404
  end if;

  v_was_tombstoned := v_user.deleted_at is not null;

  update users
     set email = 'deleted+' || p_user_id::text || '@anonymized.invalid',
         display_name = 'Deleted User',
         avatar_url = null,
         bio = null,
         graduation_year = null,
         current_city = null,
         current_company = null,
         major = null,
         phone = null,
         active_chapter_id = null,
         deleted_at = coalesce(v_user.deleted_at, now())
   where id = p_user_id
   returning * into v_user;

  delete from members where user_id = p_user_id;
  delete from user_settings where user_id = p_user_id;
  delete from push_tokens where user_id = p_user_id;
  delete from notifications where user_id = p_user_id;
  delete from notification_preferences where user_id = p_user_id;
  delete from chat_notification_preferences where user_id = p_user_id;
  delete from channel_read_receipts where user_id = p_user_id;
  delete from chat_message_bookmarks where user_id = p_user_id;
  delete from chat_member_blocks where blocker_user_id = p_user_id;
  delete from chat_sidebar_preferences where user_id = p_user_id;
  delete from chat_sidebar_pins where user_id = p_user_id;
  -- Message threads (#3785): which threads the member follows or muted, and
  -- how far they read each. Per-user current state, like the sidebar rows.
  delete from chat_thread_follows where user_id = p_user_id;
  -- Activity links (#3897): the member's own Done and Hide states.
  delete from chat_link_member_states where user_id = p_user_id;
  -- Documents (#3934): the member's own starred folders and files.
  delete from chapter_document_stars where user_id = p_user_id;
  -- Activity unread dots (#4173): which Activity items the member opened.
  delete from activity_item_reads where user_id = p_user_id;
  delete from activity_unread_starts where user_id = p_user_id;
  -- Important strip (#4186): which Important messages the member has seen.
  delete from chat_message_important_seen where user_id = p_user_id;
  -- AI consent (#4308): the member's answers on the AI sheet. Deleting an
  -- account counts as turning AI off (spec/behavior/ai.md § Consent).
  delete from user_ai_consents where user_id = p_user_id;
  -- Member nudges (#4781): the member's cards and their own switch.
  delete from member_nudges where user_id = p_user_id;
  delete from member_nudge_settings where user_id = p_user_id;
  -- AI suggestions (#4309): the member's words leave every suggestion that
  -- quotes them, as a No on the sheet does. Decided rows hold no quote.
  update ai_suggestions set quote = null, quote_author_id = null
   where quote_author_id = p_user_id;
  delete from rush_candidate_votes where voter_id = p_user_id;
  delete from study_sessions where user_id = p_user_id;

  -- #2878: the Discord identity on imported rows attributed to this member.
  -- Unconditional (not under the rescan gate below): it is idempotent, and a
  -- retry after a link made before this migration must still reach it.

  -- Reports on those rows keep the reported words (data-retention.md), but
  -- not the Discord name: the officer queue falls back to it when the sender
  -- is off the roster, and a deleted member always is.
  update chat_message_reports r
     set reported_author_name = null
   where r.reported_author_name is not null
     and (r.reported_sender_id = p_user_id
       or exists (
         select 1 from chat_messages m
          where m.id = r.message_id
            and m.kind = 'imported'
            and m.sender_id = p_user_id
       ));

  update chat_messages
     set author_name = null,
         author_avatar_path = null,
         author_external_id = null,
         payload = case
           when payload ? 'author_username' then payload - 'author_username'
           else payload
         end
   where kind = 'imported'
     and sender_id = p_user_id
     and (author_name is not null
       or author_avatar_path is not null
       or author_external_id is not null
       or payload ? 'author_username');
  delete from discord_author_links where user_id = p_user_id;

  if not v_was_tombstoned or p_rescan_cards then
    update chat_messages
       set payload = case
             when payload is null then payload
             else payload
               || case when kind = 'task' and payload->>'assigner_user_id' = p_user_id::text
                       then jsonb_build_object('assigner_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'task' and payload->>'assignee_user_id' = p_user_id::text
                       then jsonb_build_object('assignee_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'points' and payload->>'actor_user_id' = p_user_id::text
                       then jsonb_build_object('actor_name', 'Deleted User')
                       else '{}'::jsonb end
               || case when kind = 'points' and payload->>'recipient_user_id' = p_user_id::text
                       then jsonb_build_object('recipient_name', 'Deleted User')
                       else '{}'::jsonb end
           end,
           content = case
             when kind = 'task' and payload->>'assignee_user_id' = p_user_id::text
               then anonymize_card_content(content, payload->>'assignee_name')
             when kind = 'points' and payload->>'recipient_user_id' = p_user_id::text
               then anonymize_card_content(content, payload->>'recipient_name')
             when kind = 'event' and sender_id = p_user_id
               then regexp_replace(content, '^(.*?)( scheduled ")', 'Deleted User\2')
             else content
           end
     where (kind = 'task' and (payload->>'assigner_user_id' = p_user_id::text
                            or payload->>'assignee_user_id' = p_user_id::text))
        or (kind = 'points' and (payload->>'actor_user_id' = p_user_id::text
                              or payload->>'recipient_user_id' = p_user_id::text))
        or (kind = 'event' and sender_id = p_user_id);

    update chat_message_reports r
       set reported_content = m.content
      from chat_messages m
     where r.message_id = m.id
       and ((m.kind = 'task' and (m.payload->>'assigner_user_id' = p_user_id::text
                               or m.payload->>'assignee_user_id' = p_user_id::text))
         or (m.kind = 'points' and (m.payload->>'actor_user_id' = p_user_id::text
                                 or m.payload->>'recipient_user_id' = p_user_id::text))
         or (m.kind = 'event' and m.sender_id = p_user_id));
  end if;

  return next v_user;
end;
$$;
