import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecorderDevice, RecorderStore } from "./controller";
import { bindMeetingRecorder, isMeetingRecorderBusy } from "./session";

/**
 * One recorder per signed-in member and chapter. A change of either ends
 * the old one, which closes and keeps what it was recording.
 */
const store: RecorderStore = {
  all: vi.fn(async () => []),
  save: vi.fn(async () => undefined),
  clear: vi.fn(async () => undefined),
};
const device = { purge: vi.fn() } as unknown as RecorderDevice;
const paul = { userId: "user-1", chapterId: "chapter-1" };

beforeEach(() => {
  bindMeetingRecorder(null, null, store);
  vi.clearAllMocks();
});

describe("bindMeetingRecorder", () => {
  it("keeps the same recorder for the same member and chapter, and looks for a left-over recording once", () => {
    const first = bindMeetingRecorder(paul, device, store);
    expect(first).not.toBeNull();
    expect(bindMeetingRecorder({ ...paul }, device, store)).toBe(first);
    expect(store.all).toHaveBeenCalledTimes(1);
  });

  it("ends the recorder on sign-out and on a change of chapter", () => {
    const first = bindMeetingRecorder(paul, device, store);
    const dispose = vi.spyOn(first!, "dispose");
    const second = bindMeetingRecorder(
      { ...paul, chapterId: "chapter-2" },
      device,
      store,
    );
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(second).not.toBe(first);
    const disposeSecond = vi.spyOn(second!, "dispose");
    expect(bindMeetingRecorder(null, device, store)).toBeNull();
    expect(disposeSecond).toHaveBeenCalledTimes(1);
  });

  it("binds nothing on a build that can't record", () => {
    expect(bindMeetingRecorder(paul, null, store)).toBeNull();
    expect(store.all).not.toHaveBeenCalled();
  });
});

describe("isMeetingRecorderBusy", () => {
  it("is false with no recorder, and with one sitting idle", () => {
    expect(isMeetingRecorderBusy()).toBe(false);
    bindMeetingRecorder(paul, device, store);
    expect(isMeetingRecorderBusy()).toBe(false);
  });

  it("is true while the recorder starts, records, saves or uploads, and false once a recording is only kept", () => {
    const recorder = bindMeetingRecorder(paul, device, store)!;
    const getState = vi.spyOn(recorder, "getState");
    const subject = { meetingId: "m1", eventName: "Chapter", maxSeconds: 7200 };
    for (const phase of ["starting", "recording", "saving", "uploading"] as const) {
      getState.mockReturnValue({ phase, subject } as never);
      expect(isMeetingRecorderBusy(), phase).toBe(true);
    }
    getState.mockReturnValue({ phase: "kept", subject } as never);
    expect(isMeetingRecorderBusy()).toBe(false);
  });
});
