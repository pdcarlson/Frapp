// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toast = vi.fn();
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const { useCopyToClipboard, COPIED_RESET_MS } =
  await import("./use-copy-to-clipboard");

function stubClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(writeText) },
  });
}

describe("useCopyToClipboard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    toast.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads Copied, then goes back after the reset", async () => {
    stubClipboard(() => Promise.resolve());
    const { result } = renderHook(() => useCopyToClipboard("by hand"));

    await act(() => result.current.copy("hello"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe(true);

    act(() => vi.advanceTimersByTime(COPIED_RESET_MS));
    expect(result.current.copied).toBe(false);
  });

  it("restarts the two seconds on a second press", async () => {
    // The onboarding copy's old timer kept running, so a press 1.5s after the
    // first reverted to Copy half a second later.
    stubClipboard(() => Promise.resolve());
    const { result } = renderHook(() => useCopyToClipboard("by hand"));

    await act(() => result.current.copy("a"));
    act(() => vi.advanceTimersByTime(1500));
    await act(() => result.current.copy("a"));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.copied).toBe(true);
  });

  it("says how to copy by hand when the browser refuses", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const { result } = renderHook(() =>
      useCopyToClipboard("Select the message and copy it manually."),
    );

    await act(() => result.current.copy("hello"));
    expect(result.current.copied).toBe(false);
    expect(toast).toHaveBeenCalledWith({
      title: "Copy failed",
      description: "Select the message and copy it manually.",
      variant: "destructive",
    });
  });
});
