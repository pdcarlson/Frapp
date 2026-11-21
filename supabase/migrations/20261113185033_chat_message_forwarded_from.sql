-- Forward a message (#4864, step 4 of #3723).
--
-- spec/behavior/chat/README.md owns the rule. A forward is an ordinary text
-- message in the destination, sent by the forwarder, whose `content` is their
-- optional comment and whose `forwarded_from` is a server-built copy of the
-- original: the people in the destination may not be able to read the source
-- channel, so the copy is what they see, never a live reference.
--
-- 1. `chat_messages.forwarded_from` (jsonb, null): `message_id`,
--    `channel_id`, `sender_id`, `author_name` (the name at forward time),
--    `content`, `gif`, `attachment_count`, `created_at`, and `deleted` once
--    the original goes. No backfill: every existing row is not a forward.
-- 2. The copy follows the original's deletion (§ No sender-extend on
--    ephemerality: nothing but a pin or a bookmark keeps content past its
--    delete). When the original is soft-deleted or hard-deleted, every
--    forward of it keeps only `message_id`, `channel_id` and `created_at`,
--    with `deleted: true`. An edit to the original changes no copy. The
--    forward's own row update echoes to its channel's open clients.
--    A forward with no comment quotes the original in its notifications
--    ("Forwarded: ..."), so those go too, as a delete removes the
--    notifications quoting it (#4418): the blank triggers delete the
--    notification rows of every forward they blank whose comment is empty.
--    A forward with a comment quotes only the comment, which stays, so its
--    rows stay. Two races are closed with `for share` reads, the pattern of
--    `notifications_skip_deleted_message`:
--    - a forward inserted while its original's delete commits: a BEFORE
--      INSERT trigger reads the original `for share` and, if it is gone or
--      deleted, stores the copy blanked. A forward with no comment then
--      lands as a card reading "Original message was deleted"; it is kept,
--      not refused, since the forwarder did send it.
--    - a notification the push worker inserts after the blanking, built from
--      the pre-blank Realtime row: `notifications_skip_deleted_message` (now
--      redefined here) also drops a row for a forward with no comment whose
--      copy is blanked. Dropped rather than rewritten, because the push the
--      API sends carries the worker's own body, not the row's, and a dropped
--      insert sends no push either.
-- 3. `get_channel_latest_messages` also returns the latest message's
--    `forwarded_from`, so Chat home can preview a forward with no comment
--    ("Forwarded: ..."), withheld when the caller blocked the original's
--    author. Its return type changes, so it is dropped and created again.
-- 4. `anonymize_user` rewrites the deleted member's name in every copy of
--    their messages to "Deleted User", as it does the cards' name snapshots.

-- 1. The column ----------------------------------------------------------------

alter table public.chat_messages
  add column if not exists forwarded_from jsonb;

-- What the deletion triggers probe: the forwards of one message. Partial, so
-- it holds only forwards. Built inline rather than `concurrently` (a
-- migration runs in a transaction); every existing row is null, so it is
-- empty and the build is one pass over the table.
create index if not exists idx_chat_messages_forwarded_from_message
  on public.chat_messages ((forwarded_from ->> 'message_id'))
  where forwarded_from is not null;

-- 2. The copy follows the original's deletion ---------------------------------

-- What a copy keeps once its original is gone: where and when it was, so the
-- card can say "Original message was deleted" in place.
create or replace function public.chat_forward_snapshot_blanked(p_snapshot jsonb)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'message_id', p_snapshot -> 'message_id',
    'channel_id', p_snapshot -> 'channel_id',
    'created_at', p_snapshot -> 'created_at',
    'deleted', true,
    'sender_id', null,
    'author_name', null,
    'content', '',
    'gif', null,
    'attachment_count', 0
  );
$$;

-- `security definer`, as the thread-summary triggers are: the soft delete
-- runs as the API's service role, which bypasses RLS already, but the forwards
-- live in other channels and a future caller may not.
create or replace function public.chat_messages_blank_forwards_on_soft_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update chat_messages f
     set forwarded_from = chat_forward_snapshot_blanked(f.forwarded_from)
   where f.forwarded_from is not null
     and f.forwarded_from ->> 'message_id' = new.id::text
     and coalesce((f.forwarded_from ->> 'deleted')::boolean, false) = false;
  -- A separate statement, so its fresh snapshot also sees a row the push
  -- worker committed while the update above waited on the forward's lock.
  delete from notifications n
   using chat_messages f
   where n.chat_message_id = f.id
     and f.forwarded_from is not null
     and f.forwarded_from ->> 'message_id' = new.id::text
     and regexp_replace(replace(f.content, U&'\FFFC', ' '), '^\s+|\s+$', '', 'g') = '';
  return null;
end
$$;

drop trigger if exists chat_messages_blank_forwards_on_soft_delete on public.chat_messages;
create trigger chat_messages_blank_forwards_on_soft_delete
  after update of is_deleted on public.chat_messages
  for each row
  when (new.is_deleted and not old.is_deleted)
  execute function public.chat_messages_blank_forwards_on_soft_delete();

-- A hard delete (a channel's cascade, the Discord import purge) can remove
-- thousands of rows in one statement, so this one is per statement over the
-- removed rows rather than a probe per row. Forwards removed by the same
-- statement are already gone and match nothing.
create or replace function public.chat_messages_blank_forwards_on_delete()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update chat_messages f
     set forwarded_from = chat_forward_snapshot_blanked(f.forwarded_from)
    from gone g
   where f.forwarded_from is not null
     and f.forwarded_from ->> 'message_id' = g.id::text
     and coalesce((f.forwarded_from ->> 'deleted')::boolean, false) = false;
  delete from notifications n
   using chat_messages f, gone g
   where n.chat_message_id = f.id
     and f.forwarded_from is not null
     and f.forwarded_from ->> 'message_id' = g.id::text
     and regexp_replace(replace(f.content, U&'\FFFC', ' '), '^\s+|\s+$', '', 'g') = '';
  return null;
end
$$;

drop trigger if exists chat_messages_blank_forwards_on_delete on public.chat_messages;
create trigger chat_messages_blank_forwards_on_delete
  after delete on public.chat_messages
  referencing old table as gone
  for each statement
  execute function public.chat_messages_blank_forwards_on_delete();

-- A forward inserted after its original's delete committed, or while it is
-- in flight. The API reads the source, builds the copy and inserts later with
-- no lock, and the AFTER triggers above cannot see a row not yet inserted.
-- `for share` waits out a delete in flight on the original (and makes a
-- delete that starts later wait for this insert, so its trigger, a fresh
-- statement, then sees the forward and blanks it).
create or replace function public.chat_messages_blank_forward_of_deleted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_original_id text := new.forwarded_from ->> 'message_id';
  v_deleted boolean;
begin
  if coalesce((new.forwarded_from ->> 'deleted')::boolean, false) then
    return new;
  end if;
  if v_original_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select is_deleted into v_deleted
      from chat_messages
     where id = v_original_id::uuid
       for share;
  end if;
  if v_deleted is distinct from false then
    new.forwarded_from := chat_forward_snapshot_blanked(new.forwarded_from);
  end if;
  return new;
end
$$;

drop trigger if exists chat_messages_blank_forward_of_deleted on public.chat_messages;
create trigger chat_messages_blank_forward_of_deleted
  before insert on public.chat_messages
  for each row
  when (new.forwarded_from is not null)
  execute function public.chat_messages_blank_forward_of_deleted();

-- Redefined in full from `20261112140000_notifications_chat_message_id.sql`;
-- the only change is the forward step. A row for a forward with no comment
-- quotes the copy, so once the copy is blanked the row is dropped, as a row
-- about a deleted message is. The empty test is the preview's own
-- (`chatPushPreview`: U+FFFC to a space, trimmed).
create or replace function public.notifications_skip_deleted_message()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  msg record;
begin
  -- `for share` waits out a soft delete (or an edit) still in flight on the
  -- message: a plain read would see the last committed row, let the insert
  -- through, and the delete trigger, which cannot see this uncommitted row,
  -- would leave it behind. It also waits out the blanking of a forward's
  -- copy, which updates this row.
  select content, is_deleted, edited_at, forwarded_from into msg
    from chat_messages
   where id = new.chat_message_id
     for share;
  if not found or msg.is_deleted then
    return null;
  end if;
  -- A forward with no comment whose original was deleted (#4864): the worker
  -- built this row from the copy as it was before the blanking.
  if msg.forwarded_from is not null
     and coalesce((msg.forwarded_from ->> 'deleted')::boolean, false)
     and regexp_replace(replace(msg.content, U&'\FFFC', ' '), '^\s+|\s+$', '', 'g') = ''
  then
    return null;
  end if;
  -- The push worker writes every row from the message as it was sent. One
  -- that lands after an edit takes the edited text instead, the same preview
  -- `chatPushPreview` cuts (U+FFFC to a space, trimmed, 200 characters; an
  -- edit always has text, so its attachment fallback never applies here).
  if msg.edited_at is not null then
    new.body := left(
      regexp_replace(replace(msg.content, U&'\FFFC', ' '), '^\s+|\s+$', '', 'g'),
      200
    );
  end if;
  return new;
end
$$;

revoke execute on function public.chat_forward_snapshot_blanked(jsonb) from public;
revoke execute on function public.chat_messages_blank_forwards_on_soft_delete() from public;
revoke execute on function public.chat_messages_blank_forwards_on_delete() from public;
revoke execute on function public.chat_messages_blank_forward_of_deleted() from public;

-- Supabase grants new functions to `anon` and `authenticated` directly, so
-- revoking from `public` alone leaves them callable.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.chat_forward_snapshot_blanked(jsonb) from anon;
    revoke execute on function public.chat_messages_blank_forwards_on_soft_delete() from anon;
    revoke execute on function public.chat_messages_blank_forwards_on_delete() from anon;
    revoke execute on function public.chat_messages_blank_forward_of_deleted() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.chat_forward_snapshot_blanked(jsonb) from authenticated;
    revoke execute on function public.chat_messages_blank_forwards_on_soft_delete() from authenticated;
    revoke execute on function public.chat_messages_blank_forwards_on_delete() from authenticated;
    revoke execute on function public.chat_messages_blank_forward_of_deleted() from authenticated;
  end if;
end
$$;

-- 3. Chat home's preview carries the copy --------------------------------------

-- Redefined from `20261110220000_chat_message_threads.sql`; the only change
-- is the `forwarded_from` column. The copy's `content` is cut to 500
-- characters like the row's own, and a copy of a message by someone the
-- caller blocked keeps only its structure with `sender_blocked: true`, the
-- shape the API's masking reads serve (`chat-block-mask.ts`).
drop function if exists public.get_channel_latest_messages(uuid, uuid);

create function public.get_channel_latest_messages(
  p_chapter_id uuid,
  p_user_id    uuid
)
returns table (
  channel_id       uuid,
  message_id       uuid,
  sender_id        uuid,
  author_name      text,
  content          text,
  kind             text,
  payload          jsonb,
  attachment_count integer,
  created_at       timestamptz,
  forwarded_from   jsonb
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    m.id,
    m.sender_id,
    m.author_name,
    left(m.content, 500),
    m.kind,
    case when m.kind = 'system_audit' then m.payload end,
    case
      when jsonb_typeof(m.metadata -> 'attachment_count') = 'number'
       and (m.metadata ->> 'attachment_count') ~ '^[0-9]{1,6}$'
      then (m.metadata ->> 'attachment_count')::integer
      else 0
    end,
    m.created_at,
    case
      when m.forwarded_from is null then null
      when exists (
        select 1
          from chat_member_blocks b
         where b.chapter_id = p_chapter_id
           and b.blocker_user_id = p_user_id
           and b.blocked_user_id::text = m.forwarded_from ->> 'sender_id'
      ) then jsonb_build_object(
        'message_id', m.forwarded_from -> 'message_id',
        'channel_id', m.forwarded_from -> 'channel_id',
        'sender_id', m.forwarded_from -> 'sender_id',
        'created_at', m.forwarded_from -> 'created_at',
        'author_name', null,
        'content', '',
        'gif', null,
        'attachment_count', 0,
        'deleted', coalesce((m.forwarded_from ->> 'deleted')::boolean, false),
        'sender_blocked', true
      )
      else m.forwarded_from
        || jsonb_build_object(
          'content', left(coalesce(m.forwarded_from ->> 'content', ''), 500),
          'sender_blocked', false
        )
    end
  from chat_channels c
  cross join lateral (
    select
      msg.id,
      msg.sender_id,
      msg.author_name,
      msg.content,
      msg.kind,
      msg.payload,
      msg.metadata,
      msg.created_at,
      msg.forwarded_from
    from chat_messages msg
    where msg.channel_id = c.id
      and msg.thread_root_id is null
      and msg.is_deleted = false
      and not exists (
        select 1
          from chat_member_blocks b
         where b.chapter_id = p_chapter_id
           and b.blocker_user_id = p_user_id
           and b.blocked_user_id = msg.sender_id
      )
    order by msg.created_at desc, msg.id desc
    limit 1
  ) m
  where c.chapter_id = p_chapter_id;
$$;

revoke execute on function public.get_channel_latest_messages(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.get_channel_latest_messages(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.get_channel_latest_messages(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_channel_latest_messages(uuid, uuid) to service_role;
  end if;
end
$$;

-- 4. Account deletion reaches the copies ---------------------------------------

-- `anonymize_user` is redefined in full from `20261113181721_member_nudges.sql`;
-- the only change is the `forwarded_from` rewrite, under the same rescan gate
-- as the cards' name rewrite. Same signature, so its grants are kept.
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

    -- Forwarded copies (#4864): a forward keeps the name its author had at
    -- forward time, a display-name snapshot like the cards' above, so it is
    -- rewritten the same way (spec/behavior/data-retention.md). The words
    -- stay, as the member's own messages do.
    update chat_messages
       set forwarded_from = jsonb_set(
             forwarded_from, '{author_name}', to_jsonb('Deleted User'::text)
           )
     where forwarded_from is not null
       and forwarded_from ->> 'sender_id' = p_user_id::text
       and forwarded_from ->> 'author_name' is distinct from 'Deleted User';

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
