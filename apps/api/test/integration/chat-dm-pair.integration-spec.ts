// One 1:1 DM per chapter and member pair (#2788), against a real PostgREST.
//
// The unit suites prove that `ChatService.getOrCreateDm` creates through
// `createDm`, and that `createDm` re-selects on a `23505`. What only a live
// database answers is that the `23505` actually happens: that
// `chat_channels_dm_pair_key` refuses a second DM for a pair whichever order
// its ids are stored in and whatever it is named, that the CHECK keeps a DM at
// two members, and that two overlapping `getOrCreateDm` calls end with one
// row. So this drives the real `ChatService.getOrCreateDm` over the real
// channel repository.
//
// Run: `npm run test:integration -w apps/api` (needs a local Supabase stack;
// skips cleanly without one). Not run by CI today (#1568), like the other
// integration suites.

import { randomUUID } from 'node:crypto';
import { ChatService } from '../../src/application/services/chat.service';
import { SupabaseChatChannelRepository } from '../../src/infrastructure/supabase/repositories/supabase-chat-channel.repository';
import type { FrappSupabaseClient } from '../../src/infrastructure/supabase/database.types';
import { createServiceRoleClient, describeIntegration } from './stack';

describeIntegration('One DM per pair against live PostgREST', () => {
  let supabase: FrappSupabaseClient;
  let repo: SupabaseChatChannelRepository;
  let chat: ChatService;

  const chapterId = randomUUID();
  const otherChapterId = randomUUID();
  // `member_ids` is a bare uuid[] with no foreign key, so the pair needs no
  // users rows.
  const [low, high] = [randomUUID(), randomUUID()].sort();

  const assertOk = (label: string, error: { message: string } | null) => {
    if (error) throw new Error(`seed ${label}: ${error.message}`);
  };

  const dmRows = async (chapter: string) => {
    const { data, error } = await supabase
      .from('chat_channels')
      .select('id')
      .eq('chapter_id', chapter)
      .eq('type', 'DM');
    if (error) throw error;
    return data ?? [];
  };

  beforeAll(async () => {
    supabase = createServiceRoleClient();
    repo = new SupabaseChatChannelRepository(supabase);
    // `getOrCreateDm` reads only the channel repository, and the read-receipt
    // repository when an opener reopens a DM, which no call here passes.
    const unused = {} as never;
    chat = new ChatService(
      repo,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
      unused,
    );

    assertOk(
      'chapters',
      (
        await supabase.from('chapters').insert(
          [chapterId, otherChapterId].map((id) => ({
            id,
            name: `dm-pair-${id.slice(0, 8)}`,
            university: 'Integration Test University',
          })) as never,
        )
      ).error,
    );
  });

  afterEach(async () => {
    await supabase
      .from('chat_channels')
      .delete()
      .in('chapter_id', [chapterId, otherChapterId]);
  });

  afterAll(async () => {
    if (!supabase) return;
    await supabase
      .from('chapters')
      .delete()
      .in('id', [chapterId, otherChapterId]);
  });

  it('gives overlapping getOrCreateDm calls for one pair the same channel', async () => {
    const calls = Array.from({ length: 6 }, (_, i) =>
      chat.getOrCreateDm({
        chapter_id: chapterId,
        member_ids: i % 2 === 0 ? [low, high] : [high, low],
      }),
    );

    const channels = await Promise.all(calls);

    expect(new Set(channels.map((c) => c.id)).size).toBe(1);
    expect(await dmRows(chapterId)).toHaveLength(1);
    expect(channels[0]).toMatchObject({
      type: 'DM',
      name: `dm-${low}-${high}`,
      member_ids: [low, high],
    });
  });

  it('createDm returns the existing DM when the pair is already there', async () => {
    // Inserted directly, reversed and under another name, so `createDm`'s own
    // insert is the one that conflicts: the path a lost race takes.
    const { data: existing, error } = await supabase
      .from('chat_channels')
      .insert({
        chapter_id: chapterId,
        name: 'renamed by an officer',
        type: 'DM',
        member_ids: [high, low],
      })
      .select()
      .single();
    assertOk('existing DM', error);

    const result = await repo.createDm(chapterId, [low, high]);

    expect(result.id).toBe(existing!.id);
    expect(await dmRows(chapterId)).toHaveLength(1);
  });

  it('opens the same DM when the ids arrive in uppercase', async () => {
    // `@IsUUID()` accepts uppercase and Postgres hands uuid[] back lowercase,
    // so the pair is compared in that form, or this call would 500 on the
    // index's 23505.
    const first = await chat.getOrCreateDm({
      chapter_id: chapterId,
      member_ids: [low, high],
    });

    const again = await chat.getOrCreateDm({
      chapter_id: chapterId,
      member_ids: [high.toUpperCase(), low.toUpperCase()],
    });

    expect(again.id).toBe(first.id);
    expect(await dmRows(chapterId)).toHaveLength(1);
  });

  it('refuses a second DM for the pair whatever its order or name', async () => {
    await repo.createDm(chapterId, [low, high]);

    const { error } = await supabase.from('chat_channels').insert({
      chapter_id: chapterId,
      name: 'another name',
      type: 'DM',
      member_ids: [high, low],
    });

    expect(error?.code).toBe('23505');
    expect(error?.message).toContain('chat_channels_dm_pair_key');
  });

  it('keeps pairs apart across chapters, and leaves group DMs alone', async () => {
    const here = await repo.createDm(chapterId, [low, high]);
    const there = await repo.createDm(otherChapterId, [low, high]);
    const { error: groupError } = await supabase.from('chat_channels').insert([
      {
        chapter_id: chapterId,
        name: 'group one',
        type: 'GROUP_DM',
        member_ids: [low, high],
      },
      {
        chapter_id: chapterId,
        name: 'group two',
        type: 'GROUP_DM',
        member_ids: [low, high],
      },
    ]);

    expect(there.id).not.toBe(here.id);
    expect(groupError).toBeNull();
  });

  it('refuses a DM without exactly two members', async () => {
    const third = randomUUID();
    const tooMany = await supabase.from('chat_channels').insert({
      chapter_id: chapterId,
      name: 'three',
      type: 'DM',
      member_ids: [low, high, third],
    });
    const none = await supabase.from('chat_channels').insert({
      chapter_id: chapterId,
      name: 'none',
      type: 'DM',
      member_ids: null,
    });

    expect(tooMany.error?.code).toBe('23514');
    expect(none.error?.code).toBe('23514');
    expect(await dmRows(chapterId)).toHaveLength(0);
  });
});
