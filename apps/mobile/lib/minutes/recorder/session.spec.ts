import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecorderDevice, RecorderStore } from "./controller";
import { bindMeetingRecorder } from "./session";

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
