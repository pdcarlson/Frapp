import { SupabaseCorpusRepository } from './supabase-corpus.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_A,
  createTenantHarness,
  inA,
  inB,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';

/**
 * Tenant scope for the AI corpus tables (#720).
 *
 * Passages are never selected here: they are read through
 * `match_corpus_chunks` and written through `write_corpus_chunks`, whose SQL
 * (the chapter filter, the membership check, the revision guard) the PGlite
 * gate runs in `scripts/pglite/tiers/ai-corpus.mjs`. What this spec can see,
 * and pins, is that every call hands the function the chapter and the acting
 * member it was given, and that the plain reads and writes of
 * `corpus_sources` stay inside one chapter.
 */

const SOURCE = '0a000000-0000-4000-8000-000000000720';
const NOW = new Date('2026-11-12T10:00:00.000Z');

const source = (overrides: Record<string, unknown> = {}) => ({
  source_type: 'chapter_document',
  source_id: 'doc',
  revision: 1,
  indexed_revision: 0,
  status: 'pending',
  next_attempt_at: '2026-11-12T09:00:00.000Z',
  ...overrides,
});

describe('SupabaseCorpusRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseCorpusRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {
        corpus_sources: [
          inA({ id: 'source-a', ...source() }),
          inB({ id: 'source-b', ...source() }),
        ],
      },
      rpc: {
        claim_corpus_sources: { data: [] },
        write_corpus_chunks: { data: true },
        finish_corpus_source: { data: false },
        match_corpus_chunks: { data: [] },
        read_chat_corpus_window: {
          data: [
            {
              channel_id: 'channel-general',
              channel_name: 'general',
              day: '2026-11-09',
              message_id: 'msg-1',
              sender_id: USER_A,
              sender_name: 'Sam Ortiz',
              content: 'Who has the van keys?',
              created_at: '2026-11-09T22:00:00.000Z',
              thread_root_id: null,
              conversation_at: '2026-11-09T22:00:00.000Z',
            },
          ],
        },
        chat_corpus_window_channels: {
          data: [{ window_id: 'window-1', channel_id: 'channel-general' }],
        },
        requeue_chat_corpus_by_authors: { data: 2 },
        chat_corpus_authors: {
          data: [
            { user_id: 'sam', indexed: true },
            { user_id: 'quiet', indexed: false },
          ],
        },
      },
    });
    repo = new SupabaseCorpusRepository(harness.client);
  });

  it('findSource reads only inside the chapter', async () => {
    const found = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.findSource(CHAPTER_A, 'source-a'),
    );
    expect(found).toEqual(expect.objectContaining({ chapter_id: CHAPTER_A }));
    await expect(repo.findSource(CHAPTER_A, 'source-b')).resolves.toBeNull();
  });

  it('indexedSourceIds names only the chapter’s own records that are searchable now', async () => {
    const rows = [
      {
        id: 'indexed',
        ...source({
          source_type: 'meeting_minutes',
          source_id: 'meeting-1',
          indexed_revision: 2,
        }),
      },
      // Waiting for its first index: nothing to find in it yet.
      {
        id: 'waiting',
        ...source({ source_type: 'meeting_minutes', source_id: 'meeting-2' }),
      },
      // The same id as another kind of record is another record.
      {
        id: 'document',
        ...source({ source_id: 'meeting-3', indexed_revision: 1 }),
      },
    ];
    harness = createTenantHarness({
      tables: {
        corpus_sources: [
          ...rows.map((row) => inA({ ...row, id: `${row.id}-a` })),
          ...rows.map((row) => inB({ ...row, id: `${row.id}-b` })),
        ],
      },
    });
    repo = new SupabaseCorpusRepository(harness.client);
    // The other chapter holds the same three; one row comes back, not two.
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.indexedSourceIds(CHAPTER_A, 'meeting_minutes', [
          'meeting-1',
          'meeting-2',
          'meeting-3',
        ]),
      ),
    ).resolves.toEqual(['meeting-1']);
    // Nothing asked for is nothing read.
    await expect(
      repo.indexedSourceIds(CHAPTER_A, 'meeting_minutes', []),
    ).resolves.toEqual([]);
  });

  it('postponeChapter holds one chapter’s waiting sources, gives claimed ones their try back, and leaves indexed rows and the other chapter alone', async () => {
    harness = createTenantHarness({
      tables: {
        corpus_sources: [
          inA({ id: 'waiting-a', ...source() }),
          inA({
            id: 'claimed-a',
            ...source({
              attempts: 3,
              next_attempt_at: '2026-11-12T12:00:00.000Z',
            }),
          }),
          inA({
            id: 'indexed-a',
            ...source({ status: 'indexed', indexed_revision: 1, attempts: 0 }),
          }),
          inB({ id: 'waiting-b', ...source() }),
          inB({
            id: 'claimed-b',
            ...source({
              attempts: 3,
              next_attempt_at: '2026-11-12T12:00:00.000Z',
            }),
          }),
          inB({
            id: 'indexed-b',
            ...source({ status: 'indexed', indexed_revision: 1, attempts: 0 }),
          }),
        ],
      },
    });
    repo = new SupabaseCorpusRepository(harness.client);
    const until = new Date('2026-11-12T11:00:00.000Z');
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.postponeChapter(CHAPTER_A, until),
    );
    expect(
      Object.fromEntries(
        harness
          .rows('corpus_sources')
          .map((row) => [row.id, [row.next_attempt_at, row.attempts ?? 0]]),
      ),
    ).toEqual({
      'waiting-a': [until.toISOString(), 0],
      'claimed-a': [until.toISOString(), 0],
      'indexed-a': ['2026-11-12T09:00:00.000Z', 0],
      'waiting-b': ['2026-11-12T09:00:00.000Z', 0],
      'claimed-b': ['2026-11-12T12:00:00.000Z', 3],
      'indexed-b': ['2026-11-12T09:00:00.000Z', 0],
    });
  });

  it('deleteSource removes only the chapter’s row', async () => {
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.deleteSource(CHAPTER_A, 'source-a'),
    );
    await repo.deleteSource(CHAPTER_A, 'source-b');
    expect(harness.rows('corpus_sources').map((row) => row.id)).toEqual([
      'source-b',
    ]);
  });

  it('match hands the function the chapter, the acting member and the vector as text', async () => {
    await expect(
      repo.match({
        chapterId: CHAPTER_B,
        userId: USER_A,
        query: 'dues',
        embedding: [0.25, -0.5],
        embeddingModel: 'gemini-embedding-001',
        limit: 40,
      }),
    ).resolves.toEqual([]);
    expect(harness.rpcCalls).toEqual([
      {
        fn: 'match_corpus_chunks',
        args: {
          p_chapter_id: CHAPTER_B,
          p_user_id: USER_A,
          p_query: 'dues',
          p_embedding: '[0.25,-0.5]',
          p_embedding_model: 'gemini-embedding-001',
          p_limit: 40,
        },
      },
    ]);
  });

  it('writeChunks names the source and its revision; the function takes the chapter from the source', async () => {
    await expect(
      repo.writeChunks(SOURCE, 3, true, 'gemini-embedding-001', [
        {
          chunk_index: 0,
          heading: 'Dues',
          content: 'The fee is $225.',
          page_start: 1,
          page_end: 1,
          embedding: [1, 0],
        },
      ]),
    ).resolves.toBe(true);
    expect(harness.rpcCalls).toEqual([
      {
        fn: 'write_corpus_chunks',
        args: {
          p_source_id: SOURCE,
          p_revision: 3,
          p_first: true,
          p_embedding_model: 'gemini-embedding-001',
          p_chunks: [
            {
              chunk_index: 0,
              heading: 'Dues',
              content: 'The fee is $225.',
              page_start: 1,
              page_end: 1,
              embedding: '[1,0]',
            },
          ],
        },
      },
    ]);
  });

  it('finishSource reports a source that moved on as false', async () => {
    await expect(
      repo.finishSource({
        sourceId: SOURCE,
        revision: 3,
        fingerprint: 'gemini-embedding-001.1536.p1',
        title: 'Bylaws',
        sourceAt: NOW.toISOString(),
        decays: false,
        chunkCount: 4,
        skipReason: null,
      }),
    ).resolves.toBe(false);
    expect(harness.rpcCalls[0]).toEqual({
      fn: 'finish_corpus_source',
      args: {
        p_source_id: SOURCE,
        p_revision: 3,
        p_fingerprint: 'gemini-embedding-001.1536.p1',
        p_title: 'Bylaws',
        p_source_at: NOW.toISOString(),
        p_decays: false,
        p_chunk_count: 4,
        p_skip_reason: null,
        p_left_out_count: 0,
        p_left_out_author_ids: null,
      },
    });
  });

  it('claimSources sends the fingerprint, the time and the limit', async () => {
    await expect(
      repo.claimSources('gemini-embedding-001.1536.p1', NOW, 25),
    ).resolves.toEqual([]);
    expect(harness.rpcCalls).toEqual([
      {
        fn: 'claim_corpus_sources',
        args: {
          p_fingerprint: 'gemini-embedding-001.1536.p1',
          p_now: NOW.toISOString(),
          p_limit: 25,
        },
      },
    ]);
  });

  describe('chat (#4314)', () => {
    it('readChatWindow passes the chapter to the query and maps its rows', async () => {
      await expect(repo.readChatWindow(CHAPTER_A, 'window-1')).resolves.toEqual(
        {
          channelId: 'channel-general',
          channelName: 'general',
          day: '2026-11-09',
          messages: [
            {
              id: 'msg-1',
              senderId: USER_A,
              senderName: 'Sam Ortiz',
              content: 'Who has the van keys?',
              createdAt: '2026-11-09T22:00:00.000Z',
              threadRootId: null,
              conversationAt: '2026-11-09T22:00:00.000Z',
            },
          ],
        },
      );
      expect(harness.rpcCalls[0]).toEqual({
        fn: 'read_chat_corpus_window',
        args: { p_chapter_id: CHAPTER_A, p_window_id: 'window-1' },
      });
    });

    it('chatWindowChannels passes the chapter and maps each window to its channel', async () => {
      const channels = await repo.chatWindowChannels(CHAPTER_B, ['window-1']);
      expect([...channels]).toEqual([['window-1', 'channel-general']]);
      expect(harness.rpcCalls[0]).toEqual({
        fn: 'chat_corpus_window_channels',
        args: { p_chapter_id: CHAPTER_B, p_window_ids: ['window-1'] },
      });
      await expect(repo.chatWindowChannels(CHAPTER_B, [])).resolves.toEqual(
        new Map(),
      );
      expect(harness.rpcCalls).toHaveLength(1);
    });

    it('requeueChatByAuthors sends the members and the chapter, or no chapter for every chapter', async () => {
      await expect(repo.requeueChatByAuthors(['sam'], CHAPTER_A)).resolves.toBe(
        2,
      );
      await repo.requeueChatByAuthors(['sam'], null);
      await expect(repo.requeueChatByAuthors([], null)).resolves.toBe(0);
      expect(harness.rpcCalls).toEqual([
        {
          fn: 'requeue_chat_corpus_by_authors',
          args: { p_user_ids: ['sam'], p_chapter_id: CHAPTER_A },
        },
        {
          fn: 'requeue_chat_corpus_by_authors',
          args: { p_user_ids: ['sam'], p_chapter_id: null },
        },
      ]);
    });

    it('chatCorpusAuthors splits who is indexed from who was left out', async () => {
      await expect(repo.chatCorpusAuthors(CHAPTER_A)).resolves.toEqual({
        indexed: ['sam'],
        leftOut: ['quiet'],
      });
    });
  });
});
