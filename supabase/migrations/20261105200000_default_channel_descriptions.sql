-- Starting descriptions for the four channels every chapter is created with.
--
-- `chat_channels.description` has existed since the initial schema, and the
-- web header and Chat admin both use it, but `DEFAULT_CHANNELS`
-- (apps/api/src/domain/constants/permissions.ts) seeded the channels without
-- one. A new chapter's header therefore showed a bare name, and its empty
-- channels had nothing to say about what they are for. New chapters now get
-- these lines from `ChapterService.create`; this fills them in for chapters
-- created before that.
--
-- Only blank descriptions are written (null, or empty after trimming), so a
-- description an officer has already typed is never replaced. Only the four
-- seeded names are touched, and only for the channel types they are seeded
-- with, so a DM or a private channel that happens to share a name is left
-- alone. Running it twice changes nothing the second time.

update chat_channels
set description = case name
  when 'general' then 'The whole chapter. Plans, questions, whatever''s going on.'
  when 'announcements' then 'News from officers. Everyone gets notified.'
  when 'chapter-audit' then 'Officer changes to dues, roles and settings, posted automatically.'
  when 'alumni' then 'Alumni and actives keeping in touch.'
end
where coalesce(btrim(description), '') = ''
  and (
    (name in ('general', 'announcements', 'chapter-audit') and type = 'PUBLIC')
    or (name = 'alumni' and type = 'ROLE_GATED')
  );
