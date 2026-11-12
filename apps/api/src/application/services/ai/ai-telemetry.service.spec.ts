import { assertContentFreeProperties } from '@repo/validation';
import type { AiUsageRecord } from '#domain/adapters/ai-usage-recorder.interface';
import type { AnalyticsService } from '../analytics.service';
import { AI_CALL_EVENT, AiTelemetryService } from './ai-telemetry.service';

const record: AiUsageRecord = {
  chapterId: 'chapter-1',
  actingUserId: 'user-1',
  task: 'ask.answer',
  family: 'ask',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  promptVersion: 'ask@v1',
  reservationId: 'res-1',
  outcome: 'completed',
  errorKind: null,
  inputTokens: 1200,
  outputTokens: 300,
  cachedInputTokens: 1000,
  costMicroUsd: 5400,
  latencyMs: 812,
};

describe('AiTelemetryService', () => {
  const track = jest.fn().mockResolvedValue(undefined);
  const service = new AiTelemetryService({
    track,
  } as unknown as AnalyticsService);

  beforeEach(() => track.mockClear());

  it('sends one content-free event per call, attributed to the chapter', async () => {
    await service.callFinished(record, {
      kind: 'cited',
      citationsKept: 2,
      citationsDropped: 1,
    });

    expect(track).toHaveBeenCalledTimes(1);
    const [name, userId, options] = track.mock.calls[0] as [
      string,
      string,
      { chapterId: string; app: string; properties: Record<string, unknown> },
    ];
    expect(name).toBe(AI_CALL_EVENT);
    expect(userId).toBe('user-1');
    expect(options.chapterId).toBe('chapter-1');
    expect(options.app).toBe('api');
    expect(options.properties).toEqual({
      task: 'ask.answer',
      family: 'ask',
      kind: 'cited',
      provider: 'anthropic',
      model: 'claude-sonnet-5-5',
      prompt_version: 'ask@v1',
      outcome: 'completed',
      error_kind: null,
      input_tokens: 1200,
      output_tokens: 300,
      cached_input_tokens: 1000,
      cost_micro_usd: 5400,
      latency_ms: 812,
      citations_kept: 2,
      citations_dropped: 1,
      is_background_run: false,
    });
    // The check `AnalyticsService.track` applies: scalars only, no content
    // or reserved keys.
    expect(() =>
      assertContentFreeProperties({
        name,
        properties: options.properties as never,
      }),
    ).not.toThrow();
  });

  it('marks a call made by a background run, without the run id', async () => {
    await service.callFinished(
      { ...record, runId: 'run-9' },
      { kind: 'structured', citationsKept: 0, citationsDropped: 0 },
    );
    const [, , options] = track.mock.calls[0] as [
      string,
      string,
      { properties: Record<string, unknown> },
    ];
    expect(options.properties.is_background_run).toBe(true);
    expect(JSON.stringify(options)).not.toContain('run-9');
  });

  it('runs the call and returns what it returned', async () => {
    await expect(
      service.inSpan({ ...record }, () => Promise.resolve('value')),
    ).resolves.toBe('value');
  });
});
