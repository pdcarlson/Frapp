/** @vitest-environment jsdom */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOCUS_RETRY_WINDOW_MS, useFocusOnOpen } from "./use-focus-on-open";
import type { JumpMissReason } from "./use-jump-to-important";

type MissOptions = { onMiss?: (reason: JumpMissReason) => void };

describe("useFocusOnOpen (#4977)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup(firstMiss: JumpMissReason | null) {
    let calls = 0;
    const jump = vi.fn((_id: string, options?: MissOptions) => {
      calls += 1;
      if (calls === 1 && firstMiss) options?.onMiss?.(firstMiss);
    });
    const onMiss = vi.fn();
    const hook = renderHook(
      ({ rowCount }: { rowCount: number }) =>
        useFocusOnOpen({ focusMessageId: "m1", rowCount, jump, onMiss }),
      { initialProps: { rowCount: 0 } },
    );
    return { jump, onMiss, hook };
  }

  it("waits for the first rows, then jumps once", () => {
    const { jump, onMiss, hook } = setup(null);
    expect(jump).not.toHaveBeenCalled();
    hook.rerender({ rowCount: 5 });
    hook.rerender({ rowCount: 6 });
    expect(jump).toHaveBeenCalledTimes(1);
    expect(onMiss).not.toHaveBeenCalled();
  });

  it("a miss on cached rows retries when the catch-up lands, with no alert", () => {
    const { jump, onMiss, hook } = setup("missing");
    hook.rerender({ rowCount: 5 });
    expect(onMiss).not.toHaveBeenCalled();
    hook.rerender({ rowCount: 7 });
    expect(jump).toHaveBeenCalledTimes(2);
    expect(jump).toHaveBeenLastCalledWith("m1", { onMiss });
    vi.advanceTimersByTime(FOCUS_RETRY_WINDOW_MS);
    expect(onMiss).not.toHaveBeenCalled();
  });

  it("a miss with no catch-up says so after the window", () => {
    const { jump, onMiss, hook } = setup("missing");
    hook.rerender({ rowCount: 5 });
    vi.advanceTimersByTime(FOCUS_RETRY_WINDOW_MS - 1);
    expect(onMiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onMiss).toHaveBeenCalledWith("missing");
    expect(jump).toHaveBeenCalledTimes(1);
  });

  it("an error is said at once, never retried", () => {
    const { jump, onMiss, hook } = setup("error");
    hook.rerender({ rowCount: 5 });
    expect(onMiss).toHaveBeenCalledWith("error");
    hook.rerender({ rowCount: 7 });
    expect(jump).toHaveBeenCalledTimes(1);
  });
});
