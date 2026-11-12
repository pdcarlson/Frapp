/**
 * A meeting's uploaded recording (`spec/behavior/meetings.md` § Uploading a
 * recording, #712). One source for what a recording may be, where it stands,
 * the words each state shows and the notice the upload step carries, read by
 * the API, the web upload step and, later, mobile.
 */

/**
 * The largest recording Frapp takes. Two hours from a phone's voice recorder
 * is about 60 MB at the rate iPhones record and about 115 MB at the rate most
 * Android recorders do, so 200 MB covers both with room to spare. The
 * `meeting-audio` bucket's `file_size_limit` mirrors it
 * (`supabase/migrations/20261112210000_meeting_recordings.sql`).
 */
export const MAX_MEETING_RECORDING_BYTES = 200 * 1024 * 1024;
export const MAX_MEETING_RECORDING_LABEL = "200 MB";

/** The longest recording Frapp takes, and the shortest worth transcribing. */
export const MAX_MEETING_RECORDING_SECONDS = 2 * 60 * 60;
export const MIN_MEETING_RECORDING_SECONDS = 10;
export const MAX_MEETING_RECORDING_LENGTH_LABEL = "2 hours";

/**
 * What a phone's recorder, or an export from one, produces. The browser's
 * name for a type varies (Safari says `audio/x-m4a` for the file Chrome calls
 * `audio/mp4`), so several names per format are listed, and the extension
 * decides when the browser names no type at all.
 *
 * The `meeting-audio` bucket's `allowed_mime_types` is `MEETING_RECORDING_MIME_TYPES`.
 */
const RECORDING_FORMATS = [
  { extension: "m4a", types: ["audio/mp4", "audio/x-m4a", "audio/m4a"] },
  { extension: "mp4", types: ["audio/mp4"] },
  { extension: "mp3", types: ["audio/mpeg", "audio/mp3"] },
  { extension: "wav", types: ["audio/wav", "audio/x-wav", "audio/wave"] },
  { extension: "aac", types: ["audio/aac"] },
  { extension: "ogg", types: ["audio/ogg"] },
  { extension: "opus", types: ["audio/ogg", "audio/opus"] },
  { extension: "webm", types: ["audio/webm"] },
  { extension: "flac", types: ["audio/flac", "audio/x-flac"] },
] as const;

export const MEETING_RECORDING_MIME_TYPES: readonly string[] = [
  ...new Set(RECORDING_FORMATS.flatMap((format) => [...format.types])),
];

export const MEETING_RECORDING_EXTENSIONS: readonly string[] =
  RECORDING_FORMATS.map((format) => format.extension);

/** The file picker's `accept`: every extension and every type. */
export const MEETING_RECORDING_ACCEPT = [
  ...MEETING_RECORDING_EXTENSIONS.map((extension) => `.${extension}`),
  ...MEETING_RECORDING_MIME_TYPES,
].join(",");

export const MEETING_RECORDING_FORMATS_LABEL = "M4A, MP3, WAV, AAC, OGG or FLAC";

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot < 0 ? "" : fileName.slice(dot + 1).toLowerCase();
}

/**
 * The type a recording is stored under, or null when it is not a format
 * Frapp takes. The declared type wins when it is on the list. A browser that
 * names no type, or a generic one, is read by the file's extension.
 */
export function meetingRecordingMimeType(
  fileName: string,
  declaredType: string | null | undefined,
): string | null {
  const declared = ((declaredType ?? "").split(";")[0] ?? "").trim().toLowerCase();
  if (MEETING_RECORDING_MIME_TYPES.includes(declared)) return declared;
  if (declared !== "" && declared !== "application/octet-stream") {
    // A video, a document: named, and not audio Frapp takes.
    if (!declared.startsWith("audio/")) return null;
  }
  const format = RECORDING_FORMATS.find(
    (candidate) => candidate.extension === extensionOf(fileName),
  );
  return format ? format.types[0] : null;
}

/** The extension a recording is stored under, from its type. */
export function meetingRecordingExtension(mimeType: string): string {
  return (
    RECORDING_FORMATS.find((format) =>
      (format.types as readonly string[]).includes(mimeType),
    )?.extension ?? "bin"
  );
}

/** Where a meeting's recording stands, as the editor reads it. */
export const MEETING_RECORDING_STATUSES = [
  /** No recording was uploaded, or it was removed. */
  "none",
  /** The upload was started and has not finished. */
  "uploading",
  /** Uploaded; the transcript is being written. */
  "transcribing",
  /** The transcript is written and the audio is deleted. */
  "ready",
  "failed",
] as const;
export type MeetingRecordingStatus =
  (typeof MEETING_RECORDING_STATUSES)[number];

export const MEETING_RECORDING_FAILURES = [
  /** The president has not turned meeting notes on. */
  "chapter_off",
  /** The officer has not said yes on the AI sheet. */
  "consent_required",
  /** The chapter's, the member's or the platform's AI limit was reached. */
  "spend_limit",
  /** AI is off on this server, or no transcription provider is set up. */
  "unavailable",
  /** The officer can no longer edit these minutes. */
  "not_permitted",
  /** The upload never finished. */
  "upload_incomplete",
  /** The file is not audio the provider could read. */
  "unreadable",
  /** Longer than the provider, or Frapp, takes. */
  "too_long",
  /** The provider heard no speech. */
  "no_speech",
  /** Anything else: a provider outage, a time-out. */
  "failed",
] as const;
export type MeetingRecordingFailure =
  (typeof MEETING_RECORDING_FAILURES)[number];

/**
 * Each failure in plain words (principles P2: no codes on screen). In every
 * case the audio is already deleted, so each line says what to do next.
 */
export const MEETING_RECORDING_FAILURE_COPY: Readonly<
  Record<MeetingRecordingFailure, string>
> = {
  chapter_off:
    "Meeting notes are turned off for your chapter. The president can turn them on in Chapter settings.",
  consent_required:
    "Transcribing sends the recording to an AI provider, and you haven't agreed to that yet.",
  spend_limit:
    "Your chapter has reached its AI limit for now. The recording was deleted. You can type your notes instead.",
  unavailable:
    "Transcribing isn't available right now. The recording was deleted. You can type your notes instead.",
  not_permitted: "You can no longer edit these minutes.",
  upload_incomplete:
    "The upload didn't finish, so nothing was transcribed. Upload the recording again.",
  unreadable:
    "That file couldn't be read as audio. Export the recording again from your phone and upload it.",
  too_long: `That recording is longer than ${MAX_MEETING_RECORDING_LENGTH_LABEL}. Split it in two and upload each part.`,
  no_speech:
    "No speech could be heard in that recording. Check that it is the right file.",
  failed:
    "The transcript didn't come through, and the recording was deleted. Upload it again to retry.",
};

export function isMeetingRecordingFailure(
  value: unknown,
): value is MeetingRecordingFailure {
  return (
    typeof value === "string" &&
    (MEETING_RECORDING_FAILURES as readonly string[]).includes(value)
  );
}

/**
 * The upload step's notice (`spec/behavior/meetings.md` § Recording notice).
 * Working copy: the wording, and whether a chapter in a state that requires
 * everyone's agreement needs more than this, is Paul's and counsel's
 * (#3297). The script is the spec's own example.
 */
export const MEETING_RECORDING_NOTICE = {
  heading: "Before you upload",
  rule: "A meeting is recorded only after the room has been told, and anyone present may object.",
  script:
    "This meeting is being recorded and transcribed by Frapp. Tell the secretary if you object.",
  scriptLabel: "What should have been read out before recording started",
  confirmLabel:
    "Everyone in the room was told this meeting was being recorded, and nobody objected.",
  whatHappens:
    "The recording goes to an AI provider to be written out as text. It is deleted as soon as the transcript is written, and Frapp tells the members who were at the meeting that it was uploaded.",
  standards:
    "Never upload a Standards hearing. Those minutes are written by hand.",
  unconfirmed:
    "Confirm that the room was told before the recording started. If it wasn't, don't upload it.",
} as const;

/** What the members who were at the meeting are told, once per meeting. */
export const MEETING_RECORDING_NOTIFICATION = {
  title: "Meeting recording uploaded",
  body: (eventName: string) =>
    `A recording of ${eventName} was uploaded to write the minutes. It is deleted once it is transcribed. Tell the secretary if you object.`,
} as const;

/** One stretch of speech, as a transcription provider returns it. */
export interface TranscriptUtterance {
  /** The provider's label for whoever spoke, or null when it gave none. */
  speaker: string | null;
  text: string;
}

/**
 * A transcript as the notes box holds it: one line per stretch of speech,
 * opened by "Speaker 1", "Speaker 2" in the order each voice is first heard.
 * The labels belong to this one recording (`meetings.md` § Voices): they are
 * numbered here from whatever the provider called them, so nothing about a
 * voice carries from one meeting to the next. Consecutive stretches by the
 * same speaker are one line.
 */
export function formatMeetingTranscript(
  utterances: readonly TranscriptUtterance[],
): { text: string; speakerCount: number } {
  const numbers = new Map<string, number>();
  const lines: { speaker: string | null; text: string }[] = [];
  for (const utterance of utterances) {
    const text = utterance.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const speaker = utterance.speaker?.trim() || null;
    if (speaker && !numbers.has(speaker)) numbers.set(speaker, numbers.size + 1);
    const last = lines.at(-1);
    if (last && last.speaker === speaker) last.text = `${last.text} ${text}`;
    else lines.push({ speaker, text });
  }
  return {
    text: lines
      .map((line) =>
        line.speaker
          ? `Speaker ${numbers.get(line.speaker)}: ${line.text}`
          : line.text,
      )
      .join("\n"),
    speakerCount: numbers.size,
  };
}

/** "1 hour 12 minutes", "48 minutes", "Less than a minute". Never abbreviated. */
export function meetingRecordingLengthLabel(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "Less than a minute";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = hours === 0 ? "" : hours === 1 ? "1 hour" : `${hours} hours`;
  const minutePart =
    rest === 0 ? "" : rest === 1 ? "1 minute" : `${rest} minutes`;
  return [hourPart, minutePart].filter(Boolean).join(" ");
}
