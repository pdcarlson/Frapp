import { LanguageModelError } from '#domain/adapters/language-model.interface';
import type { TranscriptionRequest } from '#domain/adapters/transcription.interface';
import {
  ASSEMBLYAI_BASE_URL,
  AssemblyAiTranscriber,
} from './assemblyai-transcriber';

const KEY = 'test-key-not-a-secret';

function request(
  overrides: Partial<TranscriptionRequest> = {},
): TranscriptionRequest {
  return {
    task: 'meetings.transcribe',
    model: 'universal-3-5-pro',
    audio: {
      url: 'https://storage.test/secret-link',
      read: () => Promise.reject(new Error('this vendor fetches the link')),
      mimeType: 'audio/mp4',
      sizeBytes: 1000,
      durationSeconds: 600,
    },
    vocabulary: ['Priya Natarajan', '  ', 'one two three four five six seven'],
    resumeJobId: null,
    onJobStarted: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const DONE = {
  id: 'job-1',
  status: 'completed',
  audio_duration: 598,
  utterances: [
    { speaker: 'A', text: 'Call to order.', start: 0, end: 900 },
    { speaker: 'B', text: 'Second.', start: 900, end: 1200 },
    { speaker: 'B', text: '   ' },
  ],
};

function adapter(replies: (() => Promise<Response>)[]) {
  const fetch = jest.fn((url: string, init: RequestInit) => {
    void url;
    void init;
    const next = replies.shift();
    if (!next) throw new Error('unexpected request');
    return next();
  });
  const sleep = jest.fn().mockResolvedValue(undefined);
  return {
    fetch,
    sleep,
    transcriber: new AssemblyAiTranscriber(KEY, { fetch, sleep }),
  };
}

describe('AssemblyAiTranscriber', () => {
  it('submits the link with speaker labels and names, polls, and deletes the vendor copy', async () => {
    const { fetch, sleep, transcriber } = adapter([
      () => json({ id: 'job-1', status: 'queued' }),
      () => json({ id: 'job-1', status: 'processing' }),
      () => json(DONE),
      () => json({ id: 'job-1', status: 'completed' }),
    ]);
    const input = request();
    const result = await transcriber.transcribe(input);

    expect(result).toEqual({
      durationSeconds: 598,
      utterances: [
        { speaker: 'A', text: 'Call to order.', startMs: 0, endMs: 900 },
        { speaker: 'B', text: 'Second.', startMs: 900, endMs: 1200 },
      ],
    });
    expect(input.onJobStarted).toHaveBeenCalledWith('job-1');
    expect(sleep).toHaveBeenCalledTimes(2);

    const [submitUrl, submit] = fetch.mock.calls[0];
    expect(submitUrl).toBe(`${ASSEMBLYAI_BASE_URL}/v2/transcript`);
    expect(submit.method).toBe('POST');
    expect((submit.headers as Record<string, string>).authorization).toBe(KEY);
    expect(JSON.parse(submit.body as string)).toEqual({
      audio_url: 'https://storage.test/secret-link',
      speech_models: ['universal-3-5-pro'],
      speaker_labels: true,
      // Blank and over-long phrases are dropped.
      keyterms_prompt: ['Priya Natarajan'],
    });
    // The vendor's copy stays until the caller says the transcript is stored.
    expect(fetch.mock.calls.map(([, init]) => init.method)).not.toContain(
      'DELETE',
    );
  });

  it('deletes the job at the vendor when asked, and never throws', async () => {
    const { fetch, transcriber } = adapter([() => json({})]);
    await transcriber.discard('job-1');
    expect(fetch.mock.calls[0]).toEqual([
      `${ASSEMBLYAI_BASE_URL}/v2/transcript/job-1`,
      expect.objectContaining({ method: 'DELETE' }),
    ]);
    const failing = adapter([() => json({ error: 'nope' }, 500)]);
    await expect(failing.transcriber.discard('job-1')).resolves.toBeUndefined();
  });

  it('resumes a job from an earlier try without submitting, and so without paying, again', async () => {
    const { fetch, transcriber } = adapter([() => json(DONE), () => json({})]);
    const input = request({ resumeJobId: 'job-1' });
    await expect(transcriber.transcribe(input)).resolves.toMatchObject({
      durationSeconds: 598,
    });
    expect(fetch.mock.calls.map(([, init]) => init.method)).toEqual(['GET']);
    expect(input.onJobStarted).not.toHaveBeenCalled();
  });

  it('submits afresh when the earlier job is gone at the vendor', async () => {
    const { fetch, transcriber } = adapter([
      () => json({ error: 'not found' }, 404),
      () => json({ id: 'job-2', status: 'queued' }),
      () => json({ ...DONE, id: 'job-2' }),
      () => json({}),
    ]);
    const input = request({ resumeJobId: 'job-1' });
    await transcriber.transcribe(input);
    expect(fetch.mock.calls[1][1].method).toBe('POST');
    expect(input.onJobStarted).toHaveBeenCalledWith('job-2');
  });

  it('reads a file the vendor could not transcribe as invalid_request, with none of its words', async () => {
    const { fetch, transcriber } = adapter([
      () => json({ id: 'job-1', status: 'queued' }),
      () =>
        json({
          id: 'job-1',
          status: 'error',
          error: 'Download error for https://storage.test/secret-link',
        }),
      () => json({}),
    ]);
    const error = await transcriber
      .transcribe(request())
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LanguageModelError);
    expect((error as LanguageModelError).kind).toBe('invalid_request');
    expect(JSON.stringify(error)).not.toContain('secret-link');
    expect((error as Error).message).not.toContain('secret-link');
  });

  it.each([
    [401, 'auth'],
    [429, 'rate_limited'],
    [503, 'overloaded'],
    [400, 'invalid_request'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const { transcriber } = adapter([() => json({ error: 'x' }, status)]);
    await expect(transcriber.transcribe(request())).rejects.toMatchObject({
      kind,
      provider: 'assemblyai',
      details: { status },
    });
  });

  it('maps a dropped connection to a retryable error', async () => {
    const { transcriber } = adapter([
      () => Promise.reject(new TypeError('fetch failed')),
    ]);
    await expect(transcriber.transcribe(request())).rejects.toMatchObject({
      kind: 'connection',
      retryable: true,
    });
  });

  it('falls back to the whole text and the stated length when the vendor gives no turns', async () => {
    const { transcriber } = adapter([
      () => json({ id: 'job-1', status: 'completed', text: 'All one voice.' }),
      () => json({}),
    ]);
    await expect(transcriber.transcribe(request())).resolves.toEqual({
      durationSeconds: 600,
      utterances: [
        { speaker: null, text: 'All one voice.', startMs: null, endMs: null },
      ],
    });
  });

  it('returns the transcript even when deleting the vendor copy fails', async () => {
    const { transcriber } = adapter([
      () => json(DONE),
      () => json({ error: 'nope' }, 500),
    ]);
    await expect(
      transcriber.transcribe(request({ resumeJobId: 'job-1' })),
    ).resolves.toMatchObject({ durationSeconds: 598 });
  });
});
