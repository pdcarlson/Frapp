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
});
