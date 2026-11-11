// The `chat_messages → chat_channels` embed against a real PostgREST (#4087).
//
// #4042 added `chat_channels.background_message_id → chat_messages(id)`, which
// gave PostgREST a second relationship between the two tables. Every select
// that embedded `chat_channels!inner(...)` from `chat_messages` by table name
// then failed with PGRST201 ("more than one relationship was found"), and the
// repository unit specs, which run against a fake client that ignores the
// select projection, all stayed green. The fix names the FK
// (`chat_channels!chat_messages_channel_id_fkey!inner(chapter_id)`); this file
// runs each of the four reads that use it, through the real repository
// methods, so a select PostgREST refuses fails here.
//
// It also points one channel's `background_message_id` at the *other*
// chapter's poll. Were an embed to resolve through the background FK instead of
// `channel_id`, that poll would surface under the wrong chapter, and the
// chapter-scope assertions below would see it.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI (#1568); the CI-side guard is
// `chat-message-channel-embed.spec.ts` beside the repositories.

import { randomUUID } from 'node:crypto';
import { SupabaseChatMessageRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-message.repository';
import { SupabaseDiscordImportRepository } from '../../src/infrastructure/supabase/repositories/supabase-discord-import.repository';
import { SupabaseScheduledJobsRepository } from '../../src/infrastructure/supabase/repositories/supabase-scheduled-jobs.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration(
  'chat_messages → chat_channels embed against live PostgREST',
  () => {
    let supabase: FrappSupabaseClient;

    const chapterId = randomUUID();
    const otherChapterId = randomUUID();
    const userId = randomUUID();
    const channelId = randomUUID();
    const otherChannelId = randomUUID();
    const pollId = randomUUID();
    const otherPollId = randomUUID();
    const importedId = randomUUID();
    const otherImportedId = randomUUID();
    const importId = randomUUID();
    const allMessageIds = [pollId, otherPollId, importedId, otherImportedId];

    const expiredAt = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const assertOk = (label: string, error: { message: string } | null) => {
      if (error) throw new Error(`seed ${label}: ${error.message}`);
    };

    beforeAll(async () => {
      supabase = createServiceRoleClient();
      assertOk(
        'chapters',
        (
          await supabase.from('chapters').insert([
            {
              id: chapterId,
              name: `embed-${chapterId.slice(0, 8)}`,
              university: 'Integration Test University',
            },
            {
              id: otherChapterId,
              name: `embed-other-${otherChapterId.slice(0, 8)}`,
              university: 'Integration Test University',
            },
          ] as never)
        ).error,
      );
      assertOk(
        'users',
        (
          await supabase.from('users').insert({
            id: userId,
            supabase_auth_id: randomUUID(),
            email: `embed-${userId}@example.test`,
            display_name: 'Embed Probe',
          } as never)
        ).error,
      );
      assertOk(
        'chat_channels',
        (
          await supabase.from('chat_channels').insert([
            {
              id: channelId,
              chapter_id: chapterId,
              name: 'general',
              type: 'PUBLIC',
            },
            {
              id: otherChannelId,
              chapter_id: otherChapterId,
              name: 'general',
              type: 'PUBLIC',
            },
          ] as never)
        ).error,
      );
      const poll = (id: string, channel: string) => ({
        id,
        channel_id: channel,
        sender_id: userId,
        content: 'Formal date?',
        type: 'POLL',
        kind: 'poll',
        is_deleted: false,
        metadata: { question: 'Formal date?', expires_at: expiredAt },
      });
      const imported = (id: string, channel: string) => ({
        id,
        channel_id: channel,
        sender_id: userId,
        content: 'from discord',
        type: 'TEXT',
        kind: 'imported',
        is_deleted: false,
        metadata: { discord_import_id: importId },
      });
      assertOk(
        'chat_messages',
        (
          await supabase
            .from('chat_messages')
            .insert([
              poll(pollId, channelId),
              poll(otherPollId, otherChannelId),
              imported(importedId, channelId),
              imported(otherImportedId, otherChannelId),
            ] as never)
        ).error,
      );
      // The misdirection: this chapter's channel claims the other chapter's poll
      // as its background, so the background FK links that poll to this chapter.
      assertOk(
        'chat_channels background',
        (
          await supabase
            .from('chat_channels')
            .update({ background_message_id: otherPollId } as never)
            .eq('id', channelId)
        ).error,
      );
    });

    afterAll(async () => {
      if (!supabase) return;
      await supabase
        .from('chat_channels')
        .update({ background_message_id: null } as never)
        .eq('id', channelId);
      await supabase.from('chat_messages').delete().in('id', allMessageIds);
      await supabase
        .from('chat_channels')
        .delete()
        .in('id', [channelId, otherChannelId]);
      await supabase.from('users').delete().eq('id', userId);
      await supabase
        .from('chapters')
        .delete()
        .in('id', [chapterId, otherChapterId]);
    });

    it('findPollsByChapter returns only the chapter’s own polls', async () => {
      const repo = new SupabaseChatMessageRepository(supabase);
      const rows = await repo.findPollsByChapter(chapterId);
      expect(rows.map((row) => row.id)).toEqual([pollId]);
    });

    it('findPollCardsByChapter returns only the chapter’s own polls, without the join', async () => {
      const repo = new SupabaseChatMessageRepository(supabase);
      const rows = await repo.findPollCardsByChapter(chapterId, { limit: 10 });
      expect(rows.map((row) => row.id)).toEqual([pollId]);
      expect(rows[0]).not.toHaveProperty('chat_channels');
    });

    it('findExpiredPollsPendingNotice reads each poll’s chapter through channel_id', async () => {
      const repo = new SupabaseScheduledJobsRepository(supabase);
      const rows = await repo.findExpiredPollsPendingNotice(
        new Date(Date.now() - 2 * 60 * 60 * 1000),
        new Date(),
      );
      const ours = rows
        .filter((row) => row.id === pollId || row.id === otherPollId)
        .map((row) => ({ id: row.id, chapter_id: row.chapter_id }))
        .sort((a, b) => a.id.localeCompare(b.id));
      expect(ours).toEqual(
        [
          { id: pollId, chapter_id: chapterId },
          { id: otherPollId, chapter_id: otherChapterId },
        ].sort((a, b) => a.id.localeCompare(b.id)),
      );
    });

    it('deleteImportedMessages purges only the chapter’s own imported rows', async () => {
      const repo = new SupabaseDiscordImportRepository(supabase);
      await expect(
        repo.deleteImportedMessages(importId, chapterId, 10),
      ).resolves.toBe(1);

      const { data, error } = await supabase
        .from('chat_messages')
        .select('id')
        .in('id', [importedId, otherImportedId]);
      expect(error).toBeNull();
      expect((data ?? []).map((row) => row.id)).toEqual([otherImportedId]);
    });
  },
);
