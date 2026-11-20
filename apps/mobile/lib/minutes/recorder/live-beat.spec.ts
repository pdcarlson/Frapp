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
  it("says so when recording starts, every minute while it records, and once when it stops", async () => {
    const { rerender } = renderHook(() => useLiveRecordingBeat(true));
    expect(harness.put).not.toHaveBeenCalled();

    harness.state.current = recording("mtg-1");
    rerender();
    await act(async () => {});
    expect(harness.put).toHaveBeenCalledTimes(1);
    expect(harness.put.mock.calls[0][1]).toEqual({
      params: { path: { id: "mtg-1" } },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_BEAT_MS * 2);
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
    await act(async () => {});
    expect(harness.del).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(LIVE_BEAT_MS * 2);
    });
    expect(harness.put).toHaveBeenCalledTimes(3);
  });

  it("sends the stop only after a beat still in flight has landed", async () => {
    let land: (value: unknown) => void = () => {};
    harness.put.mockReturnValueOnce(
      new Promise((resolve) => {
        land = resolve;
      }),
    );
    harness.state.current = recording("mtg-1");
    const { rerender } = renderHook(() => useLiveRecordingBeat(true));
    await act(async () => {});
    expect(harness.put).toHaveBeenCalledTimes(1);
    harness.state.current = { phase: "idle", refusal: null };
    rerender();
    await act(async () => {});
    // The PUT hasn't answered: a DELETE sent now could land first.
    expect(harness.del).not.toHaveBeenCalled();
    await act(async () => land({}));
    expect(harness.del).toHaveBeenCalledTimes(1);
  });

  it("sends nothing while the meetings module is off", () => {
    harness.state.current = recording("mtg-1");
    renderHook(() => useLiveRecordingBeat(false));
    expect(harness.put).not.toHaveBeenCalled();
  });
});
