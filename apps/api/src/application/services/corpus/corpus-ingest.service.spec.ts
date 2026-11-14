import type { IAiConsentCheck } from '#domain/adapters/ai-consent-check.interface';
import type { CorpusSource } from '#domain/entities/corpus.entity';
import type { ICorpusRepository } from '#domain/repositories/corpus.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { IRoleRepository } from '#domain/repositories/role.repository.interface';
import { CORPUS_CHUNK_TARGET_CHARS } from '#domain/utils/corpus-chunker';
import type { AiGatewayService } from '../ai/ai-gateway.service';
import { AiRunFailure, AiRunRegistry } from '../ai-run-registry';
import type { AiRunService } from '../ai-run.service';
import {
  CORPUS_MAX_CHUNKS_PER_SOURCE,
  CorpusIngestService,
} from './corpus-ingest.service';
import type { CorpusSourceAdapter, CorpusSourceRead } from './corpus-source';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OTHER_CHAPTER = '22222222-2222-4222-8222-222222222222';
const UPLOADER = '44444444-4444-4444-8444-444444444444';
const PRESIDENT = '55555555-5555-4555-8555-555555555555';
const GONE_MEMBER = '66666666-6666-4666-8666-666666666666';
const SOURCE = '0a000000-0000-4000-8000-000000000720';
const RUN = '0b000000-0000-4000-8000-000000000720';
const FINGERPRINT = 'gemini-embedding-001.1536.p1';
const NOW = new Date('2026-11-12T10:00:00.000Z');

const source = (overrides: Partial<CorpusSource> = {}): CorpusSource => ({
  id: SOURCE,
  chapter_id: CHAPTER,
  source_type: 'chapter_document',
  source_id: 'doc-1',
  revision: 2,
  indexed_revision: 0,
  status: 'pending',
  skip_reason: null,
  changed_by: UPLOADER,
  attempts: 1,
  next_attempt_at: NOW.toISOString(),
  index_fingerprint: null,
  title: null,
  source_at: null,
  decays: false,
  chunk_count: 0,
  left_out_count: 0,
  left_out_author_ids: null,
  indexed_at: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  ...overrides,
});

const okRead = (text: string): CorpusSourceRead => ({
  status: 'ok',
  content: {
    title: 'Bylaws',
    sourceAt: '2026-01-01T00:00:00.000Z',
    decays: false,
    sections: [{ heading: 'Article IV', page: 1, text }],
  },
});

function setup(read: CorpusSourceRead = okRead('Dues are $225.')) {
  const corpus: jest.Mocked<ICorpusRepository> = {
    claimSources: jest.fn().mockResolvedValue([]),
    findSource: jest.fn().mockResolvedValue(source()),
    indexedSourceIds: jest.fn().mockResolvedValue([]),
    postponeChapter: jest.fn().mockResolvedValue(undefined),
    deleteSource: jest.fn().mockResolvedValue(undefined),
    writeChunks: jest.fn().mockResolvedValue(true),
    finishSource: jest.fn().mockResolvedValue(true),
    match: jest.fn(),
    readSourceChunks: jest.fn(),
    readChatWindow: jest.fn(),
    chatWindowChannels: jest.fn(),
    requeueChatByAuthors: jest.fn(),
    chatCorpusChapters: jest.fn(),
    chatCorpusAuthors: jest.fn(),
  };
  const adapter: jest.Mocked<CorpusSourceAdapter> = {
    type: 'chapter_document',
    read: jest.fn().mockResolvedValue(read),
    readableBy: jest.fn(),
  };
  const members = {
    findByChapter: jest.fn().mockResolvedValue([
      { user_id: UPLOADER, role_ids: ['role-member'] },
      { user_id: PRESIDENT, role_ids: ['role-president'] },
    ]),
  } as unknown as jest.Mocked<IMemberRepository>;
  const roles = {
    findByChapterAndSystemKey: jest
      .fn()
      .mockResolvedValue({ id: 'role-president' }),
  } as unknown as jest.Mocked<IRoleRepository>;
  const consent: jest.Mocked<IAiConsentCheck> = {
    check: jest.fn().mockResolvedValue({ allowed: true }),
  };
  const embed = jest.fn((_task: string, input: { texts: string[] }) =>
    Promise.resolve({
      status: 'ok' as const,
      vectors: input.texts.map(() => new Array<number>(1536).fill(0.5)),
      model: 'gemini-embedding-001',
      dimensions: 1536,
    }),
  );
  const gateway = { embed } as unknown as AiGatewayService;
  const enqueue = jest.fn().mockResolvedValue({ status: 'queued' });
  const runs = { enqueue } as unknown as AiRunService;
  const registry = new AiRunRegistry();
  const service = new CorpusIngestService(
    corpus,
    [adapter],
    members,
    roles,
    consent,
    gateway,
    runs,
    registry,
  );
  const run = (input: Record<string, unknown> = {}) =>
    service.run({
      run: {
        id: RUN,
        chapter_id: CHAPTER,
        kind: 'corpus_index',
        requested_by: null,
        acting_user_id: UPLOADER,
        attempt_count: 1,
        max_attempts: 3,
      },
      input: { corpus_source_id: SOURCE, revision: 2, ...input },
      signal: new AbortController().signal,
    });
  return {
    service,
    corpus,
    adapter,
    consent,
    embed,
    enqueue,
    registry,
    members,
    run,
  };
}

describe('CorpusIngestService', () => {
  const saved = process.env.AI_ENABLED;
  beforeEach(() => {
    process.env.AI_ENABLED = 'true';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = saved;
  });

  it('registers one run kind that acts for a member', () => {
    const { service, registry } = setup();
    service.onModuleInit();
    expect(registry.get('corpus_index')).toBe(service);
    expect(service.actsForMember).toBe(true);
    expect(service.fingerprint()).toBe(FINGERPRINT);
  });

  describe('sweep', () => {
    it('does nothing at all while AI is off on the server', async () => {
      delete process.env.AI_ENABLED;
      const { service, corpus, enqueue } = setup();
      await expect(service.sweep(NOW)).resolves.toBe(0);
      expect(corpus.claimSources).not.toHaveBeenCalled();
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('queues one run per claimed source, acting for whoever changed it', async () => {
      const { service, corpus, enqueue, consent } = setup();
      corpus.claimSources.mockResolvedValue([source()]);
      await expect(service.sweep(NOW)).resolves.toBe(1);
      expect(corpus.claimSources).toHaveBeenCalledWith(FINGERPRINT, NOW, 25);
      expect(consent.check).toHaveBeenCalledWith(
        expect.objectContaining({
          chapterId: CHAPTER,
          actingUserId: UPLOADER,
          task: 'corpus.embed',
          family: 'corpus',
        }),
      );
      expect(enqueue).toHaveBeenCalledWith({
        chapterId: CHAPTER,
        kind: 'corpus_index',
        dedupeKey: `source:${SOURCE}:2:${FINGERPRINT}:0`,
        requestedBy: null,
        actingUserId: UPLOADER,
        input: { corpus_source_id: SOURCE, revision: 2 },
      });
    });

    it('acts for the president when the uploader has left the chapter or is unknown', async () => {
      const { service, corpus, enqueue } = setup();
      corpus.claimSources.mockResolvedValue([
        source({ changed_by: GONE_MEMBER }),
        source({ id: 'other', changed_by: null }),
      ]);
      await service.sweep(NOW);
      expect(
        enqueue.mock.calls.map(
          ([request]: [{ actingUserId: string }]) => request.actingUserId,
        ),
      ).toEqual([PRESIDENT, PRESIDENT]);
    });

    it('queues nothing for a source nobody can act for', async () => {
      const { service, corpus, enqueue, members } = setup();
      members.findByChapter.mockResolvedValue([]);
      corpus.claimSources.mockResolvedValue([source()]);
      await expect(service.sweep(NOW)).resolves.toBe(0);
      expect(enqueue).not.toHaveBeenCalled();
    });

    it('queues nothing for a chapter whose switch is off, holds its sources ten minutes, and still serves the next chapter', async () => {
      const { service, corpus, enqueue, consent } = setup();
      corpus.claimSources.mockResolvedValue([
        source(),
        source({ id: 'second' }),
        source({ id: 'elsewhere', chapter_id: OTHER_CHAPTER }),
      ]);
      consent.check.mockImplementation((call) =>
        Promise.resolve(
          call.chapterId === CHAPTER
            ? { allowed: false, reason: 'chapter_off' }
            : { allowed: true },
        ),
      );
      await expect(service.sweep(NOW)).resolves.toBe(1);
      expect(corpus.postponeChapter).toHaveBeenCalledTimes(1);
      expect(corpus.postponeChapter).toHaveBeenCalledWith(
        CHAPTER,
        new Date('2026-11-12T10:10:00.000Z'),
      );
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ chapterId: OTHER_CHAPTER }),
      );
    });
  });

  describe('run', () => {
    it('embeds each passage with its title and heading, as the chapter’s record, and marks the source indexed', async () => {
      const { run, corpus, embed } = setup();
      await expect(run()).resolves.toEqual({
        corpus_source_id: SOURCE,
        chunk_count: 1,
      });
      expect(embed).toHaveBeenCalledWith(
        'corpus.embed',
        expect.objectContaining({
          texts: ['Bylaws › Article IV\nDues are $225.'],
          promptVersion: 'corpus.index@v1',
          purpose: 'document',
        }),
        {
          chapterId: CHAPTER,
          actingUserId: UPLOADER,
          runId: RUN,
          // The chapter's upkeep: never charged to a member's day (#4504).
          chapterUpkeep: true,
        },
      );
      expect(corpus.writeChunks).toHaveBeenCalledWith(
        SOURCE,
        2,
        true,
        'gemini-embedding-001',
        [
          expect.objectContaining({
            chunk_index: 0,
            heading: 'Article IV',
            content: 'Dues are $225.',
            page_start: 1,
            page_end: 1,
          }),
        ],
      );
      expect(corpus.finishSource).toHaveBeenCalledWith({
        sourceId: SOURCE,
        revision: 2,
        fingerprint: FINGERPRINT,
        title: 'Bylaws',
        sourceAt: '2026-01-01T00:00:00.000Z',
        decays: false,
        chunkCount: 1,
        skipReason: null,
        leftOutCount: 0,
        leftOutAuthorIds: [],
      });
    });

    it('writes a long source in batches, clearing the old passages only with the first', async () => {
      const paragraphs = Array.from({ length: 40 }, (_, n) =>
        `${n} `.padEnd(CORPUS_CHUNK_TARGET_CHARS, 'word '),
      ).join('\n\n');
      const { run, corpus, embed } = setup(okRead(paragraphs));
      await expect(run()).resolves.toEqual({
        corpus_source_id: SOURCE,
        chunk_count: 40,
      });
      expect(embed).toHaveBeenCalledTimes(3);
      expect(corpus.writeChunks.mock.calls.map((call) => call[2])).toEqual([
        true,
        false,
        false,
      ]);
      expect(
        corpus.writeChunks.mock.calls.flatMap((call) =>
          call[4].map((chunk) => chunk.chunk_index),
        ),
      ).toEqual(Array.from({ length: 40 }, (_, n) => n));
    });

    it('does nothing for a source that changed again or was deleted since it was queued', async () => {
      const { run, corpus, embed, adapter } = setup();
      corpus.findSource.mockResolvedValueOnce(source({ revision: 3 }));
      await expect(run()).resolves.toEqual({
        corpus_source_id: SOURCE,
        chunk_count: 0,
      });
      corpus.findSource.mockResolvedValueOnce(null);
      await run();
      expect(adapter.read).not.toHaveBeenCalled();
      expect(embed).not.toHaveBeenCalled();
      expect(corpus.finishSource).not.toHaveBeenCalled();
    });

    it('stops without finishing when the source changes mid-run', async () => {
      const { run, corpus } = setup();
      corpus.writeChunks.mockResolvedValue(false);
      await expect(run()).resolves.toEqual({
        corpus_source_id: SOURCE,
        chunk_count: 0,
      });
      expect(corpus.finishSource).not.toHaveBeenCalled();
    });

    it('removes a source whose document or minutes are gone', async () => {
      const { run, corpus, embed } = setup({ status: 'gone' });
      await run();
      expect(corpus.deleteSource).toHaveBeenCalledWith(CHAPTER, SOURCE);
      expect(embed).not.toHaveBeenCalled();
    });

    it.each([
      [
        'a format it cannot read',
        { status: 'skipped', reason: 'unsupported_type' },
        'unsupported_type',
      ],
      ['a file with no words', okRead('   '), 'no_text'],
      [
        'more passages than one source may add',
        okRead(
          Array.from({ length: CORPUS_MAX_CHUNKS_PER_SOURCE + 1 }, () =>
            'w'.repeat(CORPUS_CHUNK_TARGET_CHARS),
          ).join('\n\n'),
        ),
        'too_large',
      ],
    ] as const)(
      'records %s as skipped and sends nothing to a model',
      async (_name, read, reason) => {
        const { run, corpus, embed } = setup(read);
        await run();
        expect(embed).not.toHaveBeenCalled();
        expect(corpus.finishSource).toHaveBeenCalledWith(
          expect.objectContaining({ skipReason: reason, chunkCount: 0 }),
        );
      },
    );

    it.each([
      [
        { reason: 'spend_cap', detail: 'chapter_cap' },
        'spend_limit',
        6 * 3600_000,
      ],
      [{ reason: 'consent', detail: 'chapter_off' }, 'ai_unavailable', 600_000],
      [
        { reason: 'consent', detail: 'member_declined' },
        'not_permitted',
        600_000,
      ],
    ] as const)(
      'when the gateway refuses with %p, fails as %s, without a retry, and holds the chapter',
      async (refusal, reason, waitMs) => {
        const { run, corpus, embed } = setup();
        embed.mockResolvedValue({ status: 'unavailable', ...refusal } as never);
        const before = Date.now();
        const failure = await run().catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(AiRunFailure);
        expect(failure).toMatchObject({ reason, retryable: false });
        const [chapter, until] = corpus.postponeChapter.mock.calls[0];
        expect(chapter).toBe(CHAPTER);
        expect(until.getTime() - before).toBeGreaterThanOrEqual(waitMs);
        expect(corpus.writeChunks).not.toHaveBeenCalled();
      },
    );

    it('pauses the whole sweep when the server has no provider, instead of failing a run a minute', async () => {
      const { service, run, corpus, embed } = setup();
      embed.mockResolvedValue({
        status: 'unavailable',
        reason: 'not_configured',
      } as never);
      await expect(run()).rejects.toMatchObject({ reason: 'ai_unavailable' });
      // The chapter's sources get the try back that their claim counted.
      expect(corpus.postponeChapter).toHaveBeenCalledWith(
        CHAPTER,
        expect.any(Date),
      );
      corpus.claimSources.mockResolvedValue([source()]);
      await expect(service.sweep(new Date())).resolves.toBe(0);
      expect(corpus.claimSources).not.toHaveBeenCalled();
      // And comes back by itself.
      await expect(
        service.sweep(new Date(Date.now() + 16 * 60_000)),
      ).resolves.toBe(1);
    });

    it('asks for another try when the provider answers with the wrong shape, and writes none of it', async () => {
      const { run, corpus, embed } = setup();
      embed.mockResolvedValue({
        status: 'ok',
        vectors: [[1, 2, 3]],
        model: 'gemini-embedding-001',
        dimensions: 1536,
      } as never);
      await expect(run()).rejects.toMatchObject({ retryable: true });
      expect(corpus.writeChunks).not.toHaveBeenCalled();
    });

    it('fails a run whose input names no source, and one for a type it has no adapter for', async () => {
      const { run, corpus } = setup();
      await expect(run({ corpus_source_id: 7 })).rejects.toBeInstanceOf(
        AiRunFailure,
      );
      corpus.findSource.mockResolvedValue(
        source({ source_type: 'chat_message' }),
      );
      await expect(run()).rejects.toMatchObject({ retryable: false });
    });

    it('writes the passages a chat window cut itself, with their authors and first message, and records what it left out (#4314)', async () => {
      const passage = {
        heading: 'November 9, 2026',
        content: 'Sam: who has the van keys?\nLee: I do.',
        authorIds: ['sam', 'lee'],
        anchorId: 'msg-1',
        anchorAt: '2026-11-09T22:00:00.000Z',
        messageCount: 2,
      };
      const { run, corpus, embed } = setup({
        status: 'ok',
        content: {
          title: '#general',
          sourceAt: '2026-11-09T22:00:00.000Z',
          decays: true,
          sections: [],
          passages: [passage],
          leftOut: { count: 3, authorIds: ['quiet-member'] },
        },
      });
      await run();
      expect(embed).toHaveBeenCalledWith(
        'corpus.embed',
        expect.objectContaining({
          texts: [
            '#general › November 9, 2026\nSam: who has the van keys?\nLee: I do.',
          ],
        }),
        expect.anything(),
      );
      expect(corpus.writeChunks).toHaveBeenCalledWith(
        SOURCE,
        2,
        true,
        'gemini-embedding-001',
        [
          expect.objectContaining({
            chunk_index: 0,
            heading: 'November 9, 2026',
            author_ids: ['sam', 'lee'],
            anchor_id: 'msg-1',
            anchor_at: '2026-11-09T22:00:00.000Z',
            message_count: 2,
          }),
        ],
      );
      expect(corpus.finishSource).toHaveBeenCalledWith(
        expect.objectContaining({
          chunkCount: 1,
          skipReason: null,
          leftOutCount: 3,
          leftOutAuthorIds: ['quiet-member'],
        }),
      );
    });

    it('records what a chat window left out even when nothing in it was left to index', async () => {
      const { run, corpus, embed } = setup({
        status: 'ok',
        content: {
          title: '#general',
          sourceAt: '2026-11-09T22:00:00.000Z',
          decays: true,
          sections: [],
          passages: [],
          leftOut: { count: 2, authorIds: ['quiet-member'] },
        },
      });
      await run();
      expect(embed).not.toHaveBeenCalled();
      expect(corpus.finishSource).toHaveBeenCalledWith(
        expect.objectContaining({
          skipReason: 'no_text',
          leftOutCount: 2,
          leftOutAuthorIds: ['quiet-member'],
        }),
      );
    });
  });
});
