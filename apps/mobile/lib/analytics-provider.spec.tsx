/** @vitest-environment jsdom */
import { useContext } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

const harness = vi.hoisted(() => ({
  post: vi.fn(),
  chapter: vi.fn(),
  activeChapter: "chap-mobile" as string | null,
  optOut: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({ POST: harness.post }),
  useActiveChapterId: () => harness.activeChapter,
  useCurrentChapter: () => harness.chapter(),
}));

vi.mock("@repo/observability/identified-posthog", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@repo/observability/identified-posthog")>();
  return {
    ...actual,
    applyAnalyticsOptOut: (...args: unknown[]) => harness.optOut(...args),
  };
});

const { AnalyticsProvider, AnalyticsContext } = await import(
  "./analytics-provider"
);

function TrackButton({ eventName }: { eventName: string }) {
  const track = useContext(AnalyticsContext) ?? (() => {});
  return (
    <button type="button" onClick={() => track(eventName)}>
      send
    </button>
  );
}

function mountProvider(optOut: boolean | undefined) {
  harness.chapter.mockReturnValue({
    data: { analytics_opt_out: optOut },
  });
  render(
    <AnalyticsProvider>
      <TrackButton eventName="logged-hours" />
    </AnalyticsProvider>,
  );
}

describe("mobile AnalyticsProvider", () => {
  beforeEach(() => {
    harness.activeChapter = "chap-mobile";
    harness.post.mockReset();
    harness.post.mockResolvedValue({ data: {}, error: undefined });
    harness.chapter.mockReset();
    harness.optOut.mockReset();
  });

  it("posts logged-hours with the active chapter when opt-out is false", () => {
    mountProvider(false);
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(harness.post).toHaveBeenCalledTimes(1);
    expect(harness.post.mock.calls[0]?.[0]).toBe("/v1/analytics/events");
    expect(harness.post.mock.calls[0]?.[1]).toEqual({
      body: { name: "logged-hours", chapter_id: "chap-mobile" },
    });
  });

  it("does not POST when the chapter opted out, and still tells the SDK", () => {
    mountProvider(true);
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(harness.post).not.toHaveBeenCalled();
    expect(harness.optOut).toHaveBeenCalledWith(true);
  });

  it("treats a missing analytics_opt_out as opted in", () => {
    mountProvider(undefined);
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(harness.post).toHaveBeenCalledTimes(1);
  });

  it("is a no-op until an active chapter exists", () => {
    harness.activeChapter = null;
    mountProvider(false);
    fireEvent.click(screen.getByRole("button", { name: "send" }));
    expect(harness.post).not.toHaveBeenCalled();
  });
});
