/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  permission: vi.fn(),
  fix: vi.fn(),
}));

vi.mock("@/lib/location", () => ({
  readForegroundPermission: () => state.permission(),
  readForegroundFix: (precision: string, timeoutMs?: number) =>
    state.fix(precision, timeoutMs),
}));

import { WARM_FIX_MAX_AGE_MS, useWarmCheckInFix } from "./check-in-fix";

const FIX = { lat: 42.73, lng: -73.68, accuracy_meters: 9 };

describe("useWarmCheckInFix", () => {
  let read: () => ReturnType<ReturnType<typeof useWarmCheckInFix>> = () => null;
  function Probe({ active }: { active: boolean }) {
    read = useWarmCheckInFix(active);
    return null;
  }
  let tree: ReactTestRenderer | undefined;

  const mount = async (active: boolean) => {
    await act(async () => {
      tree = create(<Probe active={active} />);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    state.permission.mockReset();
    state.fix.mockReset();
  });

  afterEach(() => {
    act(() => tree?.unmount());
    tree = undefined;
    vi.useRealTimers();
  });

  it("keeps a GPS fix ready when location is already allowed", async () => {
    state.permission.mockResolvedValue({ granted: true, canAskAgain: true });
    state.fix.mockResolvedValue(FIX);
    await mount(true);

    expect(state.fix).toHaveBeenCalledWith("high", WARM_FIX_MAX_AGE_MS);
    expect(read()).toEqual(FIX);
  });

  it("never prompts, and has nothing when location isn't allowed", async () => {
    state.permission.mockResolvedValue({ granted: false, canAskAgain: true });
    await mount(true);

    expect(state.fix).not.toHaveBeenCalled();
    expect(read()).toBeNull();
  });

  it("stops offering a fix once it is a minute old", async () => {
    state.permission.mockResolvedValue({ granted: true, canAskAgain: true });
    state.fix.mockResolvedValueOnce(FIX).mockReturnValue(new Promise(() => {}));
    await mount(true);
    expect(read()).toEqual(FIX);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WARM_FIX_MAX_AGE_MS);
    });
    expect(read()).toBeNull();
  });

  it("reads nothing while the scanner is off screen", async () => {
    await mount(false);
    expect(state.permission).not.toHaveBeenCalled();
    expect(read()).toBeNull();
  });
});
