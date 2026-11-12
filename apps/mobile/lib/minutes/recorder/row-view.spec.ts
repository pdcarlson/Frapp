import { describe, expect, it } from "vitest";
import { MEETING_RECORDER_COPY } from "@repo/validation";
import { IDLE, type RecorderState, type RecordingSubject } from "./machine";
import {
  recordingBarView,
  recordingRowView,
  type ServerRecording,
} from "./row-view";

/**
 * What the recording row and the bar say in each state. The officer reads
 * this from across a table, so each state has one plain line and at most two
 * buttons, and a recording that isn't being written never reads as one that
 * is.
 */
const subject: RecordingSubject = {
  meetingId: "meeting-1",
  eventName: "Chapter meeting",
  maxSeconds: 7200,
};
const none: ServerRecording = {
  status: "none",
  duration_seconds: null,
  failure_message: null,
  transcript: null,
};
const view = (local: RecorderState, server: ServerRecording = none) =>
  recordingRowView("meeting-1", local, server);
const does = (local: RecorderState, server: ServerRecording = none) => {
  const row = view(local, server);
  return [row.primary?.does ?? null, row.secondary?.does ?? null];
};

describe("recordingRowView", () => {
  it("offers Record when nothing has been recorded", () => {
    const row = view(IDLE);
    expect(row.text).toBe(MEETING_RECORDER_COPY.offer);
    expect(row.primary).toEqual({
      label: MEETING_RECORDER_COPY.record,
      does: "record",
    });
    expect(row.dot).toBeNull();
  });

  it("shows a live dot, the clock, Stop and Pause while recording", () => {
    const row = view({
      phase: "recording",
      subject,
      seconds: 3723,
      paused: null,
    });
    expect(row).toMatchObject({
      title: "Recording",
      dot: "live",
      clock: "1:02:03",
      tone: "quiet",
    });
    expect(does({ phase: "recording", subject, seconds: 1, paused: null })).toEqual([
      "stop",
      "pause",
    ]);
  });

  it("says Paused, never Recording, when the officer paused", () => {
    const row = view({ phase: "recording", subject, seconds: 60, paused: "user" });
    expect(row).toMatchObject({
      title: "Paused",
      dot: "paused",
      text: MEETING_RECORDER_COPY.pausedHint,
      tone: "quiet",
    });
    expect([row.primary?.does, row.secondary?.does]).toEqual(["resume", "stop"]);
  });

  it("says a call took the microphone, as a problem", () => {
    const row = view({
      phase: "recording",
      subject,
      seconds: 60,
      paused: "interrupted",
    });
    expect(row).toMatchObject({
      title: "Paused",
      text: MEETING_RECORDER_COPY.interruptedHint,
      tone: "problem",
    });
  });

  it("offers nothing to press while the microphone opens or the file closes", () => {
    expect(does({ phase: "starting", subject })).toEqual([null, null]);
    expect(does({ phase: "saving", subject, seconds: 9 })).toEqual([null, null]);
  });

  it("shows the upload's real progress and a Cancel", () => {
    const row = view({
      phase: "uploading",
      subject,
      seconds: 3600,
      sent: 14 * 1024 * 1024,
      total: 28 * 1024 * 1024,
    });
    expect(row.progress).toBe(0.5);
    expect(row.text).toContain("50% of 28 MB");
    expect(row.primary?.does).toBe("cancel_upload");
  });

  it.each([
    ["stopped", MEETING_RECORDER_COPY.kept(3600), "quiet", "Upload"],
    ["recovered", MEETING_RECORDER_COPY.recovered(3600), "quiet", "Upload"],
    ["max_reached", MEETING_RECORDER_COPY.maxReached(7200), "quiet", "Upload"],
    ["storage", MEETING_RECORDER_COPY.storageStopped, "problem", "Upload"],
    ["outside", MEETING_RECORDER_COPY.stoppedOutside, "quiet", "Upload"],
    ["upload_failed", MEETING_RECORDER_COPY.uploadFailed, "problem", "Try again"],
    ["upload_cancelled", MEETING_RECORDER_COPY.kept(3600), "quiet", "Upload"],
  ] as const)(
    "a kept recording (%s) says why it is here and offers to send or delete it",
    (reason, text, tone, label) => {
      const row = view({
        phase: "kept",
        subject,
        seconds: 3600,
        bytes: 1,
        reason,
        message: null,
      });
      expect(row).toMatchObject({ text, tone });
      expect(row.primary).toEqual({ label, does: "upload" });
      expect(row.secondary?.does).toBe("delete");
    },
  );

  it("uses the server's own words for a refused upload when it gave any", () => {
    const kept = {
      phase: "kept",
      subject,
      seconds: 3600,
      bytes: 1,
      reason: "upload_refused",
    } as const;
    expect(view({ ...kept, message: "AI is off for this chapter." }).text).toBe(
      "AI is off for this chapter.",
    );
    expect(view({ ...kept, message: null }).text).toBe(
      MEETING_RECORDER_COPY.uploadRefused,
    );
  });

  it("points at the other meeting when the phone holds its recording", () => {
    const row = recordingRowView(
      "meeting-2",
      { phase: "recording", subject, seconds: 5, paused: null },
      none,
    );
    expect(row.text).toBe(MEETING_RECORDER_COPY.elsewhere("Chapter meeting"));
    expect(row.primary?.does).toBe("open_other");
    expect(row.dot).toBeNull();
  });

  it.each([
    ["microphone_denied", ["open_settings", "record"]],
    ["notifications_denied", ["open_settings", "record"]],
    ["low_storage", ["record", null]],
    ["too_short", ["record", null]],
    ["lost", ["record", null]],
    ["start_failed", ["record", null]],
  ] as const)("a refusal (%s) says why and offers the way on", (kind, buttons) => {
    const state: RecorderState = {
      phase: "idle",
      refusal: { kind, meetingId: "meeting-1", neededBytes: 130 * 1024 * 1024 },
    };
    expect(does(state)).toEqual(buttons);
    expect(view(state).text.length).toBeGreaterThan(20);
  });

  it("shows another meeting's refusal nowhere but on that meeting", () => {
    const state: RecorderState = {
      phase: "idle",
      refusal: { kind: "microphone_denied", meetingId: "meeting-2" },
    };
    expect(view(state).text).toBe(MEETING_RECORDER_COPY.offer);
  });

  it("follows the server once the phone holds nothing", () => {
    expect(does(IDLE, { ...none, status: "uploading" })).toEqual([null, null]);
    expect(view(IDLE, { ...none, status: "uploading" }).text).toBe(
      MEETING_RECORDER_COPY.otherDevice,
    );
    expect(
      does(IDLE, { ...none, status: "transcribing", duration_seconds: 3600 }),
    ).toEqual(["stop_transcribing", null]);
    expect(
      does(IDLE, {
        ...none,
        status: "ready",
        duration_seconds: 3600,
        transcript: "Speaker 1: Call to order.",
      }),
    ).toEqual(["open_notes", "record"]);
    const failed = view(IDLE, {
      ...none,
      status: "failed",
      failure_message: "No speech could be heard in that recording.",
    });
    expect(failed).toMatchObject({
      tone: "problem",
      text: "No speech could be heard in that recording.",
    });
    expect(failed.primary?.does).toBe("record");
  });

  it("puts the phone's own recording ahead of what the server remembers", () => {
    const row = view(
      { phase: "recording", subject, seconds: 5, paused: null },
      { ...none, status: "ready", transcript: "Old transcript." },
    );
    expect(row.title).toBe("Recording");
  });
});

describe("recordingBarView", () => {
  it("is absent when the phone holds nothing", () => {
    expect(recordingBarView(IDLE)).toBeNull();
    expect(
      recordingBarView({
        phase: "idle",
        refusal: { kind: "lost", meetingId: "meeting-1" },
      }),
    ).toBeNull();
  });

  it("says Recording with the clock, and names the meeting to a screen reader", () => {
    expect(
      recordingBarView({ phase: "recording", subject, seconds: 65, paused: null }),
    ).toEqual({
      label: "Recording 1:05",
      description: "Recording Chapter meeting",
      dot: "live",
    });
  });

  it("says Paused when nothing is being recorded", () => {
    expect(
      recordingBarView({
        phase: "recording",
        subject,
        seconds: 65,
        paused: "interrupted",
      }),
    ).toMatchObject({ label: "Paused 1:05", dot: "paused" });
  });

  it("stays up for an upload and for a recording not yet sent", () => {
    expect(
      recordingBarView({
        phase: "uploading",
        subject,
        seconds: 9,
        sent: 1,
        total: 4,
      }),
    ).toMatchObject({ label: "Uploading 25%", dot: "kept" });
    expect(
      recordingBarView({
        phase: "kept",
        subject,
        seconds: 9,
        bytes: 4,
        reason: "upload_failed",
        message: null,
      }),
    ).toMatchObject({ label: MEETING_RECORDER_COPY.barKept, dot: "kept" });
  });
});
