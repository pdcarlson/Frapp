import { describe, expect, it } from "vitest";
import {
  IDLE,
  isRecorderLive,
  recorderMeetingId,
  recorderReducer,
  type RecorderEvent,
  type RecorderState,
  type RecordingSubject,
} from "./machine";

/**
 * The recorder's transitions (`spec/behavior/meetings.md` § Recording in the
 * app). What these pin is that no order of events loses a recording: every
 * way out of `recording` other than a too-short one lands in `kept`, and a
 * late or repeated event changes nothing.
 */
const subject: RecordingSubject = {
  meetingId: "meeting-1",
  eventName: "Chapter meeting",
  maxSeconds: 7200,
};

const run = (events: RecorderEvent[], from: RecorderState = IDLE) =>
  events.reduce(recorderReducer, from);

const recording = (seconds = 0): RecorderState =>
  run([
    { type: "start_requested", subject },
    { type: "started" },
    { type: "tick", seconds, isRecording: true },
  ]);

const kept = (): RecorderState =>
  run(
    [
      { type: "stop_requested" },
      { type: "saved", seconds: 3600, bytes: 28_800_000, reason: "stopped" },
    ],
    recording(3600),
  );

describe("recorderReducer", () => {
  it("walks a whole meeting: start, record, stop, upload, done", () => {
    let state = run([{ type: "start_requested", subject }]);
    expect(state).toEqual({ phase: "starting", subject });
    state = run([{ type: "started" }], state);
    expect(state).toEqual({
      phase: "recording",
      subject,
      seconds: 0,
      paused: null,
    });
    state = run([{ type: "tick", seconds: 3600.4, isRecording: true }], state);
    expect(state).toMatchObject({ seconds: 3600, paused: null });
    state = run([{ type: "stop_requested" }], state);
    expect(state).toEqual({ phase: "saving", subject, seconds: 3600 });
    state = run(
      [{ type: "saved", seconds: 3601, bytes: 100, reason: "stopped" }],
      state,
    );
    expect(state).toEqual({
      phase: "kept",
      subject,
      seconds: 3601,
      bytes: 100,
      reason: "stopped",
      message: null,
    });
    state = run([{ type: "upload_started", total: 100 }], state);
    expect(state).toMatchObject({ phase: "uploading", sent: 0, total: 100 });
    state = run([{ type: "upload_progress", sent: 60, total: 100 }], state);
    expect(state).toMatchObject({ sent: 60 });
    expect(run([{ type: "uploaded" }], state)).toBe(IDLE);
  });

  it("refuses a start with the reason, for the meeting it was asked on", () => {
    const state = run([
      { type: "start_requested", subject },
      { type: "start_refused", kind: "low_storage", neededBytes: 5 },
    ]);
    expect(state).toEqual({
      phase: "idle",
      refusal: { kind: "low_storage", meetingId: "meeting-1", neededBytes: 5 },
    });
    expect(run([{ type: "refusal_cleared" }], state)).toBe(IDLE);
  });

  it("holds one recording: a second start changes nothing", () => {
    const state = recording(10);
    const other = { ...subject, meetingId: "meeting-2" };
    expect(run([{ type: "start_requested", subject: other }], state)).toBe(
      state,
    );
    expect(run([{ type: "start_requested", subject: other }], kept())).toEqual(
      kept(),
    );
  });

  it("shows a call taking the microphone as a pause, and its return as recording", () => {
    let state = recording(120);
    state = run([{ type: "tick", seconds: 121, isRecording: false }], state);
    expect(state).toMatchObject({ seconds: 121, paused: "interrupted" });
    state = run([{ type: "tick", seconds: 121, isRecording: true }], state);
    expect(state).toMatchObject({ paused: null });
  });

  it("keeps the officer's own pause until they resume", () => {
    let state = run([{ type: "paused" }], recording(30));
    expect(state).toMatchObject({ paused: "user" });
    // A recorder that reports recording again doesn't undo their pause.
    state = run([{ type: "tick", seconds: 30, isRecording: true }], state);
    expect(state).toMatchObject({ paused: "user" });
    expect(run([{ type: "resumed" }], state)).toMatchObject({ paused: null });
  });

  it("never runs the clock backwards", () => {
    const state = run(
      [{ type: "tick", seconds: 0, isRecording: true }],
      recording(500),
    );
    expect(state).toMatchObject({ seconds: 500 });
  });

  it("returns the same state for a tick that changes nothing", () => {
    const state = recording(40);
    expect(
      run([{ type: "tick", seconds: 40.9, isRecording: true }], state),
    ).toBe(state);
  });

  it("ignores a tick, a pause and a second stop once Stop was tapped", () => {
    const saving = run([{ type: "stop_requested" }], recording(90));
    for (const event of [
      { type: "tick", seconds: 0, isRecording: false },
      { type: "paused" },
      { type: "resumed" },
      { type: "stop_requested" },
      { type: "started" },
    ] satisfies RecorderEvent[]) {
      expect(run([event], saving)).toBe(saving);
    }
  });

  it("ends a too-short recording with nothing kept, and says why", () => {
    const state = run(
      [{ type: "stop_requested" }, { type: "too_short" }],
      recording(3),
    );
    expect(state).toEqual({
      phase: "idle",
      refusal: { kind: "too_short", meetingId: "meeting-1" },
    });
  });

  it.each(["upload_failed", "upload_refused", "upload_cancelled"] as const)(
    "goes back to kept when an upload ends as %s",
    (reason) => {
      const state = run(
        [
          { type: "upload_started", total: 900 },
          { type: "upload_progress", sent: 300, total: 900 },
          { type: "upload_ended", reason, message: "Said by the server." },
        ],
        kept(),
      );
      expect(state).toEqual({
        phase: "kept",
        subject,
        seconds: 3600,
        bytes: 900,
        reason,
        message: "Said by the server.",
      });
    },
  );

  it("never shows less sent than before, or more than the whole file", () => {
    const uploading = run([{ type: "upload_started", total: 900 }], kept());
    let state = run(
      [{ type: "upload_progress", sent: 600, total: 900 }],
      uploading,
    );
    state = run([{ type: "upload_progress", sent: 200, total: 900 }], state);
    expect(state).toMatchObject({ sent: 600 });
    state = run([{ type: "upload_progress", sent: 5000, total: 900 }], state);
    expect(state).toMatchObject({ sent: 900 });
  });

  it("only Delete, or the server having it, empties a kept recording", () => {
    const state = kept();
    for (const event of [
      { type: "uploaded" },
      { type: "too_short" },
      { type: "started" },
      { type: "refusal_cleared" },
      { type: "start_refused", kind: "start_failed" },
    ] satisfies RecorderEvent[]) {
      expect(run([event], state)).toBe(state);
    }
    expect(run([{ type: "discarded" }], state)).toBe(IDLE);
    // And not while it is being sent.
    const uploading = run([{ type: "upload_started", total: 1 }], state);
    expect(run([{ type: "discarded" }], uploading)).toBe(uploading);
  });

  it("finds a recording a closed app left behind", () => {
    const state = run([
      {
        type: "recovered",
        subject,
        seconds: 5400.7,
        bytes: 43_000_000,
        reason: "recovered",
      },
    ]);
    expect(state).toMatchObject({
      phase: "kept",
      seconds: 5400,
      reason: "recovered",
    });
    // Not over a recording already under way.
    const live = recording(5);
    expect(
      run(
        [{ type: "recovered", subject, seconds: 1, bytes: 1, reason: "stopped" }],
        live,
      ),
    ).toBe(live);
  });

  it("says a file is lost, but never while the microphone is open", () => {
    expect(run([{ type: "lost", meetingId: "meeting-1" }], kept())).toEqual({
      phase: "idle",
      refusal: { kind: "lost", meetingId: "meeting-1" },
    });
    const live = recording(5);
    expect(run([{ type: "lost", meetingId: "meeting-1" }], live)).toBe(live);
  });
});

describe("recorder helpers", () => {
  it("names the meeting the phone is busy with", () => {
    expect(recorderMeetingId(IDLE)).toBeNull();
    expect(recorderMeetingId(recording())).toBe("meeting-1");
    expect(recorderMeetingId(kept())).toBe("meeting-1");
  });

  it("is live from the tap on Start until the file is closed", () => {
    expect(isRecorderLive(IDLE)).toBe(false);
    expect(isRecorderLive(run([{ type: "start_requested", subject }]))).toBe(
      true,
    );
    expect(isRecorderLive(recording())).toBe(true);
    expect(isRecorderLive(run([{ type: "stop_requested" }], recording()))).toBe(
      true,
    );
    expect(isRecorderLive(kept())).toBe(false);
  });
});
