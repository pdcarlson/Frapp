import { LanguageModelError } from '#domain/adapters/language-model.interface';
import type {
  ITranscriber,
  TranscriptionRequest,
} from '#domain/adapters/transcription.interface';
import { AiTranscriptionService } from './ai-transcription.service';

const CONTEXT = {
  chapterId: 'chapter-1',
  actingUserId: 'user-1',
  runId: 'run-1',
};

function audio(overrides: Partial<TranscriptionRequest['audio']> = {}) {
  return {
    url: 'https://storage.test/secret-link',
    read: () => Promise.resolve(new Uint8Array()),
    mimeType: 'audio/mp4',
    sizeBytes: 60_000_000,
    durationSeconds: 3600,
    ...overrides,
  };
}

function harness(transcriber: Partial<ITranscriber> | null = {}) {
  const adapter: ITranscriber | null =
    transcriber === null
      ? null
      : {
          provider: 'assemblyai',
          limits: { maxDurationSeconds: 36_000, maxBytes: 5 * 1024 ** 3 },
          discard: jest.fn().mockResolvedValue(undefined),
          transcribe: jest.fn().mockResolvedValue({
            utterances: [
              { speaker: 'A', text: 'Hello.', startMs: 0, endMs: 500 },
            ],
            durationSeconds: 3541.2,
          }),
          ...transcriber,
        };
  const registry = { resolve: jest.fn().mockReturnValue(adapter) };
  const consent = { check: jest.fn().mockResolvedValue({ allowed: true }) };
  const spend = {
    reserve: jest
      .fn()
      .mockResolvedValue({ granted: true, reservationId: 'hold-1' }),
  };
  const recorder = { record: jest.fn().mockResolvedValue(undefined) };
  const telemetry = {
    inSpan: jest.fn((_call: unknown, run: () => Promise<unknown>) => run()),
    callFinished: jest.fn().mockResolvedValue(undefined),
  };
  const service = new AiTranscriptionService(
    registry,
    consent,
    spend,
    recorder,
    telemetry as never,
  );
  const transcribe = (
    overrides: Partial<
      Parameters<AiTranscriptionService['transcribe']>[1]
    > = {},
  ) =>
    service.transcribe(
      'meetings.transcribe',
      {
        audio: audio(),
        maxSeconds: 7200,
        vocabulary: ['Priya Natarajan'],
        promptVersion: 'meetings.transcribe@v1',
        resumeJobId: null,
        onJobStarted: () => Promise.resolve(),
        ...overrides,
      },
      CONTEXT,
    );
  return {
    service,
    adapter,
    registry,
    consent,
    spend,
    recorder,
    telemetry,
    transcribe,
  };
}

describe('AiTranscriptionService', () => {
  const original = process.env.AI_ENABLED;
  beforeEach(() => {
    process.env.AI_ENABLED = 'true';
  });
  afterAll(() => {
    if (original === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = original;
  });

  it('makes no call and asks no seam when AI_ENABLED is off', async () => {
    delete process.env.AI_ENABLED;
    const h = harness();
    await expect(h.transcribe()).resolves.toEqual({
      status: 'unavailable',
      reason: 'disabled',
    });
    expect(h.service.availability('meetings.transcribe')).toEqual({
      available: false,
      reason: 'disabled',
    });
    expect(h.registry.resolve).not.toHaveBeenCalled();
    expect(h.consent.check).not.toHaveBeenCalled();
  });

  it('is not available when the catalog’s vendor has no credential', async () => {
    const h = harness(null);
    await expect(h.transcribe()).resolves.toEqual({
      status: 'unavailable',
      reason: 'not_configured',
    });
    expect(h.service.availability('meetings.transcribe')).toEqual({
      available: false,
      reason: 'not_configured',
    });
    expect(h.spend.reserve).not.toHaveBeenCalled();
  });

  it('refuses a recording past the vendor’s limits before consent or spend', async () => {
    const limits = { maxDurationSeconds: 1800, maxBytes: 100_000_000 };
    const h = harness({ limits });
    await expect(h.transcribe()).resolves.toEqual({
      status: 'unsupported',
      reason: 'too_long',
      limits,
    });
    await expect(
      h.transcribe({
        audio: audio({ durationSeconds: 600, sizeBytes: 200_000_000 }),
      }),
    ).resolves.toMatchObject({ status: 'unsupported', reason: 'too_large' });
    expect(h.consent.check).not.toHaveBeenCalled();
    expect(h.service.availability('meetings.transcribe')).toEqual({
      available: true,
      limits,
    });
  });

  it('stops at consent, then at the spend caps, without calling the vendor', async () => {
    const h = harness();
    h.consent.check.mockResolvedValueOnce({
      allowed: false,
      reason: 'member_declined',
    });
    await expect(h.transcribe()).resolves.toEqual({
      status: 'unavailable',
      reason: 'consent',
      detail: 'member_declined',
    });
    expect(h.spend.reserve).not.toHaveBeenCalled();

    h.spend.reserve.mockResolvedValueOnce({
      granted: false,
      reason: 'chapter_cap',
    });
    await expect(h.transcribe()).resolves.toEqual({
      status: 'unavailable',
      reason: 'spend_cap',
      detail: 'chapter_cap',
    });
    expect(h.adapter!.transcribe).not.toHaveBeenCalled();
    expect(h.recorder.record).not.toHaveBeenCalled();
  });

  it('holds the stated length at the catalog price, then settles what the vendor measured', async () => {
    const h = harness();
    const result = await h.transcribe();
    expect(result).toMatchObject({ status: 'ok', durationSeconds: 3541.2 });

    const call = {
      chapterId: 'chapter-1',
      actingUserId: 'user-1',
      runId: 'run-1',
      task: 'meetings.transcribe',
      family: 'meetings',
      provider: 'assemblyai',
      model: 'universal-3-5-pro',
      promptVersion: 'meetings.transcribe@v1',
    };
    expect(h.consent.check).toHaveBeenCalledWith(call);
    // The feature's two-hour limit at $0.23 an hour, not the stated hour.
    expect(h.spend.reserve).toHaveBeenCalledWith(call, {
      inputTokens: 0,
      maxOutputTokens: 0,
      maxCostMicroUsd: 460_000,
    });
    expect(h.adapter!.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({
        task: 'meetings.transcribe',
        model: 'universal-3-5-pro',
        vocabulary: ['Priya Natarajan'],
        resumeJobId: null,
        maxSeconds: 7200,
      }),
    );
    // 3,542 seconds, rounded up, at $0.23 an hour.
    expect(h.recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        ...call,
        reservationId: 'hold-1',
        outcome: 'completed',
        errorKind: null,
        audioSeconds: 3542,
        costMicroUsd: Math.ceil((3542 * 230_000) / 3600),
        inputTokens: 0,
        outputTokens: 0,
      }),
    );
    expect(h.telemetry.callFinished).toHaveBeenCalledWith(
      expect.objectContaining({ audioSeconds: 3542 }),
      expect.objectContaining({ kind: 'transcription' }),
    );
  });

  it('holds for the longest recording it takes, whatever length and size the uploader stated', async () => {
    const h = harness();
    await h.transcribe({
      audio: audio({ durationSeconds: 10, sizeBytes: 1 }),
    });
    expect(h.spend.reserve.mock.calls[0][1].maxCostMicroUsd).toBe(460_000);
  });

  it('never asks the vendor for more than the vendor takes', async () => {
    const h = harness({
      limits: { maxDurationSeconds: 1800, maxBytes: 5 * 1024 ** 3 },
    });
    await h.transcribe({ audio: audio({ durationSeconds: 600 }) });
    expect(h.spend.reserve.mock.calls[0][1].maxCostMicroUsd).toBe(115_000);
    expect(h.adapter!.transcribe).toHaveBeenCalledWith(
      expect.objectContaining({ maxSeconds: 1800 }),
    );
  });

  it('records a vendor failure and rethrows it with no vendor text', async () => {
    const h = harness({
      transcribe: jest
        .fn()
        .mockRejectedValue(new LanguageModelError('overloaded', 'assemblyai')),
    });
    await expect(h.transcribe()).rejects.toMatchObject({ kind: 'overloaded' });
    expect(h.recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'error',
        errorKind: 'overloaded',
        audioSeconds: 0,
        costMicroUsd: 0,
      }),
    );
  });

  it('does not settle a finished transcription a second time, as an error, when the ledger write fails', async () => {
    const h = harness();
    h.recorder.record.mockRejectedValueOnce(new Error('ledger down'));
    await expect(h.transcribe()).rejects.toThrow('ledger down');
    expect(h.recorder.record).toHaveBeenCalledTimes(1);
    expect(h.recorder.record).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'completed' }),
    );
  });

  it('has the vendor delete a job, and never throws doing it', async () => {
    const discard = jest.fn().mockRejectedValue(new Error('gone'));
    const h = harness({ discard });
    await expect(
      h.service.discard('meetings.transcribe', 'job-1'),
    ).resolves.toBeUndefined();
    expect(discard).toHaveBeenCalledWith('job-1');
  });

  it('replaces an error that is not the adapter’s own, which could quote the link', async () => {
    const h = harness({
      transcribe: jest
        .fn()
        .mockRejectedValue(
          new Error('GET https://storage.test/secret-link failed'),
        ),
    });
    const error = await h.transcribe().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LanguageModelError);
    expect((error as Error).message).not.toContain('secret-link');
    expect((error as LanguageModelError).kind).toBe('unknown');
  });
});
