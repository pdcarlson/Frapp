/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  report: vi.fn(),
  fix: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useReportCheckInScreen: () => ({ mutateAsync: state.report }),
}));
vi.mock("@/lib/location", () => ({
  tryForegroundFix: (precision: string) => state.fix(precision),
}));

import {
  CHECK_IN_SCREEN_REPORT_MS,
  screenPresenceOf,
  useCheckInScreenReport,
  type ScreenPresence,
} from "./check-in-screen-report";

const GRANTED = { granted: true, canAskAgain: true };

describe("screenPresenceOf", () => {
  it("reads the server's check, and why this phone gave no location", () => {
    expect(screenPresenceOf("screen", GRANTED)).toEqual({ kind: "screen" });
    expect(screenPresenceOf("other_screen", GRANTED)).toEqual({
      kind: "elsewhere",
    });
    expect(screenPresenceOf("no_location", GRANTED)).toEqual({
      kind: "off",
      reason: "imprecise",
    });
    expect(
      screenPresenceOf("no_location", { granted: false, canAskAgain: false }),
    ).toEqual({ kind: "off", reason: "permission", canAskAgain: false });
    for (const check of ["zone", "not_open", "closed", null] as const) {
      expect(screenPresenceOf(check, GRANTED)).toEqual({ kind: "none" });
    }
  });
});

describe("useCheckInScreenReport", () => {
  let seen: ScreenPresence[] = [];
  function Probe({ eventId, active }: { eventId: string; active: boolean }) {
    seen.push(useCheckInScreenReport(eventId, active));
    return null;
  }
  const last = () => seen[seen.length - 1];
  const flush = async (ms = 0) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    seen = [];
    state.report.mockReset().mockResolvedValue("screen");
    state.fix.mockReset().mockResolvedValue({
      fix: { lat: 42.73, lng: -73.68, accuracy_meters: 9 },
      permission: GRANTED,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a GPS fix at once, then every minute while active", async () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Probe eventId="evt-1" active />);
    });
    await flush();
    expect(state.fix).toHaveBeenCalledWith("high");
    expect(state.report).toHaveBeenCalledWith({
      eventId: "evt-1",
      lat: 42.73,
      lng: -73.68,
      accuracy_meters: 9,
    });
    expect(last()).toEqual({ kind: "screen" });

    await flush(CHECK_IN_SCREEN_REPORT_MS);
    expect(state.report).toHaveBeenCalledTimes(2);

    // Inactive (no code drawn, or the screen out of sight): no reports.
    act(() => tree.update(<Probe eventId="evt-1" active={false} />));
    await flush(3 * CHECK_IN_SCREEN_REPORT_MS);
    expect(state.report).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });

  it("doesn't report again when the code blinks off and on inside the minute", async () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Probe eventId="evt-1" active />);
    });
    await flush();
    act(() => tree.update(<Probe eventId="evt-1" active={false} />));
    act(() => tree.update(<Probe eventId="evt-1" active />));
    await flush(1_000);
    expect(state.report).toHaveBeenCalledTimes(1);
    await flush(CHECK_IN_SCREEN_REPORT_MS);
    expect(state.report).toHaveBeenCalledTimes(2);
    act(() => tree.unmount());
  });

  it("reports with no location when the phone gives none, and says why", async () => {
    state.fix.mockResolvedValue({
      fix: null,
      permission: { granted: false, canAskAgain: true },
    });
    state.report.mockResolvedValue("no_location");
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Probe eventId="evt-1" active />);
    });
    await flush();
    expect(state.report).toHaveBeenCalledWith({ eventId: "evt-1" });
    expect(last()).toEqual({
      kind: "off",
      reason: "permission",
      canAskAgain: true,
    });
    act(() => tree.unmount());
  });

  it("keeps the last answer through a failed report, and says nothing of another event", async () => {
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Probe eventId="evt-1" active />);
    });
    await flush();
    state.report.mockRejectedValue(new Error("offline"));
    await flush(CHECK_IN_SCREEN_REPORT_MS);
    expect(last()).toEqual({ kind: "screen" });

    act(() => tree.update(<Probe eventId="evt-2" active />));
    expect(last()).toEqual({ kind: "none" });
    act(() => tree.unmount());
  });
});
