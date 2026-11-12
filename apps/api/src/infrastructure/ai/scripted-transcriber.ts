import { abortableSleep } from './abortable-sleep';
import type {
  ITranscriber,
  TranscriptionRequest,
  TranscriptionResult,
  TranscriptionUtterance,
} from '#domain/adapters/transcription.interface';

/** How long the scripted transcriber takes, so the waiting state can be seen. */
export const SCRIPTED_TRANSCRIPTION_DELAY_MS = 4_000;

/**
 * The transcriber that needs no network and no key (`AI_PROVIDER=scripted`).
 *
 * It never opens the recording. It returns the same short chapter meeting
 * every time, with the first two names of the vocabulary it was handed
 * written in, so the upload flow can be walked locally from the file picker
 * to drafted minutes. It proves nothing about a vendor: the bake-off on a
 * real recording does that (#712).
 *
 * The length it reports is the length the uploader stated, so the ledger and
 * the caps see what a real call of that size would cost.
 */
export class ScriptedTranscriber implements ITranscriber {
  readonly provider = 'scripted' as const;
  readonly limits = {
    maxDurationSeconds: 10 * 60 * 60,
    maxBytes: 5 * 1024 * 1024 * 1024,
  };

  constructor(private readonly delayMs = SCRIPTED_TRANSCRIPTION_DELAY_MS) {}

  async transcribe(
    request: TranscriptionRequest,
  ): Promise<TranscriptionResult> {
    await wait(this.delayMs, request.signal);
    return {
      utterances: scriptedMeeting(request.vocabulary),
      durationSeconds: request.audio.durationSeconds,
    };
  }

  /** Nothing is kept anywhere. */
  async discard(): Promise<void> {}
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return abortableSleep(ms, 'scripted', signal);
}

function scriptedMeeting(
  vocabulary: readonly string[],
): TranscriptionUtterance[] {
  const [first, second] = [...vocabulary].sort((a, b) => a.localeCompare(b));
  const booker = first ?? 'The social chair';
  const sender = second ?? 'The philanthropy chair';
  const lines: [string, string][] = [
    [
      'A',
      'Okay, let us get started. Reminder that dues are due on the fifteenth.',
    ],
    [
      'B',
      'Treasurer report. We have two thousand one hundred dollars left for the semester.',
    ],
    [
      'A',
      'There is a motion to spend four hundred dollars on the formal venue deposit. All in favor?',
    ],
    ['A', 'The motion passed 31 to 4.'],
    ['C', `${booker} will book the formal venue by Friday.`],
    ['A', 'Someone needs to email the alumni about homecoming.'],
    ['B', `${sender} will send the philanthropy sign up sheet tonight.`],
    ['A', 'Next meeting is Sunday at seven. Meeting adjourned.'],
  ];
  return lines.map(([speaker, text], index) => ({
    speaker,
    text,
    startMs: index * 20_000,
    endMs: index * 20_000 + 15_000,
  }));
}
