/** @vitest-environment jsdom */
import { useContext } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockPost, mockUseCurrentChapter } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockUseCurrentChapter: vi.fn(),
}));

vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({ POST: mockPost }),
  useActiveChapterId: () => "chap-1",
  useCurrentChapter: () => mockUseCurrentChapter(),
}));

const { AnalyticsProvider, AnalyticsContext } = await import(
  "./analytics-provider"
);

function Emitter() {
  const track = useContext(AnalyticsContext) ?? (() => {});
  return (
    <button type="button" onClick={() => track("opened-channel")}>
      emit
    </button>
  );
}

function renderWithOptOut(optOut: boolean | undefined) {
  mockUseCurrentChapter.mockReturnValue({
    data: { analytics_opt_out: optOut },
  });
  render(
    <AnalyticsProvider>
      <Emitter />
    </AnalyticsProvider>,
  );
}

describe("mobile AnalyticsProvider client-side opt-out", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: {}, error: undefined });
    mockUseCurrentChapter.mockReset();
  });

  it("posts the event when the chapter has not opted out", () => {
    renderWithOptOut(false);
    fireEvent.click(screen.getByText("emit"));
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(mockPost).toHaveBeenCalledWith(
      "/v1/analytics/events",
      expect.objectContaining({
        body: expect.objectContaining({
          name: "opened-channel",
          chapter_id: "chap-1",
        }),
      }),
    );
  });

  it("emits zero events when the chapter has opted out", () => {
    renderWithOptOut(true);
    fireEvent.click(screen.getByText("emit"));
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("fails open when the flag is missing from the chapter payload", () => {
    renderWithOptOut(undefined);
    fireEvent.click(screen.getByText("emit"));
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
