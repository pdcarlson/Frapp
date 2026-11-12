import { describe, expect, it } from "vitest";
import {
  MAX_MEETING_RECORDING_BYTES,
  MAX_MEETING_RECORDING_SECONDS,
  MEETING_RECORDER_COPY,
  MEETING_RECORDER_FILE_NAME,
  MEETING_RECORDER_FORMAT,
  MEETING_RECORDER_KEEP_DAYS,
  MEETING_RECORDER_NOTICE,
  MEETING_RECORDER_STOP_FREE_BYTES,
  meetingRecorderBytes,
  meetingRecorderClock,
  meetingRecorderSeconds,
  meetingRecorderSpaceNeeded,
  MEETING_RECORDING_ACCEPT,
  MEETING_RECORDING_FAILURES,
  MEETING_RECORDING_FAILURE_COPY,
  MEETING_RECORDING_MIME_TYPES,
  MEETING_RECORDING_NOTICE,
  MEETING_RECORDING_NOTIFICATION,
  formatMeetingTranscript,
  isMeetingRecordingFailure,
  meetingRecordingExtension,
  meetingRecordingLengthLabel,
  meetingRecordingMimeType,
} from "./meeting-recording";
import { MEETING_NOTES_MAX_LENGTH } from "./meeting-draft";

describe("meetingRecordingMimeType", () => {
  it("takes what phones record, under each browser's name for it", () => {
    // iPhone Voice Memos: Safari and Chrome name the same file differently.
    expect(meetingRecordingMimeType("New Recording 4.m4a", "audio/x-m4a")).toBe(
      "audio/x-m4a",
    );
    expect(meetingRecordingMimeType("New Recording 4.m4a", "audio/mp4")).toBe(
      "audio/mp4",
    );
    expect(meetingRecordingMimeType("meeting.MP3", "audio/mpeg; x=1")).toBe(
      "audio/mpeg",
    );
  });

  it("reads the extension when the browser names no type", () => {
    expect(meetingRecordingMimeType("chapter.m4a", "")).toBe("audio/mp4");
    expect(meetingRecordingMimeType("chapter.WAV", null)).toBe("audio/wav");
    expect(
      meetingRecordingMimeType("chapter.flac", "application/octet-stream"),
    ).toBe("audio/flac");
  });

  it("refuses video, documents and files with no sign of being audio", () => {
    expect(meetingRecordingMimeType("meeting.mov", "video/quicktime")).toBeNull();
    // Named as a video, whatever the extension says.
    expect(meetingRecordingMimeType("meeting.m4a", "video/mp4")).toBeNull();
    expect(meetingRecordingMimeType("minutes.pdf", "application/pdf")).toBeNull();
    expect(meetingRecordingMimeType("recording", "")).toBeNull();
    expect(meetingRecordingMimeType("recording.amr", "audio/amr")).toBeNull();
  });

  it("stores every type under an extension, and offers every one in the picker", () => {
    for (const type of MEETING_RECORDING_MIME_TYPES) {
      expect(meetingRecordingExtension(type)).not.toBe("bin");
      expect(MEETING_RECORDING_ACCEPT.split(",")).toContain(type);
    }
    expect(MEETING_RECORDING_ACCEPT.split(",")).toContain(".m4a");
    expect(meetingRecordingExtension("text/plain")).toBe("bin");
  });
});

describe("formatMeetingTranscript", () => {
  it("numbers speakers in the order first heard, whatever the provider called them", () => {
    expect(
      formatMeetingTranscript([
        { speaker: "spk_7", text: "Call to order." },
        { speaker: "spk_2", text: "Treasurer   report.\n" },
        { speaker: "spk_7", text: "Thank you." },
      ]),
    ).toEqual({
      text: "Speaker 1: Call to order.\nSpeaker 2: Treasurer report.\nSpeaker 1: Thank you.",
      speakerCount: 2,
    });
  });

  it("joins consecutive stretches by one speaker, and drops empty ones", () => {
    expect(
      formatMeetingTranscript([
        { speaker: "A", text: "First." },
        { speaker: "A", text: "  " },
        { speaker: "A", text: "Second." },
      ]).text,
    ).toBe("Speaker 1: First. Second.");
  });

  it("writes plain lines when the provider labelled nobody", () => {
    expect(
      formatMeetingTranscript([{ speaker: null, text: "All one voice." }]),
    ).toEqual({ text: "All one voice.", speakerCount: 0 });
    expect(formatMeetingTranscript([])).toEqual({ text: "", speakerCount: 0 });
  });
});

describe("recording copy", () => {
  it("says every failure in plain words, with no code", () => {
    for (const failure of MEETING_RECORDING_FAILURES) {
      const copy = MEETING_RECORDING_FAILURE_COPY[failure];
      expect(copy.length).toBeGreaterThan(20);
      expect(copy).not.toMatch(/_|\bAPI\b|\berror\b/i);
      expect(isMeetingRecordingFailure(failure)).toBe(true);
    }
    expect(isMeetingRecordingFailure("nope")).toBe(false);
    expect(isMeetingRecordingFailure(null)).toBe(false);
  });

  it("writes lengths out in full", () => {
    expect(meetingRecordingLengthLabel(4320)).toBe("1 hour 12 minutes");
    expect(meetingRecordingLengthLabel(7200)).toBe("2 hours");
    expect(meetingRecordingLengthLabel(2880)).toBe("48 minutes");
    expect(meetingRecordingLengthLabel(60)).toBe("1 minute");
    expect(meetingRecordingLengthLabel(12)).toBe("Less than a minute");
  });

  it("tells attendees what was uploaded and that it is deleted, naming the meeting", () => {
    const body = MEETING_RECORDING_NOTIFICATION.body("Chapter meeting");
    expect(body).toContain("Chapter meeting");
    expect(body).toContain("deleted");
    expect(MEETING_RECORDING_NOTICE.whatHappens).toContain("AI provider");
    expect(MEETING_RECORDING_NOTICE.standards).toContain("Standards");
  });

  it("leaves room in the notes box for a two-hour transcript", () => {
    // About 150 words a minute, six characters a word, for two hours.
    expect(MEETING_NOTES_MAX_LENGTH).toBeGreaterThanOrEqual(120 * 150 * 6);
    expect(MAX_MEETING_RECORDING_BYTES).toBe(200 * 1024 * 1024);
  });
});

describe("the phone's recorder", () => {
  it("records a format the upload takes as it is", () => {
    expect(
      meetingRecordingMimeType(
        MEETING_RECORDER_FILE_NAME,
        MEETING_RECORDER_FORMAT.mimeType,
      ),
    ).toBe("audio/aac");
    expect(MEETING_RECORDER_FILE_NAME.endsWith(MEETING_RECORDER_FORMAT.extension)).toBe(
      true,
    );
    expect(MEETING_RECORDER_FORMAT.channels).toBe(1);
  });

  it("keeps the longest meeting well under the size the server takes", () => {
    const longest = meetingRecorderBytes(MAX_MEETING_RECORDING_SECONDS);
    expect(longest).toBe(57_600_000);
    expect(longest).toBeLessThan(MAX_MEETING_RECORDING_BYTES / 2);
  });

  it("measures a recording cut short by its size", () => {
    expect(meetingRecorderSeconds(meetingRecorderBytes(5400))).toBe(5400);
    expect(meetingRecorderSeconds(0)).toBe(0);
    expect(meetingRecorderSeconds(-5)).toBe(0);
  });

  it("asks for room for the whole meeting and some to spare, and stops well before the disk is full", () => {
    const needed = meetingRecorderSpaceNeeded(MAX_MEETING_RECORDING_SECONDS);
    expect(needed).toBeGreaterThan(meetingRecorderBytes(MAX_MEETING_RECORDING_SECONDS));
    expect(needed).toBeLessThan(150 * 1024 * 1024);
    expect(MEETING_RECORDER_STOP_FREE_BYTES).toBeGreaterThan(
      meetingRecorderBytes(15 * 60),
    );
    expect(MEETING_RECORDER_KEEP_DAYS).toBe(7);
  });

  it("writes the clock without abbreviating it", () => {
    expect(meetingRecorderClock(0)).toBe("0:00");
    expect(meetingRecorderClock(7.9)).toBe("0:07");
    expect(meetingRecorderClock(725)).toBe("12:05");
    expect(meetingRecorderClock(3753)).toBe("1:02:33");
    expect(meetingRecorderClock(-3)).toBe("0:00");
  });

  it("says the upload step's rule and script before recording, in the present tense", () => {
    expect(MEETING_RECORDER_NOTICE.rule).toBe(MEETING_RECORDING_NOTICE.rule);
    expect(MEETING_RECORDER_NOTICE.script).toBe(MEETING_RECORDING_NOTICE.script);
    expect(MEETING_RECORDER_NOTICE.confirmLabel).toContain("has been told");
    expect(MEETING_RECORDER_NOTICE.whatHappens).toContain("deleted from this phone");
    expect(MEETING_RECORDER_NOTICE.standards).toContain("Standards");
    expect(MEETING_RECORDER_NOTICE.limit(7200)).toContain("Up to 2 hours");
  });

  it("says each state in whole words: no emoji, no abbreviations, no internals", () => {
    const lines = Object.values(MEETING_RECORDER_COPY).map((value) =>
      typeof value === "function"
        ? (value as (a: never, b: never) => string)(
            1_048_576 as never,
            (28 * 1_048_576) as never,
          )
        : value,
    );
    for (const line of lines) {
      expect(line).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(line).not.toMatch(/\b(mins?|secs?|hrs?|tmrw|ADTS|TUS|upload_id)\b/i);
      expect(line).not.toContain("undefined");
    }
    expect(MEETING_RECORDER_COPY.uploading(14 * 1_048_576, 28 * 1_048_576)).toBe(
      "Uploading the recording: 50% of 28 MB. Keep Frapp open until it finishes.",
    );
    expect(MEETING_RECORDER_COPY.uploading(0, 0)).toContain("0%");
    expect(MEETING_RECORDER_COPY.kept(4320)).toBe(
      "A recording of 1 hour 12 minutes is on this phone, not yet uploaded.",
    );
    expect(MEETING_RECORDER_COPY.lowStorage(122 * 1_048_576)).toContain("122 MB");
  });
});
