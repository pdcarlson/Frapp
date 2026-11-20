/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  put: vi.fn(),
  del: vi.fn(),
  state: { current: { phase: "idle", refusal: null } as unknown },
}));

vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({ PUT: harness.put, DELETE: harness.del }),
}));
vi.mock("./session", () => ({
  useMeetingRecorder: () => ({ state: harness.state.current, recorder: null }),
}));

const { useLiveRecordingBeat, LIVE_BEAT_MS } = await import("./live-beat");

const recording = (meetingId: string) => ({
  phase: "recording",
  subject: { meetingId, eventName: "Recruitment Meetings", maxSeconds: 7200 },
  seconds: 12,
  paused: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  harness.put.mockReset().mockResolvedValue({});
  harness.del.mockReset().mockResolvedValue({});
  harness.state.current = { phase: "idle", refusal: null };
});
afterEach(() => vi.useRealTimers());

describe("useLiveRecordingBeat", () => {
  it("says so when recording starts, every minute while it records, and once when it stops", () => {
    const { rerender } = renderHook(() => useLiveRecordingBeat(true));
    expect(harness.put).not.toHaveBeenCalled();

    harness.state.current = recording("mtg-1");
    rerender();
    expect(harness.put).toHaveBeenCalledTimes(1);
    expect(harness.put.mock.calls[0][1]).toEqual({
      params: { path: { id: "mtg-1" } },
    });
    act(() => {
      vi.advanceTimersByTime(LIVE_BEAT_MS * 2);
    });
    expect(harness.put).toHaveBeenCalledTimes(3);

    harness.state.current = {
      phase: "uploading",
      subject: recording("mtg-1").subject,
      seconds: 12,
      sent: 0,
      total: 10,
    };
    rerender();
    expect(harness.del).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(LIVE_BEAT_MS * 2);
    });
    expect(harness.put).toHaveBeenCalledTimes(3);
  });

  it("sends nothing while the meetings module is off", () => {
    harness.state.current = recording("mtg-1");
    renderHook(() => useLiveRecordingBeat(false));
    expect(harness.put).not.toHaveBeenCalled();
  });
});
