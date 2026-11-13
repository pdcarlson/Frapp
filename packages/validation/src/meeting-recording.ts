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
  /** The officer has not turned Frapp AI on. */
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
    "Turn on Frapp AI to transcribe the recording.",
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

// ── Recording a meeting in the app (the phone's recorder) ───────────────────

/**
 * What the phone's recorder makes (`spec/behavior/meetings.md` § Recording in
 * the app): one voice channel of AAC at a rate every phone's encoder takes,
 * so two hours is about 58 MB, well under `MAX_MEETING_RECORDING_BYTES`.
 *
 * The container is ADTS (`.aac`), not MPEG-4 (`.m4a`). An MPEG-4 file is
 * unreadable until the recorder closes it, so a phone that dies ninety
 * minutes into a meeting would leave nothing; an ADTS file is a run of
 * self-contained frames, and whatever was written before the app died plays.
 */
export const MEETING_RECORDER_FORMAT = {
  extension: "aac",
  mimeType: "audio/aac",
  sampleRate: 44_100,
  channels: 1,
  bitRate: 64_000,
} as const;

/** The name the recording carries to the server and shows on the web. */
export const MEETING_RECORDER_FILE_NAME = "Recorded in Frapp.aac";

/** About how large a recording of this length is. */
export function meetingRecorderBytes(seconds: number): number {
  return Math.ceil((Math.max(0, seconds) * MEETING_RECORDER_FORMAT.bitRate) / 8);
}

/**
 * About how long a recording of this size is: what a recording cut short by
 * the app closing is taken to be, since an ADTS file states no length.
 */
export function meetingRecorderSeconds(bytes: number): number {
  return Math.floor((Math.max(0, bytes) * 8) / MEETING_RECORDER_FORMAT.bitRate);
}

const MEGABYTE = 1024 * 1024;

/**
 * The free space a phone needs before recording starts: the longest
 * recording, a quarter again, and room for the phone itself to keep working.
 */
export function meetingRecorderSpaceNeeded(maxSeconds: number): number {
  return Math.ceil(meetingRecorderBytes(maxSeconds) * 1.25) + 50 * MEGABYTE;
}

/** Below this much free space a recording under way stops and is kept. */
export const MEETING_RECORDER_STOP_FREE_BYTES = 25 * MEGABYTE;

/** A recording left on the phone this long is deleted from it, unsent. */
export const MEETING_RECORDER_KEEP_DAYS = 7;

/** "0:07", "12:05", "1:02:33": the recorder's clock. */
export function meetingRecorderClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}`
    : `${minutes}:${rest}`;
}

/**
 * The notice the phone shows before it records (`meetings.md` § Recording
 * notice). The rule, the script and the Standards line are the upload
 * step's; only what is in another tense is said again, because here the room
 * is told now, not afterwards.
 */
export const MEETING_RECORDER_NOTICE = {
  heading: "Before you record",
  rule: MEETING_RECORDING_NOTICE.rule,
  scriptLabel: "Read this out before you start",
  script: MEETING_RECORDING_NOTICE.script,
  confirmLabel:
    "Everyone in the room has been told this meeting is being recorded, and nobody objected.",
  whatHappens:
    "Frapp records until you tap Stop, with the screen locked or not. The recording then goes to an AI provider to be written out as text. It is deleted from this phone once it is uploaded and from Frapp as soon as the transcript is written, and Frapp tells the members who were at the meeting.",
  standards:
    "Never record a Standards hearing. Those minutes are written by hand.",
  unconfirmed: "Tell the room first. If anyone objects, don't record.",
  start: "Start recording",
  limit: (maxSeconds: number) =>
    `Up to ${meetingRecordingLengthLabel(maxSeconds).toLowerCase()}. Keep the phone on the table, near whoever is speaking.`,
} as const;

/** "1 hour 12 minutes" inside a sentence. */
function lengthInWords(seconds: number): string {
  return meetingRecordingLengthLabel(seconds).toLowerCase();
}

/** "58 MB" or "640 KB", for the upload line. */
function sizeLabel(bytes: number): string {
  return bytes >= MEGABYTE
    ? `${Math.round(bytes / MEGABYTE)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Every line the phone's recorder says. One row on the minutes screen holds
 * them, so each fits in three lines of caption.
 */
export const MEETING_RECORDER_COPY = {
  record: "Record the meeting",
  offer:
    "Set the phone on the table and record. Frapp writes it out as your notes.",
  checking: "Getting the microphone ready",
  recording: "Recording",
  recordingHint:
    "Frapp keeps recording with the screen locked. Tap Stop when the meeting ends.",
  paused: "Paused",
  pausedHint: "Nothing is being recorded. Tap Resume to carry on.",
  interruptedHint:
    "A call or another app took the microphone, so nothing is being recorded. Tap Resume to carry on.",
  pause: "Pause",
  resume: "Resume",
  stop: "Stop",
  stopTitle: "Stop recording?",
  stopBody: "The recording is uploaded and written out as your notes.",
  saving: "Saving the recording",
  uploading: (sentBytes: number, totalBytes: number) =>
    `Uploading the recording: ${totalBytes > 0 ? Math.floor((sentBytes / totalBytes) * 100) : 0}% of ${sizeLabel(totalBytes)}. Keep Frapp open until it finishes.`,
  upload: "Upload",
  tryAgain: "Try again",
  cancel: "Cancel",
  delete: "Delete",
  deleteTitle: "Delete the recording?",
  deleteBody:
    "It is removed from this phone and nothing is transcribed. This can't be undone.",
  kept: (seconds: number) =>
    `A recording of ${lengthInWords(seconds)} is on this phone, not yet uploaded.`,
  recovered: (seconds: number) =>
    `Frapp closed while it was recording. About ${lengthInWords(seconds)} was kept on this phone.`,
  uploadFailed:
    "The connection dropped and the upload didn't finish. The recording is safe on this phone.",
  uploadRefused:
    "The upload was refused. The recording is safe on this phone. Try again.",
  maxReached: (maxSeconds: number) =>
    `Recording stopped at ${lengthInWords(maxSeconds)}, the longest Frapp takes.`,
  storageStopped:
    "This phone ran out of space, so recording stopped. What was recorded is kept.",
  stoppedOutside: "Recording was stopped from outside Frapp. What was recorded is kept.",
  tooShort: `That recording is shorter than ${MIN_MEETING_RECORDING_SECONDS} seconds, so there is nothing to transcribe.`,
  microphoneDenied:
    "Frapp can't use the microphone. Allow it in Settings, then record.",
  notificationsDenied:
    "Android keeps a recording going with the screen off only while Frapp shows a notification. Allow notifications in Settings, then record.",
  openSettings: "Open Settings",
  lowStorage: (neededBytes: number) =>
    `This phone needs about ${sizeLabel(neededBytes)} free to record a meeting. Free some space, then record.`,
  startFailed: "The recording couldn't start. Close other apps using the microphone and try again.",
  lost: "The recording could no longer be found on this phone.",
  elsewhere: (eventName: string) =>
    `This phone holds a recording of ${eventName}. Finish that one first.`,
  openElsewhere: "Open it",
  otherDevice:
    "A recording is being uploaded from another device. It shows here once it arrives.",
  transcribing: (seconds: number) =>
    `Transcribing ${lengthInWords(seconds)} of audio. This takes a few minutes, and you can leave.`,
  stopTranscribing: "Stop",
  stopTranscribingTitle: "Stop transcribing?",
  stopTranscribingBody: "The recording is removed. Nothing is written out.",
  ready: (seconds: number) =>
    `The transcript is ready (${lengthInWords(seconds)}), and the recording has been deleted. Speakers are numbered, not named.`,
  openNotes: "Open your notes",
  recordAgain: "Record again",
  replaceTitle: "Record again?",
  replaceBody:
    "The earlier transcript is removed. What is already in your notes stays.",
  addTranscript: "Add the transcript",
  /** The bar shown on every other screen while the phone records. */
  bar: (eventName: string) => `Recording ${eventName}`,
  barPaused: (eventName: string) => `Recording paused: ${eventName}`,
  barUploading: (sentBytes: number, totalBytes: number) =>
    `Uploading ${totalBytes > 0 ? Math.floor((sentBytes / totalBytes) * 100) : 0}%`,
  barUploadingFull: (eventName: string) =>
    `Uploading the recording of ${eventName}. Keep Frapp open until it finishes.`,
  barKept: "Recording not uploaded",
  barKeptFull: (eventName: string) =>
    `The recording of ${eventName} is on this phone and hasn't been uploaded.`,
  barHint: "Opens the minutes this recording is for.",
} as const;
