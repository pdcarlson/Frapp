import type { AiProvider } from './language-model.interface';

/**
 * The port a recording is transcribed through (ADR-28 decision 1: "one for
 * transcription"; `spec/behavior/meetings.md` § Workflow, step 2).
 *
 * Transcription is its own step behind its own port: a general model is not
 * asked to listen, and the summary is a text call made afterwards from the
 * transcript. Adapters under `infrastructure/ai/` implement it, one per
 * vendor and a scripted one that needs no network. No feature calls an
 * adapter: the caller is `AiTranscriptionService`, which owns the consent
 * check, the spend hold and the usage record around each call, exactly as
 * `AiGatewayService` does for a model call.
 *
 * The shapes here are Frapp's own. A vendor's response never leaves its
 * adapter, which is what keeps the vendor one file (#712 is still open on
 * which vendor it is).
 */
export const TRANSCRIBER_REGISTRY = 'TRANSCRIBER_REGISTRY';

/** The recording, as an adapter may reach it. */
export interface TranscriptionAudio {
  /**
   * A short-lived link to the file, for a vendor that fetches it. It is a
   * secret for as long as it lasts: never logged, never put on an error.
   */
  url: string;
  /** The whole file, for a vendor that takes bytes. */
  read(): Promise<Uint8Array>;
  mimeType: string;
  sizeBytes: number;
  /**
   * How long the uploader's browser said the recording is. A hint for the
   * spend hold and the limits; the vendor's own count is what is recorded.
   */
  durationSeconds: number;
}

export interface TranscriptionRequest {
  /** The catalog task this call is for, `meetings.transcribe`. */
  task: string;
  /** The vendor's model id, from the catalog. */
  model: string;
  audio: TranscriptionAudio;
  /**
   * Names the vendor should spell right: the roster's display names. A hint,
   * never an instruction, and never used to recognise a voice.
   */
  vocabulary: readonly string[];
  /**
   * The vendor's id for work already started for this recording, from an
   * earlier try. An adapter that queues work picks it up again rather than
   * paying for the recording twice; one that answers in a single request
   * ignores it.
   */
  resumeJobId: string | null;
  /**
   * Called once the vendor has accepted the work, with its id for it, so a
   * later try can resume. Awaited before the adapter starts waiting.
   */
  onJobStarted(jobId: string): Promise<void>;
  signal?: AbortSignal;
}

/** One stretch of speech. */
export interface TranscriptionUtterance {
  /**
   * The vendor's label for whoever spoke ("A", "spk_2"), or null when it
   * gave none. It means something inside this one result only: Frapp keeps
   * no voiceprint and matches no voice to a member (ADR-28 decision 7).
   */
  speaker: string | null;
  text: string;
  startMs: number | null;
  endMs: number | null;
}

export interface TranscriptionResult {
  /** In the order spoken. Empty when the vendor heard no speech. */
  utterances: TranscriptionUtterance[];
  /** The recording's length as the vendor measured it: what is billed. */
  durationSeconds: number;
}

/** What one request to this vendor can carry. */
export interface TranscriberLimits {
  maxDurationSeconds: number;
  maxBytes: number;
}

export interface ITranscriber {
  readonly provider: AiProvider;
  readonly limits: TranscriberLimits;
  /**
   * The whole recording, start to finish. Throws only `LanguageModelError`
   * (`language-model.interface.ts`), which carries no text from the vendor:
   * `invalid_request` for a file the vendor could not read as audio.
   *
   * An adapter deletes whatever the vendor keeps of the recording and its
   * transcript once it has the result, where the vendor lets it.
   */
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

/**
 * The transcribers this process can use, by provider. `null` means the
 * provider has no credential here, so transcription is not available when
 * the catalog routes it there.
 */
export interface ITranscriberRegistry {
  resolve(provider: AiProvider): ITranscriber | null;
}
