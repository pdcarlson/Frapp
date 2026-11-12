-- VOICE PROTOTYPE ONLY (#3866). Lives on the `claude/voice-chat-prototype`
-- branch, which is not meant for `main`; a real voice build re-decides this.
--
-- Admits a private Realtime topic `voice:<channelId>` for the web prototype's
-- room: presence is who is in the voice chat, broadcast carries the WebRTC
-- signalling (offer, answer, network candidates) between browsers. The gate is
-- the same one the channel's chat topic uses, `can_read_chat_channel`: if you
-- can read the channel, you can see who is in its voice chat and join it.
--
-- Both policies are recreated whole, because a policy is one `case`
-- expression; every existing arm is copied verbatim from
-- 20260906203000_realtime_presence_private.sql and `else false` stays.
-- `substring(... from 7)`: the prefix `voice:` is 6 characters.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'realtime') then
    return;
  end if;
  if not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'realtime' and c.relname = 'messages') then
    return;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    return;
  end if;

  execute 'drop policy if exists "realtime_messages_scoped_select" on realtime.messages';
  execute $p$
    create policy "realtime_messages_scoped_select"
      on realtime.messages for select
      to authenticated
      using (
        case
          when realtime.topic() ~* '^notif:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_user_scope(substring(realtime.topic() from 7)::uuid)
          when realtime.topic() ~* '^events:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_chapter_scope(substring(realtime.topic() from 8)::uuid)
          when realtime.topic() ~* '^attendance:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_event_scope(substring(realtime.topic() from 12)::uuid)
          when realtime.topic() ~* '^presence:chapter:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_chapter_scope(substring(realtime.topic() from 18)::uuid)
          when realtime.topic() ~* '^chat:channel:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.can_read_chat_channel(substring(realtime.topic() from 14)::uuid)
          when realtime.topic() ~* '^voice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.can_read_chat_channel(substring(realtime.topic() from 7)::uuid)
          else false
        end
      )
  $p$;

  execute 'drop policy if exists "realtime_messages_scoped_insert" on realtime.messages';
  execute $p$
    create policy "realtime_messages_scoped_insert"
      on realtime.messages for insert
      to authenticated
      with check (
        case
          when realtime.messages.extension = 'presence'
           and realtime.topic() ~* '^presence:chapter:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.realtime_can_read_chapter_scope(substring(realtime.topic() from 18)::uuid)
          when realtime.messages.extension in ('presence', 'broadcast')
           and realtime.topic() ~* '^chat:channel:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.can_read_chat_channel(substring(realtime.topic() from 14)::uuid)
          when realtime.messages.extension in ('presence', 'broadcast')
           and realtime.topic() ~* '^voice:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
            public.can_read_chat_channel(substring(realtime.topic() from 7)::uuid)
          else false
        end
      )
  $p$;
end
$$;
