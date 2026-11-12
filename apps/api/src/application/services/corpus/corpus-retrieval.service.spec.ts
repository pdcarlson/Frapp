import type { CorpusCandidate } from '#domain/entities/corpus.entity';
import type { ICorpusRepository } from '#domain/repositories/corpus.repository.interface';
import type { AiGatewayService } from '../ai/ai-gateway.service';
import { CorpusRetrievalService } from './corpus-retrieval.service';
import type { CorpusSourceAdapter } from './corpus-source';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const ASKER = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-11-12T10:00:00.000Z');
const VECTOR = [0.1, 0.2];

const candidate = (overrides: Partial<CorpusCandidate>): CorpusCandidate => ({
  chunk_id: 'chunk',
  corpus_source_id: 'row',
  source_type: 'chapter_document',
  source_id: 'doc-1',
  title: 'Bylaws',
  heading: 'Article IV',
  content: 'Dues are $225.',
  page_start: 4,
  page_end: 4,
  source_at: '2026-01-01T00:00:00.000Z',
  decays: false,
  dense_rank: null,
  sparse_rank: null,
  distance: null,
  ...overrides,
});

function setup(candidates: CorpusCandidate[] = []) {
  const corpus = {
    match: jest.fn().mockResolvedValue(candidates),
  } as unknown as jest.Mocked<ICorpusRepository>;
  const documents: jest.Mocked<CorpusSourceAdapter> = {
    type: 'chapter_document',
    read: jest.fn(),
    readableBy: jest.fn((_c: string, _u: string, ids: readonly string[]) =>
      Promise.resolve(new Set(ids)),
    ),
  };
  const minutes: jest.Mocked<CorpusSourceAdapter> = {
    type: 'meeting_minutes',
    read: jest.fn(),
    readableBy: jest.fn().mockResolvedValue(new Set<string>()),
  };
  const embed = jest.fn().mockResolvedValue({
    status: 'ok',
    vectors: [VECTOR],
    model: 'gemini-embedding-001',
    dimensions: 1536,
  });
  const service = new CorpusRetrievalService(corpus, [documents, minutes], {
    embed,
  } as unknown as AiGatewayService);
  const retrieve = (query = 'What are dues?', limit?: number) =>
    service.retrieve(
      { chapterId: CHAPTER, actingUserId: ASKER, query, limit },
      NOW,
    );
  return { service, corpus, documents, minutes, embed, retrieve };
}

const ids = (
  result: Awaited<ReturnType<CorpusRetrievalService['retrieve']>>,
) =>
  result.status === 'ok' ? result.passages.map((passage) => passage.id) : [];

describe('CorpusRetrievalService', () => {
  it('embeds the question as the asker’s own, and reads one chapter as that member', async () => {
    const { retrieve, embed, corpus } = setup();
    await retrieve('  What are dues?  ');
    expect(embed).toHaveBeenCalledWith(
      'ask.embed-query',
      expect.objectContaining({
        texts: ['What are dues?'],
        promptVersion: 'corpus.query@v1',
        purpose: 'query',
      }),
      { chapterId: CHAPTER, actingUserId: ASKER },
    );
    expect(corpus.match).toHaveBeenCalledWith({
      chapterId: CHAPTER,
      userId: ASKER,
      query: 'What are dues?',
      embedding: VECTOR,
      embeddingModel: 'gemini-embedding-001',
      limit: 40,
    });
  });

  it.each([
    { reason: 'disabled' },
    { reason: 'consent', detail: 'member_declined' },
    { reason: 'spend_cap', detail: 'member_cap' },
  ] as const)(
    'reads nothing and hands back the refusal when the gateway says %p',
    async (refusal) => {
      const { retrieve, embed, corpus } = setup();
      embed.mockResolvedValue({ status: 'unavailable', ...refusal });
      await expect(retrieve()).resolves.toEqual({
        status: 'unavailable',
        ...refusal,
      });
      expect(corpus.match).not.toHaveBeenCalled();
    },
  );

  it('asks nothing of anyone for an empty question', async () => {
    const { retrieve, embed } = setup();
    await expect(retrieve('   ')).resolves.toEqual({
      status: 'ok',
      passages: [],
    });
    expect(embed).not.toHaveBeenCalled();
  });

  it('drops every passage whose source the member could not open, by the source’s own rule', async () => {
    const { retrieve, minutes, documents } = setup([
      candidate({ chunk_id: 'doc', dense_rank: 3 }),
      candidate({
        chunk_id: 'exec-1',
        source_type: 'meeting_minutes',
        source_id: 'exec',
        dense_rank: 1,
        sparse_rank: 1,
      }),
      candidate({
        chunk_id: 'exec-2',
        source_type: 'meeting_minutes',
        source_id: 'exec',
        dense_rank: 2,
      }),
      candidate({
        chunk_id: 'chapter-1',
        source_type: 'meeting_minutes',
        source_id: 'chapter',
        sparse_rank: 2,
      }),
    ]);
    minutes.readableBy.mockResolvedValue(new Set(['chapter']));
    const result = await retrieve();
    // The Exec minutes ranked first in both halves and are still not there.
    expect(ids(result).sort()).toEqual(['chapter-1', 'doc']);
    expect(minutes.readableBy).toHaveBeenCalledWith(CHAPTER, ASKER, [
      'exec',
      'chapter',
    ]);
    expect(documents.readableBy).toHaveBeenCalledWith(CHAPTER, ASKER, [
      'doc-1',
    ]);
  });

  it('drops a source type this build has no adapter for', async () => {
    const { retrieve } = setup([
      candidate({
        chunk_id: 'chat',
        source_type: 'chat_message',
        dense_rank: 1,
      }),
      candidate({ chunk_id: 'doc', dense_rank: 2 }),
    ]);
    expect(ids(await retrieve())).toEqual(['doc']);
  });

  it('ranks by reciprocal rank fusion: found by both halves beats first in one', async () => {
    const { retrieve } = setup([
      candidate({ chunk_id: 'dense-first', dense_rank: 1 }),
      candidate({ chunk_id: 'both', dense_rank: 2, sparse_rank: 2 }),
      candidate({ chunk_id: 'words-first', sparse_rank: 1 }),
      candidate({ chunk_id: 'dense-third', dense_rank: 3 }),
    ]);
    const result = await retrieve();
    expect(ids(result)).toEqual([
      'both',
      'dense-first',
      'words-first',
      'dense-third',
    ]);
    if (result.status !== 'ok') throw new Error('expected passages');
    expect(result.passages[0]).toEqual({
      id: 'both',
      sourceType: 'chapter_document',
      sourceId: 'doc-1',
      title: 'Bylaws',
      heading: 'Article IV',
      text: 'Dues are $225.',
      pageStart: 4,
      pageEnd: 4,
      sourceAt: '2026-01-01T00:00:00.000Z',
      score: 2 / 62,
      matchedBy: ['semantic', 'words'],
    });
    expect(result.passages[2].matchedBy).toEqual(['words']);
  });

  it('puts newer minutes above older ones at the same rank, and never ages a standing document', async () => {
    const { retrieve, minutes } = setup([
      candidate({
        chunk_id: 'old-minutes',
        source_type: 'meeting_minutes',
        source_id: 'old',
        decays: true,
        source_at: '2025-11-12T10:00:00.000Z',
        dense_rank: 1,
      }),
      candidate({
        chunk_id: 'new-minutes',
        source_type: 'meeting_minutes',
        source_id: 'new',
        decays: true,
        source_at: '2026-11-10T10:00:00.000Z',
        dense_rank: 2,
      }),
      candidate({
        chunk_id: 'old-bylaws',
        source_at: '2019-01-01T00:00:00.000Z',
        sparse_rank: 1,
      }),
    ]);
    minutes.readableBy.mockResolvedValue(new Set(['old', 'new']));
    expect(ids(await retrieve())).toEqual([
      'old-bylaws',
      'new-minutes',
      'old-minutes',
    ]);
  });

  it('returns at most the passages asked for, never more than twenty', async () => {
    const many = Array.from({ length: 30 }, (_, n) =>
      candidate({
        chunk_id: `c${String(n).padStart(2, '0')}`,
        dense_rank: n + 1,
      }),
    );
    const { retrieve } = setup(many);
    expect(ids(await retrieve('dues'))).toHaveLength(8);
    expect(ids(await retrieve('dues', 3))).toEqual(['c00', 'c01', 'c02']);
    expect(ids(await retrieve('dues', 500))).toHaveLength(20);
  });
});
