import {
  LanguageModelError,
  type LanguageModelErrorKind,
} from '#domain/adapters/language-model.interface';
import type {
  ITranscriber,
  TranscriptionRequest,
  TranscriptionResult,
} from '#domain/adapters/transcription.interface';

export const ASSEMBLYAI_BASE_URL = 'https://api.assemblyai.com';

/** How often a queued transcript is asked after. */
const POLL_INTERVAL_MS = 5_000;

/** AssemblyAI takes this many key terms, each at most six words. */
const MAX_KEYTERMS = 1_000;
const MAX_KEYTERM_WORDS = 6;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface AssemblyAiDeps {
  fetch?: FetchLike;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** The fields of AssemblyAI's transcript this adapter reads. */
interface AssemblyAiTranscript {
  id?: unknown;
  status?: unknown;
  audio_duration?: unknown;
  utterances?: unknown;
  text?: unknown;
}

/**
 * AssemblyAI's pre-recorded transcription, over its REST API. No SDK: three
 * requests (submit, read, delete), made with `fetch`.
 *
 * - **Submit** hands AssemblyAI a short-lived link to the recording, with
 *   speaker labels on and the roster's names as key terms. AssemblyAI fetches
 *   the file itself, so the audio never passes through this process.
 * - **Read** is polled until the transcript is `completed` or `error`. The
 *   transcript's id is handed back through `onJobStarted` first, so a try
 *   that dies while waiting is picked up by the next one rather than paid
 *   for twice.
 * - **Delete** removes the transcript from AssemblyAI once Frapp has it.
 *   Best effort: a failed delete does not fail the transcription.
 *
 * Unverified against the live API (#712). The request and response fields
 * are AssemblyAI's documented ones as the 2026-11-11 research and its search
 * results give them; no key exists yet to call it with. Confirm them, and the
 * `universal-3-5-pro` model id, in the bake-off before any chapter's audio is
 * sent. **Model training must be switched off on the AssemblyAI account
 * first**: it is on by default, and only a paid account can turn it off.
 *
 * No text from AssemblyAI is put on an error: its error string can name the
 * file's link, which is a secret while it lasts.
 */
export class AssemblyAiTranscriber implements ITranscriber {
  readonly provider = 'assemblyai' as const;
  /** AssemblyAI's own limits; Frapp's are tighter. */
  readonly limits = {
    maxDurationSeconds: 10 * 60 * 60,
    maxBytes: 5 * 1024 * 1024 * 1024,
  };

  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

  constructor(
    private readonly apiKey: string,
    deps: AssemblyAiDeps = {},
  ) {
    this.fetch = deps.fetch ?? ((url, init) => fetch(url, init));
    this.sleep = deps.sleep ?? sleep;
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    let id = request.resumeJobId;
    let transcript = id ? await this.read(id, request.signal, true) : null;
    if (!transcript) {
      transcript = await this.submit(request);
      id = typeof transcript.id === 'string' ? transcript.id : null;
      if (!id) throw new LanguageModelError('unknown', 'assemblyai');
      await request.onJobStarted(id);
    }

    while (
      transcript.status === 'queued' ||
      transcript.status === 'processing'
    ) {
      await this.sleep(POLL_INTERVAL_MS, request.signal);
      transcript = (await this.read(id!, request.signal, false))!;
    }

    if (transcript.status !== 'completed') {
      // `error`: AssemblyAI could not fetch or decode the file. Its own
      // message is dropped; the caller says "couldn't be read as audio".
      await this.discard(id!);
      throw new LanguageModelError('invalid_request', 'assemblyai');
    }

    const result = toResult(transcript, request.audio.durationSeconds);
    await this.discard(id!);
    return result;
  }

  private async submit(
    request: TranscriptionRequest,
  ): Promise<AssemblyAiTranscript> {
    const keyterms = request.vocabulary
      .map((term) => term.trim())
      .filter(
        (term) =>
          term.length > 0 && term.split(/\s+/).length <= MAX_KEYTERM_WORDS,
      )
      .slice(0, MAX_KEYTERMS);
    return this.call(
      'POST',
      '/v2/transcript',
      {
        audio_url: request.audio.url,
        speech_models: [request.model],
        speaker_labels: true,
        ...(keyterms.length > 0 ? { keyterms_prompt: keyterms } : {}),
      },
      request.signal,
    );
  }

  /** The transcript, or null when `missingIsNull` and AssemblyAI has none by that id. */
  private async read(
    id: string,
    signal: AbortSignal | undefined,
    missingIsNull: boolean,
  ): Promise<AssemblyAiTranscript | null> {
    try {
      return await this.call(
        'GET',
        `/v2/transcript/${encodeURIComponent(id)}`,
        undefined,
        signal,
      );
    } catch (error) {
      if (
        missingIsNull &&
        error instanceof LanguageModelError &&
        (error.details.status === 404 || error.details.status === 400)
      ) {
        return null;
      }
      throw error;
    }
  }

  /** Removes the transcript at AssemblyAI. Never throws. */
  private async discard(id: string): Promise<void> {
    try {
      await this.call(
        'DELETE',
        `/v2/transcript/${encodeURIComponent(id)}`,
        undefined,
        undefined,
      );
    } catch {
      // AssemblyAI keeps it until its own retention removes it. Nothing
      // useful can be logged here without the id of a member's recording.
    }
  }

  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: Record<string, unknown> | undefined,
    signal: AbortSignal | undefined,
  ): Promise<AssemblyAiTranscript> {
    let response: Response;
    try {
      response = await this.fetch(`${ASSEMBLYAI_BASE_URL}${path}`, {
        method,
        headers: {
          authorization: this.apiKey,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      throw toLanguageModelError(error);
    }
    if (!response.ok) {
      throw new LanguageModelError(kindOf(response.status), 'assemblyai', {
        status: response.status,
      });
    }
    try {
      return (await response.json()) as AssemblyAiTranscript;
    } catch {
      throw new LanguageModelError('unknown', 'assemblyai', {
        status: response.status,
      });
    }
  }
}

function toResult(
  transcript: AssemblyAiTranscript,
  statedSeconds: number,
): TranscriptionResult {
  const utterances = Array.isArray(transcript.utterances)
    ? transcript.utterances.flatMap((raw: unknown) => {
        const item = (raw ?? {}) as Record<string, unknown>;
        if (typeof item.text !== 'string' || item.text.trim() === '') return [];
        return [
          {
            speaker: typeof item.speaker === 'string' ? item.speaker : null,
            text: item.text,
            startMs: typeof item.start === 'number' ? item.start : null,
            endMs: typeof item.end === 'number' ? item.end : null,
          },
        ];
      })
    : [];
  // No speaker turns but there are words: one unlabelled stretch.
  if (
    utterances.length === 0 &&
    typeof transcript.text === 'string' &&
    transcript.text.trim() !== ''
  ) {
    utterances.push({
      speaker: null,
      text: transcript.text,
      startMs: null,
      endMs: null,
    });
  }
  const measured = transcript.audio_duration;
  return {
    utterances,
    durationSeconds:
      typeof measured === 'number' && Number.isFinite(measured) && measured > 0
        ? measured
        : statedSeconds,
  };
}

function kindOf(status: number): LanguageModelErrorKind {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 408 || status === 504) return 'timeout';
  if (status >= 500) return 'overloaded';
  if (status >= 400) return 'invalid_request';
  return 'unknown';
}

function toLanguageModelError(error: unknown): LanguageModelError {
  if (error instanceof LanguageModelError) return error;
  if (error instanceof Error && error.name === 'AbortError') {
    return new LanguageModelError('aborted', 'assemblyai');
  }
  if (error instanceof TypeError) {
    return new LanguageModelError('connection', 'assemblyai');
  }
  return new LanguageModelError('unknown', 'assemblyai');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new LanguageModelError('aborted', 'assemblyai'));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', stop);
      resolve();
    }
    function stop() {
      clearTimeout(timer);
      reject(new LanguageModelError('aborted', 'assemblyai'));
    }
    signal?.addEventListener('abort', stop, { once: true });
  });
}
