import { GoogleGenAI } from '@google/genai';
import type { GoogleVertexEnvSettings } from '../../config/ai-config';
import { toLanguageModelError } from './google-language-model';
import type {
  ITranscriber,
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptionUtterance,
} from '#domain/adapters/transcription.interface';

/** The slice of the SDK client this adapter calls, so a test can stand in for it. */
export type GoogleTranscriptionClient = {
  models: Pick<GoogleGenAI['models'], 'generateContent'>;
};

/** Google takes this many custom vocabulary phrases comfortably; the roster's names. */
const MAX_VOCABULARY = 500;

/**
 * Google's dedicated transcription model on its paid cloud platform (Vertex
 * AI), through the same SDK and service account as `GoogleLanguageModel`.
 * The bake-off's challenger to AssemblyAI (#712, ADR-28 "What this record
 * does not decide").
 *
 * One request per recording: the file goes inline, with speaker labels on and
 * the roster's names as custom vocabulary, and the answer is read from the
 * response's transcription parts.
 *
 * **Its limits are why the catalog does not route to it today.** With speaker
 * labels the model takes 30 minutes of audio per request, and a request body
 * holds about 100 MB. A chapter meeting runs past both. Taking a longer
 * recording means cutting the audio into pieces, on a server with no audio
 * tool, and joining transcripts whose speaker labels do not line up between
 * pieces. That is not built: `AiTranscriptionService` refuses a recording
 * past these limits before anything is sent.
 *
 * Unverified against the live API (#712). The request shape is the SDK's own
 * types (`audioTranscriptionConfig`, the `audioTranscription` part); the
 * limits are the 2026-11-11 research's reading of Google's model page from
 * search results. Confirm both in the bake-off.
 *
 * Nothing is stored at Google: no Files API, no bucket (ADR-28 decision 10).
 */
export class GoogleTranscriber implements ITranscriber {
  readonly provider = 'google' as const;
  readonly limits = {
    maxDurationSeconds: 30 * 60,
    maxBytes: 100 * 1024 * 1024,
  };

  constructor(private readonly client: GoogleTranscriptionClient) {}

  static fromSettings(settings: GoogleVertexEnvSettings): GoogleTranscriber {
    return new GoogleTranscriber(
      new GoogleGenAI({
        enterprise: true,
        project: settings.project,
        location: settings.location,
        googleAuthOptions: {
          credentials: settings.credentials,
          scopes: ['https://www.googleapis.com/auth/cloud-platform'],
        },
      }),
    );
  }

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    const bytes = await request.audio.read();
    const vocabulary = request.vocabulary
      .map((term) => term.trim())
      .filter((term) => term.length > 0)
      .slice(0, MAX_VOCABULARY);
    try {
      const response = await this.client.models.generateContent({
        model: request.model,
        contents: [
          {
            role: 'user',
            parts: [
              {
                inlineData: {
                  mimeType: request.audio.mimeType,
                  data: Buffer.from(bytes).toString('base64'),
                },
              },
            ],
          },
        ],
        config: {
          audioTranscriptionConfig: {
            diarization: true,
            ...(vocabulary.length > 0 ? { customVocabulary: vocabulary } : {}),
          },
          ...(request.signal ? { abortSignal: request.signal } : {}),
        },
      });

      const utterances: TranscriptionUtterance[] = [];
      let lastEndMs = 0;
      for (const candidate of response.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          const spoken = part.audioTranscription;
          const text = spoken?.text ?? part.text;
          if (typeof text !== 'string' || text.trim() === '') continue;
          const startMs = offsetMs(spoken?.startOffset);
          const endMs = offsetMs(spoken?.endOffset);
          if (endMs !== null) lastEndMs = Math.max(lastEndMs, endMs);
          utterances.push({
            speaker: spoken?.speakerLabel?.trim() || null,
            text,
            startMs,
            endMs,
          });
        }
        // One candidate is one transcript; a second would repeat it.
        break;
      }
      return {
        utterances,
        // `request.maxSeconds` cannot be honoured: the audio goes inline and
        // Google has no stop-at. Its 30-minute limit is the bound here.
        // Billed by the audio sent, so the stated length stands unless the
        // model's own offsets run past it.
        durationSeconds: Math.max(
          request.audio.durationSeconds,
          Math.ceil(lastEndMs / 1000),
        ),
      };
    } catch (error) {
      throw toLanguageModelError(error);
    }
  }

  /** Answered in one request, with the audio inline: Google holds no job. */
  async discard(): Promise<void> {}
}

/** `"12.5s"` (a protobuf duration) as milliseconds. */
function offsetMs(offset: string | undefined): number | null {
  if (!offset) return null;
  const seconds = Number.parseFloat(offset);
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}
