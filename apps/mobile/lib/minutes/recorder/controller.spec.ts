import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ResumableUploadError,
  type uploadResumable,
} from "@repo/hooks/resumable-upload";
import {
  MEETING_RECORDER_KEEP_DAYS,
  MEETING_RECORDER_STOP_FREE_BYTES,
  meetingRecorderBytes,
} from "@repo/validation";
import {
  MeetingRecorderController,
  type RecorderApi,
  type RecorderDevice,
  type RecorderStore,
  type StoredRecording,
} from "./controller";
import type { RecordingSubject } from "./machine";

/**
 * The recorder walked through a secretary's evening without a phone
 * (`spec/behavior/meetings.md` § Recording in the app): a whole meeting, a
 * call in the middle of it, a full disk, an app that dies, and wifi that
 * drops during the upload. The rule under all of them: the audio leaves the
 * phone only when the server has it or the officer deletes it.
 */
const subject: RecordingSubject = {
  meetingId: "meeting-1",
  eventName: "Chapter meeting",
  maxSeconds: 7200,
};
const identity = { userId: "user-1", chapterId: "chapter-1" };
const URI = "file:///documents/ExpoAudio/recording-1.aac";
const GIGABYTE = 1024 * 1024 * 1024;

function harness(stored: StoredRecording | null = null) {
  const files = new Map<string, number>();
  const phone = {
    microphone: "granted" as "granted" | "denied",
    background: true,
    free: 4 * GIGABYTE as number | null,
    recorder: null as { isRecording: boolean; seconds: number } | null,
    ended: null as (() => void) | null,
    beginFails: false,
    purged: [] as string[][],
  };
  const device: RecorderDevice = {
    microphone: async () => phone.microphone,
    backgroundAllowed: async () => phone.background,
    freeBytes: () => phone.free,
    begin: async () => {
      if (phone.beginFails) throw new Error("no microphone");
      phone.recorder = { isRecording: true, seconds: 0 };
      files.set(URI, 0);
      return { uri: URI };
    },
    pause: () => {
      if (phone.recorder) phone.recorder.isRecording = false;
    },
    resume: () => {
      if (phone.recorder) phone.recorder.isRecording = true;
    },
    status: () => (phone.recorder ? { ...phone.recorder } : null),
    finish: vi.fn(async () => {
      phone.recorder = null;
    }),
    onEnded: (listener) => {
      phone.ended = listener;
      return () => {
        phone.ended = null;
      };
    },
    locate: (uri) => (files.has(uri) ? uri : null),
    fileSize: (uri) => files.get(uri) || null,
    remove: (uri) => void files.delete(uri),
    source: (_uri, size) => ({ size, read: () => "" }),
    purge: (keep) => void phone.purged.push([...keep]),
  };

  const keyOf = (who: { userId: string; chapterId: string }) =>
    `${who.userId}:${who.chapterId}`;
  const rows = new Map<string, StoredRecording>();
  if (stored) rows.set(keyOf(stored), stored);
  const disk = {
    rows,
    /** The phone's storage can't be read. */
    failing: false,
    /** What is written down for the member and chapter under test. */
    get value() {
      return rows.get(keyOf(identity)) ?? null;
    },
  };
  const store: RecorderStore = {
    all: async () => {
      if (disk.failing) throw new Error("storage unavailable");
      return [...rows.values()];
    },
    save: async (recording) => {
      rows.set(keyOf(recording), recording);
    },
    clear: async (who) => {
      rows.delete(keyOf(who));
    },
  };

  const time = { now: 1_000_000, tick: null as (() => void) | null };
  const clock = {
    now: () => time.now,
    every: (_ms: number, tick: () => void) => {
      time.tick = tick;
      return () => {
        time.tick = null;
      };
    },
  };

  const send = vi.fn<typeof uploadResumable>(async (source, _target, options) => {
    options.onUploadUrl?.("https://storage.test/upload/abc");
    options.onProgress?.(source.size, source.size);
  });
  const api = {
    supabaseUrl: "https://project.supabase.co",
    start: vi.fn<RecorderApi["start"]>(async () => ({
      uploadId: "upload-1",
      bucket: "meeting-recordings",
      path: "chapter-1/meeting-1/upload-1.aac",
      token: "signed",
      contentType: "audio/aac",
    })),
    confirm: vi.fn<RecorderApi["confirm"]>(async () => undefined),
    abandon: vi.fn<RecorderApi["abandon"]>(async () => undefined),
    describe: vi.fn<RecorderApi["describe"]>(() => "Said by the server."),
  };

  const controller = new MeetingRecorderController(
    identity,
    device,
    store,
    clock,
    send,
  );
  controller.setApi(api);

  /** Let the recorder run to `seconds`, with one tick of the clock. */
  const recordTo = (seconds: number) => {
    if (phone.recorder) phone.recorder.seconds = seconds;
    files.set(URI, meetingRecorderBytes(seconds));
    time.now += 1000;
    time.tick?.();
  };

  return { controller, device, phone, files, disk, time, send, api, recordTo };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a whole meeting", () => {
  it("records, stops, uploads through the web's routes and leaves nothing on the phone", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    expect(h.controller.getState()).toMatchObject({ phase: "recording" });
    // Written down before a second of audio exists.
    expect(h.disk.value).toMatchObject({
      uri: URI,
      stage: "recording",
      userId: "user-1",
      chapterId: "chapter-1",
    });

    h.recordTo(4500);
    expect(h.controller.getState()).toMatchObject({ seconds: 4500 });

    await h.controller.stop();
    expect(h.api.start).toHaveBeenCalledWith("meeting-1", {
      file_name: "Recorded in Frapp.aac",
      mime_type: "audio/aac",
      size_bytes: meetingRecorderBytes(4500),
      duration_seconds: 4500,
      notice_confirmed: true,
    });
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.api.confirm).toHaveBeenCalledWith("meeting-1", "upload-1");
    expect(h.controller.getState()).toEqual({ phase: "idle", refusal: null });
    expect(h.files.has(URI)).toBe(false);
    expect(h.disk.value).toBeNull();
  });

  it("never starts without the notice confirmed", async () => {
    const h = harness();
    await h.controller.start(subject, false);
    await h.controller.start(subject, "yes" as unknown as boolean);
    expect(h.controller.getState()).toEqual({ phase: "idle", refusal: null });
    expect(h.phone.recorder).toBeNull();
  });

  it("writes the length down as it goes, so a dead app loses little", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    for (let second = 1; second <= 15; second += 1) h.recordTo(second);
    await flush();
    expect(h.disk.value).toMatchObject({ seconds: 15, stage: "recording" });
  });
});

describe("refusing to start", () => {
  it("says the microphone is denied", async () => {
    const h = harness();
    h.phone.microphone = "denied";
    await h.controller.start(subject, true);
    expect(h.controller.getState()).toEqual({
      phase: "idle",
      refusal: { kind: "microphone_denied", meetingId: "meeting-1" },
    });
  });

  it("says Android can't keep recording without its notification", async () => {
    const h = harness();
    h.phone.background = false;
    await h.controller.start(subject, true);
    expect(h.controller.getState()).toMatchObject({
      refusal: { kind: "notifications_denied" },
    });
    expect(h.phone.recorder).toBeNull();
  });

  it("checks there is room for a whole meeting before opening the microphone", async () => {
    const h = harness();
    h.phone.free = 20 * 1024 * 1024;
    await h.controller.start(subject, true);
    const state = h.controller.getState();
    expect(state).toMatchObject({ refusal: { kind: "low_storage" } });
    expect(
      state.phase === "idle" && (state.refusal?.neededBytes ?? 0),
    ).toBeGreaterThan(meetingRecorderBytes(7200));
    expect(h.phone.recorder).toBeNull();
  });

  it("records anyway when the phone won't say how much room it has", async () => {
    const h = harness();
    h.phone.free = null;
    await h.controller.start(subject, true);
    expect(h.controller.getState()).toMatchObject({ phase: "recording" });
  });

  it("gives the microphone back when the recorder won't start", async () => {
    const h = harness();
    h.phone.beginFails = true;
    await h.controller.start(subject, true);
    expect(h.controller.getState()).toMatchObject({
      refusal: { kind: "start_failed" },
    });
    expect(h.device.finish).toHaveBeenCalled();
    expect(h.disk.value).toBeNull();
  });
});

describe("in the middle of a meeting", () => {
  it("shows a phone call as a pause, and carries on when the call ends", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(600);
    // The call: iOS pauses the recorder under the app.
    h.phone.recorder!.isRecording = false;
    h.recordTo(600);
    expect(h.controller.getState()).toMatchObject({ paused: "interrupted" });
    // iOS hands the microphone back by itself.
    h.phone.recorder!.isRecording = true;
    h.recordTo(601);
    expect(h.controller.getState()).toMatchObject({ paused: null });
    // Or it doesn't, and the officer taps Resume.
    h.phone.recorder!.isRecording = false;
    h.recordTo(602);
    h.controller.resume();
    expect(h.phone.recorder!.isRecording).toBe(true);
    expect(h.controller.getState()).toMatchObject({ paused: null });
  });

  it("pauses and resumes on the officer's taps", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(60);
    h.controller.pause();
    expect(h.phone.recorder!.isRecording).toBe(false);
    h.recordTo(60);
    expect(h.controller.getState()).toMatchObject({ paused: "user" });
    h.controller.resume();
    expect(h.controller.getState()).toMatchObject({ paused: null });
  });

  it("stops at the longest the server takes and keeps the recording, without uploading by itself", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(7200);
    await flush();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "max_reached",
      seconds: 7200,
    });
    expect(h.api.start).not.toHaveBeenCalled();
    expect(h.files.has(URI)).toBe(true);
  });

  it("sends a meeting that ran past the longest as the longest, so it isn't refused for good", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    // The clock was held with the screen off; the recorder kept going.
    h.recordTo(7900);
    await flush();
    await h.controller.upload();
    expect(h.api.start.mock.calls[0]?.[1]).toMatchObject({
      duration_seconds: 7200,
    });
  });

  it("stops and keeps the recording when the phone runs out of room", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.phone.free = MEETING_RECORDER_STOP_FREE_BYTES - 1;
    for (let second = 1; second <= 30; second += 1) h.recordTo(second * 60);
    await flush();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "storage",
    });
    expect(h.files.has(URI)).toBe(true);
  });

  it("keeps what was recorded when Android's notification stops it", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(1800);
    h.phone.ended?.();
    await flush();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "outside",
      seconds: 1800,
    });
    expect(h.disk.value).toMatchObject({ stage: "kept", reason: "outside" });
  });

  it("measures the file when the notification stops a recording the clock lost track of", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    // Android held the app's clock with the screen off: it last read six
    // seconds, and an hour of audio is in the file.
    h.recordTo(6);
    h.files.set(URI, meetingRecorderBytes(3600));
    h.phone.ended?.();
    await flush();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "outside",
      seconds: 3600,
    });
    expect(h.files.has(URI)).toBe(true);
  });

  it("pauses again when the phone restarts a recorder the officer paused", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(60);
    h.controller.pause();
    // iOS restarts every recorder when a call ends.
    if (h.phone.recorder) h.phone.recorder.isRecording = true;
    h.recordTo(61);
    expect(h.phone.recorder?.isRecording).toBe(false);
    expect(h.controller.getState()).toMatchObject({ paused: "user" });
  });

  it("asks a recorder a call paused to carry on, without a tap", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(60);
    if (h.phone.recorder) h.phone.recorder.isRecording = false;
    h.recordTo(60);
    expect(h.controller.getState()).toMatchObject({ paused: "interrupted" });
    for (let i = 0; i < 5; i += 1) h.recordTo(60);
    expect(h.phone.recorder?.isRecording).toBe(true);
    h.recordTo(61);
    expect(h.controller.getState()).toMatchObject({ paused: null });
  });

  it("opens no microphone when the member signs out while the phone is asked", async () => {
    const h = harness();
    const starting = h.controller.start(subject, true);
    h.controller.dispose();
    await starting;
    expect(h.phone.recorder).toBeNull();
    expect(h.files.has(URI)).toBe(false);
  });

  it("keeps nothing of a recording too short to transcribe", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(4);
    await h.controller.stop();
    expect(h.controller.getState()).toEqual({
      phase: "idle",
      refusal: { kind: "too_short", meetingId: "meeting-1" },
    });
    expect(h.files.has(URI)).toBe(false);
    expect(h.api.start).not.toHaveBeenCalled();
  });

  it("closes and keeps a recording when the member signs out", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(900);
    h.controller.dispose();
    await flush();
    expect(h.disk.value).toMatchObject({ stage: "kept", seconds: 900 });
    expect(h.files.has(URI)).toBe(true);
  });
});

describe("the app closed", () => {
  const dead = (over: Partial<StoredRecording> = {}): StoredRecording => ({
    v: 1,
    userId: "user-1",
    chapterId: "chapter-1",
    subject,
    uri: URI,
    startedAt: 1_000_000 - 60_000,
    seconds: 5385,
    stage: "recording",
    reason: "stopped",
    ...over,
  });

  it("finds a recording it died in the middle of, measured by what was written", async () => {
    const h = harness(dead());
    // Twelve more seconds reached the file after the last note of its length.
    h.files.set(URI, meetingRecorderBytes(5397));
    await h.controller.restore();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "recovered",
      seconds: 5397,
    });
    expect(h.disk.value).toMatchObject({ stage: "kept", reason: "recovered" });
    // And doesn't send it until the officer says so.
    expect(h.api.start).not.toHaveBeenCalled();
    expect(h.phone.purged).toEqual([[URI]]);

    await h.controller.upload();
    expect(h.api.confirm).toHaveBeenCalledWith("meeting-1", "upload-1");
    expect(h.files.has(URI)).toBe(false);
  });

  it("finds a finished recording whose upload never happened", async () => {
    const h = harness(dead({ stage: "kept", seconds: 3000 }));
    h.files.set(URI, meetingRecorderBytes(3000));
    await h.controller.restore();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "stopped",
      seconds: 3000,
    });
  });

  it("says so when the file is gone", async () => {
    const h = harness(dead());
    await h.controller.restore();
    expect(h.controller.getState()).toEqual({
      phase: "idle",
      refusal: { kind: "lost", meetingId: "meeting-1" },
    });
    expect(h.disk.value).toBeNull();
  });

  it("leaves another member's recording alone: not shown, not sent, not deleted", async () => {
    const h = harness(dead({ userId: "user-2" }));
    h.files.set(URI, meetingRecorderBytes(5385));
    await h.controller.restore();
    expect(h.controller.getState()).toEqual({ phase: "idle", refusal: null });
    expect(h.files.has(URI)).toBe(true);
    expect(h.disk.rows.get("user-2:chapter-1")).toMatchObject({
      userId: "user-2",
    });
    // The sweep of stray files spares it.
    expect(h.phone.purged).toEqual([[URI]]);
  });

  it("deletes a recording left on the phone past its keep time, whoever made it", async () => {
    const h = harness(
      dead({
        userId: "user-2",
        startedAt:
          1_000_000 - (MEETING_RECORDER_KEEP_DAYS * 24 * 60 * 60 * 1000 + 1),
      }),
    );
    h.files.set(URI, meetingRecorderBytes(5385));
    await h.controller.restore();
    expect(h.files.has(URI)).toBe(false);
    expect(h.disk.rows.size).toBe(0);
    expect(h.controller.getState()).toEqual({ phase: "idle", refusal: null });
  });

  it("keeps another member's unsent recording through this member's own meeting", async () => {
    const theirs = "file:///documents/ExpoAudio/recording-0.aac";
    const h = harness(dead({ userId: "user-2", uri: theirs, stage: "kept" }));
    h.files.set(theirs, meetingRecorderBytes(5385));
    await h.controller.restore();
    await h.controller.start(subject, true);
    h.recordTo(1200);
    await h.controller.stop();
    expect(h.controller.getState()).toEqual({ phase: "idle", refusal: null });
    expect(h.files.has(theirs)).toBe(true);
    expect(h.disk.rows.get("user-2:chapter-1")).toMatchObject({ uri: theirs });
  });

  it("clears no file when the phone's storage can't be read", async () => {
    const h = harness(dead());
    h.files.set(URI, meetingRecorderBytes(5385));
    h.disk.failing = true;
    await h.controller.restore();
    expect(h.phone.purged).toEqual([]);
    expect(h.files.has(URI)).toBe(true);
    expect(h.controller.getState()).toEqual({ phase: "idle", refusal: null });
  });

  it("clears stray recording files when the phone remembers none", async () => {
    const h = harness();
    await h.controller.restore();
    expect(h.phone.purged).toEqual([[]]);
  });
});

describe("a bad connection", () => {
  async function stoppedAt(seconds: number) {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(seconds);
    return h;
  }

  it("keeps the file when the upload drops, and carries on from where it stopped", async () => {
    const h = await stoppedAt(3600);
    h.send.mockImplementationOnce(async (_source, _target, options) => {
      options.onUploadUrl?.("https://storage.test/upload/abc");
      options.onProgress?.(1000, 28_800_000);
      throw new ResumableUploadError("network");
    });
    await h.controller.stop();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "upload_failed",
    });
    expect(h.files.has(URI)).toBe(true);

    await h.controller.upload();
    // The same signed upload, picked up at Storage's own address for it.
    expect(h.api.start).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[1]?.[2]).toMatchObject({
      resumeUrl: "https://storage.test/upload/abc",
    });
    expect(h.controller.getState()).toEqual({ phase: "idle", refusal: null });
    expect(h.files.has(URI)).toBe(false);
  });

  it("reads the phone's own network failure as a dropped connection, not a refusal", async () => {
    const h = await stoppedAt(3600);
    // Expo's fetch on a phone throws this, which is not a TypeError.
    class FetchError extends Error {}
    h.api.confirm.mockRejectedValueOnce(
      new FetchError("fetch failed: The network connection was lost."),
    );
    await h.controller.stop();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "upload_failed",
    });
    await h.controller.upload();
    // The file Storage already holds is not sent again.
    expect(h.api.start).toHaveBeenCalledTimes(1);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.controller.getState()).toEqual({ phase: "idle", refusal: null });
  });

  it("starts a new upload when the signed one is too old to trust", async () => {
    const h = await stoppedAt(3600);
    h.send.mockRejectedValueOnce(new ResumableUploadError("network"));
    await h.controller.stop();
    h.time.now += 91 * 60 * 1000;
    await h.controller.upload();
    expect(h.api.start).toHaveBeenCalledTimes(2);
    expect(h.send.mock.calls[1]?.[2]).toMatchObject({ resumeUrl: null });
  });

  it("doesn't send the file twice when only the last step failed", async () => {
    const h = await stoppedAt(3600);
    h.api.confirm.mockRejectedValueOnce(new TypeError("Network request failed"));
    await h.controller.stop();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "upload_failed",
    });
    await h.controller.upload();
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.api.confirm).toHaveBeenCalledTimes(2);
    expect(h.controller.getState()).toEqual({ phase: "idle", refusal: null });
  });

  it("keeps the file when Storage refuses, drops that upload and starts over next time", async () => {
    const h = await stoppedAt(3600);
    h.send.mockRejectedValueOnce(new ResumableUploadError("rejected"));
    await h.controller.stop();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "upload_refused",
      message: null,
    });
    expect(h.api.abandon).toHaveBeenCalledWith("meeting-1", "upload-1");
    expect(h.files.has(URI)).toBe(true);
    await h.controller.upload();
    expect(h.api.start).toHaveBeenCalledTimes(2);
  });

  it("keeps the file and says why when the server won't take the recording", async () => {
    const h = await stoppedAt(3600);
    h.api.start.mockRejectedValueOnce(new Error("meeting.standards_refused"));
    await h.controller.stop();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "upload_refused",
      message: "Said by the server.",
    });
    expect(h.send).not.toHaveBeenCalled();
    expect(h.files.has(URI)).toBe(true);
  });

  it("stops an upload on Cancel and keeps the file", async () => {
    const h = await stoppedAt(3600);
    h.send.mockImplementationOnce(
      (_source, _target, options) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () =>
            reject(new ResumableUploadError("network")),
          );
        }),
    );
    const stopping = h.controller.stop();
    await flush();
    expect(h.controller.getState()).toMatchObject({ phase: "uploading" });
    h.controller.cancelUpload();
    await stopping;
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "upload_cancelled",
    });
    expect(h.files.has(URI)).toBe(true);
  });

  it("waits, with the file kept, when the server calls aren't there yet", async () => {
    const h = await stoppedAt(3600);
    h.controller.setApi(null);
    await h.controller.stop();
    expect(h.controller.getState()).toMatchObject({
      phase: "kept",
      reason: "stopped",
    });
  });

  it("says the file is lost when it vanished before the upload", async () => {
    const h = await stoppedAt(3600);
    h.send.mockRejectedValueOnce(new ResumableUploadError("network"));
    await h.controller.stop();
    h.files.delete(URI);
    await h.controller.upload();
    expect(h.controller.getState()).toMatchObject({
      refusal: { kind: "lost", meetingId: "meeting-1" },
    });
    expect(h.disk.value).toBeNull();
  });
});

describe("Delete", () => {
  it("removes the kept file, drops the upload it had begun and transcribes nothing", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(3600);
    h.send.mockRejectedValueOnce(new ResumableUploadError("network"));
    await h.controller.stop();
    await h.controller.discard();
    expect(h.files.has(URI)).toBe(false);
    expect(h.disk.value).toBeNull();
    expect(h.api.abandon).toHaveBeenCalledWith("meeting-1", "upload-1");
    expect(h.api.confirm).not.toHaveBeenCalled();
    expect(h.controller.getState()).toEqual({ phase: "idle", refusal: null });
  });

  it("does nothing while the microphone is open", async () => {
    const h = harness();
    await h.controller.start(subject, true);
    h.recordTo(30);
    await h.controller.discard();
    expect(h.controller.getState()).toMatchObject({ phase: "recording" });
    expect(h.files.has(URI)).toBe(true);
  });
});

describe("listeners", () => {
  it("are told of each change and not of a tick that changes nothing", async () => {
    const h = harness();
    const heard = vi.fn();
    const off = h.controller.subscribe(heard);
    await h.controller.start(subject, true);
    expect(heard).toHaveBeenCalledTimes(2);
    h.recordTo(0);
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    h.recordTo(5);
    expect(heard).toHaveBeenCalledTimes(2);
  });
});
