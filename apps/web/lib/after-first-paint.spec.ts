// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { afterFirstPaint } from "./after-first-paint";

function setReadyState(state: DocumentReadyState) {
  Object.defineProperty(document, "readyState", {
    configurable: true,
    get: () => state,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  setReadyState("complete");
});

describe("afterFirstPaint (#3716)", () => {
  it("waits for the load event, then an idle callback", () => {
    const idle =
      vi.fn<(cb: () => void, opts?: { timeout: number }) => number>();
    vi.stubGlobal("requestIdleCallback", idle);
    setReadyState("loading");
    const run = vi.fn();
    afterFirstPaint(run);
    expect(idle).not.toHaveBeenCalled();

    window.dispatchEvent(new Event("load"));
    expect(idle).toHaveBeenCalledTimes(1);
    expect(idle.mock.calls[0]?.[1]).toEqual({ timeout: 4000 });
    expect(run).not.toHaveBeenCalled();
    idle.mock.calls[0]?.[0]();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("goes straight to the idle callback once the page has loaded", () => {
    const idle = vi.fn((cb: () => void) => {
      cb();
      return 1;
    });
    vi.stubGlobal("requestIdleCallback", idle);
    setReadyState("complete");
    const run = vi.fn();
    afterFirstPaint(run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timer where there is no requestIdleCallback (Safari)", () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestIdleCallback", undefined);
    setReadyState("complete");
    const run = vi.fn();
    afterFirstPaint(run);
    expect(run).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
