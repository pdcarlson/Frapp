/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useNow, useNowDate } from "./use-now";

const T0 = new Date("2026-09-25T18:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useNow", () => {
  it("holds one snapshot between ticks and moves on the 30s tick", () => {
    const { result, rerender, unmount } = renderHook(() => useNow());
    expect(result.current).toBe(T0);

    act(() => {
      vi.advanceTimersByTime(29_999);
    });
    rerender();
    expect(result.current).toBe(T0);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(T0 + 30_000);
    unmount();
  });

  it("shares one interval across subscribers and clears it with the last", () => {
    const first = renderHook(() => useNow());
    const second = renderHook(() => useNow());
    expect(vi.getTimerCount()).toBe(1);

    first.unmount();
    expect(vi.getTimerCount()).toBe(1);

    second.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("useNowDate", () => {
  it("keeps the same Date instance until the clock ticks", () => {
    const { result, rerender, unmount } = renderHook(() => useNowDate());
    const before = result.current;
    expect(before.getTime()).toBe(T0);

    rerender();
    expect(result.current).toBe(before);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(result.current).not.toBe(before);
    expect(result.current.getTime()).toBe(T0 + 30_000);
    unmount();
  });
});
