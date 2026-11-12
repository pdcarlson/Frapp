import { NotFoundException } from '@nestjs/common';
import { AiRunService } from './ai-run.service';
import { AiRunRegistry, type AiRunHandler } from './ai-run-registry';
import type { AiRunWorkerService } from '../workers/ai-run-worker.service';
import { FakeAiRunRepository } from '#test/helpers/fake-ai-run.repository';

const CHAPTER = '11111111-1111-4111-8111-111111111111';
const OTHER_CHAPTER = '22222222-2222-4222-8222-222222222222';
const OFFICER = '33333333-3333-4333-8333-333333333333';
const PRESIDENT = '44444444-4444-4444-8444-444444444444';
const MEMBER = '55555555-5555-4555-8555-555555555555';
const MEETING = '0a000000-0000-4000-8000-000000004310';

/** Lets a member read a run when they could open its meeting. */
const canView = jest.fn<Promise<boolean>, [unknown, string]>();

const minutes: AiRunHandler = {
  kind: 'minutes_draft',
  label: 'Drafting minutes',
  actsForMember: true,
  canView,
  run: async () => undefined,
};

describe('AiRunService', () => {
  const env = process.env.AI_ENABLED;
  let runs: FakeAiRunRepository;
  let registry: AiRunRegistry;
  let worker: { wake: jest.Mock };
  let service: AiRunService;

  const draft = (overrides: Record<string, unknown> = {}) =>
    service.enqueue({
      chapterId: CHAPTER,
      kind: 'minutes_draft',
      dedupeKey: `meeting:${MEETING}`,
      requestedBy: OFFICER,
      actingUserId: OFFICER,
      input: { meeting_id: MEETING },
      ...overrides,
    });

  beforeEach(() => {
    process.env.AI_ENABLED = 'true';
    runs = new FakeAiRunRepository();
    registry = new AiRunRegistry();
    registry.register(minutes);
    worker = { wake: jest.fn() };
    canView.mockReset().mockResolvedValue(false);
    service = new AiRunService(
      runs,
      registry,
      worker as unknown as AiRunWorkerService,
    );
  });

  afterAll(() => {
    process.env.AI_ENABLED = env;
  });

  describe('enqueue', () => {
    it('creates one run for a dedupe key, and the second call returns the first run', async () => {
      const first = await draft();
      const second = await draft({ requestedBy: PRESIDENT });

      expect(second.id).toBe(first.id);
      expect(second.requested_by).toBe(OFFICER);
      expect(runs.rows).toHaveLength(1);
      expect(first).toEqual(
        expect.objectContaining({
          status: 'queued',
          max_attempts: 3,
          attempt_count: 0,
        }),
      );
    });

    it('wakes the worker for a queued run', async () => {
      await draft();
      expect(worker.wake).toHaveBeenCalledTimes(1);
    });

    it('does not wake the worker for a run that already finished', async () => {
      const run = await draft();
      runs.row(run.id).status = 'succeeded';
      worker.wake.mockClear();

      await draft();
      expect(worker.wake).not.toHaveBeenCalled();
    });

    it('asking again after a failure queues the same run afresh, with the new asker', async () => {
      const run = await draft();
      Object.assign(runs.row(run.id), {
        status: 'failed',
        failure_reason: 'handler_failed',
        attempt_count: 3,
        finished_at: '2026-11-12T10:00:00.000Z',
      });
      worker.wake.mockClear();

      const again = await draft({
        requestedBy: PRESIDENT,
        actingUserId: PRESIDENT,
      });

      expect(again.id).toBe(run.id);
      expect(again).toEqual(
        expect.objectContaining({
          status: 'queued',
          attempt_count: 0,
          failure_reason: null,
          finished_at: null,
          requested_by: PRESIDENT,
          acting_user_id: PRESIDENT,
        }),
      );
      expect(runs.rows).toHaveLength(1);
      expect(worker.wake).toHaveBeenCalledTimes(1);
    });

    it('asking again after a cancel queues it again too', async () => {
      const run = await draft();
      await service.cancel(CHAPTER, run.id);
      await expect(draft()).resolves.toEqual(
        expect.objectContaining({ id: run.id, status: 'queued' }),
      );
    });

    it('takes the kind’s own number of tries', async () => {
      registry.register({ ...minutes, kind: 'document_index', maxAttempts: 5 });
      const run = await draft({ kind: 'document_index' });
      expect(run.max_attempts).toBe(5);
    });

    it('refuses input that carries text, so no text from the input reaches the table', async () => {
      await expect(
        draft({
          input: { meeting_id: MEETING, notes: 'Brother Smith moved to' },
        }),
      ).rejects.toThrow(/ids and counts only/);
      await expect(
        draft({ input: { attendee_ids: [MEETING, 'Smith'] } }),
      ).rejects.toThrow(/ids and counts only/);
      expect(runs.rows).toHaveLength(0);
    });

    it('refuses a dedupe key that is not built from ids', async () => {
      await expect(draft({ dedupeKey: 'notes from tuesday' })).rejects.toThrow(
        /built from ids/,
      );
    });

    it('refuses a kind nobody registered', async () => {
      await expect(draft({ kind: 'rush_summary' })).rejects.toThrow(
        /No handler/,
      );
    });

    it('refuses a member-reading kind with no member to act for', async () => {
      await expect(draft({ actingUserId: null })).rejects.toThrow(
        /acting member/,
      );
    });

    it('answers not available while AI is off, and writes nothing', async () => {
      process.env.AI_ENABLED = 'TRUE';
      await expect(draft()).rejects.toMatchObject({
        response: { code: 'ai.not_available' },
      });
      expect(runs.rows).toHaveLength(0);
      expect(worker.wake).not.toHaveBeenCalled();
    });
  });

  describe('who can read a run', () => {
    let runId: string;

    beforeEach(async () => {
      runId = (await draft({ requestedBy: OFFICER, actingUserId: PRESIDENT }))
        .id;
    });

    it('the member who started it', async () => {
      await expect(
        service.getForMember(CHAPTER, OFFICER, runId),
      ).resolves.toEqual(
        expect.objectContaining({
          id: runId,
          label: 'Drafting minutes',
          status: 'queued',
          failure_message: null,
        }),
      );
      expect(canView).not.toHaveBeenCalled();
    });

    it('the member it acts for', async () => {
      await expect(
        service.getForMember(CHAPTER, PRESIDENT, runId),
      ).resolves.toEqual(expect.objectContaining({ id: runId }));
    });

    it('a member the kind lets read it, asked about this run', async () => {
      canView.mockResolvedValue(true);
      await expect(
        service.getForMember(CHAPTER, MEMBER, runId),
      ).resolves.toEqual(expect.objectContaining({ id: runId }));
      expect(canView).toHaveBeenCalledWith(
        expect.objectContaining({ id: runId, chapter_id: CHAPTER }),
        MEMBER,
      );
      expect(canView.mock.calls[0][0]).not.toHaveProperty('lock_token');
    });

    it('nobody else: a 404, as for a run that does not exist', async () => {
      await expect(
        service.getForMember(CHAPTER, MEMBER, runId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('nobody in another chapter, the member who started it included', async () => {
      await expect(
        service.getForMember(OTHER_CHAPTER, OFFICER, runId),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('a kind with no view rule is private to its two members', async () => {
      registry.register({
        ...minutes,
        kind: 'private_kind',
        canView: undefined,
      });
      const id = (
        await draft({
          kind: 'private_kind',
          requestedBy: OFFICER,
          actingUserId: OFFICER,
        })
      ).id;
      canView.mockResolvedValue(true);

      await expect(
        service.getForMember(CHAPTER, MEMBER, id),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(canView).not.toHaveBeenCalled();
    });

    it('shows a failure in plain words', async () => {
      Object.assign(runs.row(runId), {
        status: 'failed',
        failure_reason: 'spend_limit',
        finished_at: '2026-11-12T10:00:00.000Z',
      });
      await expect(
        service.getForMember(CHAPTER, OFFICER, runId),
      ).resolves.toEqual(
        expect.objectContaining({
          status: 'failed',
          failure_reason: 'spend_limit',
          failure_message: 'Your chapter reached its AI limit for this period.',
        }),
      );
    });

    it('never hands back the lease, the dedupe key or the input', async () => {
      const view = await service.getForMember(CHAPTER, OFFICER, runId);
      expect(Object.keys(view).sort()).toEqual(
        [
          'attempt_count',
          'created_at',
          'failure_message',
          'failure_reason',
          'finished_at',
          'id',
          'kind',
          'label',
          'max_attempts',
          'result_ref',
          'started_at',
          'status',
        ].sort(),
      );
    });

    it('answers not available while AI is off', async () => {
      process.env.AI_ENABLED = '0';
      await expect(
        service.getForMember(CHAPTER, OFFICER, runId),
      ).rejects.toMatchObject({
        response: { code: 'ai.not_available' },
      });
      await expect(
        service.listForMember(CHAPTER, OFFICER, { limit: 20 }),
      ).rejects.toMatchObject({ response: { code: 'ai.not_available' } });
    });
  });

  it('lists the member’s own runs, newest first', async () => {
    const first = await draft();
    const second = await draft({ dedupeKey: 'meeting:2' });
    await draft({
      dedupeKey: 'meeting:3',
      requestedBy: MEMBER,
      actingUserId: MEMBER,
    });

    const listed = await service.listForMember(CHAPTER, OFFICER, { limit: 20 });
    expect(listed.map((run) => run.id)).toEqual([second.id, first.id]);
  });

  it('neither lists nor reads the chapter’s upkeep as the member it only acts for (#4504)', async () => {
    registry.register({
      kind: 'corpus_index',
      label: 'Indexing for search',
      actsForMember: true,
      chapterUpkeep: true,
      run: async () => undefined,
    });
    const indexing = await service.enqueue({
      chapterId: CHAPTER,
      kind: 'corpus_index',
      dedupeKey: 'source:1',
      requestedBy: null,
      actingUserId: MEMBER,
      input: { corpus_source_id: MEETING },
    });

    await expect(
      service.listForMember(CHAPTER, MEMBER, { limit: 20 }),
    ).resolves.toEqual([]);
    await expect(
      service.getForMember(CHAPTER, MEMBER, indexing.id),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cancels a queued run once', async () => {
    const run = await draft();
    await expect(service.cancel(CHAPTER, run.id)).resolves.toBe(true);
    await expect(service.cancel(CHAPTER, run.id)).resolves.toBe(false);
    expect(runs.row(run.id).status).toBe('cancelled');
  });
});
