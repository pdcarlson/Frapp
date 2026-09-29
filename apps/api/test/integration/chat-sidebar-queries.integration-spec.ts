// Chat sidebar queries against a real PostgREST (#2877).
//
// `supabase-chat-sidebar.repository.spec.ts` proves the repository filters on
// chapter and member. Its harness applies an upsert by merging the payload
// into the stored row, so it cannot prove the one property `updateFilters`
// rests on: that PostgREST's merge on conflict sets only the columns in the
// payload, leaving the other filter and `collapsed_sections` as stored. Nor
// can it run `set_chat_sidebar_section_collapsed`, or show that deleting a
// channel takes its pins with it. Those need the real server.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568).

import { randomUUID } from 'node:crypto';
import { SupabaseChatSidebarRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-sidebar.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('Chat sidebar queries against live PostgREST', () => {
  let supabase: FrappSupabaseClient;
  let repo: SupabaseChatSidebarRepository;

  const chapterId = randomUUID();
  const userId = randomUUID();
  const channelId = randomUUID();
  const doomedChannelId = randomUUID();

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert({
          id: chapterId,
          name: `sidebar-${chapterId.slice(0, 8)}`,
          university: 'Integration Test University',
        } as never)
      ).error,
    );
    assertOk(
      'users',
      (
        await supabase.from('users').insert({
          id: userId,
          supabase_auth_id: randomUUID(),
          email: `sidebar-${userId.slice(0, 8)}@example.com`,
          display_name: 'Sidebar Member',
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
            id: doomedChannelId,
            chapter_id: chapterId,
            name: 'doomed',
            type: 'PUBLIC',
          },
        ] as never)
      ).error,
    );
    repo = new SupabaseChatSidebarRepository(supabase);
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase.from('chat_sidebar_pins').delete().eq('user_id', userId);
    await supabase
      .from('chat_sidebar_preferences')
      .delete()
      .eq('user_id', userId);
    await supabase.from('chat_channels').delete().eq('chapter_id', chapterId);
    await supabase.from('users').delete().eq('id', userId);
    await supabase.from('chapters').delete().eq('id', chapterId);
  });

  it('has no row, and so every default, before the first change', async () => {
    await expect(repo.findPreferences(chapterId, userId)).resolves.toBeNull();
  });

  it('writes one filter without touching the other or the folds', async () => {
    await repo.setSectionCollapsed(chapterId, userId, 'direct', true);
    await repo.updateFilters(chapterId, userId, { hide_muted: true });
    await repo.updateFilters(chapterId, userId, { unread_only: true });
    await repo.updateFilters(chapterId, userId, { hide_muted: false });

    const row = await repo.findPreferences(chapterId, userId);
    expect(row).toMatchObject({
      unread_only: true,
      hide_muted: false,
      collapsed_sections: ['direct'],
    });
  });

  it('folds and unfolds through the RPC, idempotently', async () => {
    await repo.setSectionCollapsed(chapterId, userId, 'pinned', true);
    const twice = await repo.setSectionCollapsed(
      chapterId,
      userId,
      'pinned',
      true,
    );
    expect(twice.collapsed_sections).toEqual(['direct', 'pinned']);

    const unfolded = await repo.setSectionCollapsed(
      chapterId,
      userId,
      'direct',
      false,
    );
    expect(unfolded.collapsed_sections).toEqual(['pinned']);
    // The filters written above survive a fold.
    expect(unfolded.unread_only).toBe(true);
  });

  it('pins idempotently, and a deleted channel takes its pin with it', async () => {
    await repo.pin(chapterId, userId, channelId);
    await repo.pin(chapterId, userId, channelId);
    await repo.pin(chapterId, userId, doomedChannelId);
    expect((await repo.findPinnedChannelIds(chapterId, userId)).sort()).toEqual(
      [channelId, doomedChannelId].sort(),
    );

    await supabase.from('chat_channels').delete().eq('id', doomedChannelId);
    expect(await repo.findPinnedChannelIds(chapterId, userId)).toEqual([
      channelId,
    ]);

    await repo.unpin(chapterId, userId, channelId);
    await repo.unpin(chapterId, userId, channelId);
    expect(await repo.findPinnedChannelIds(chapterId, userId)).toEqual([]);
  });
});
