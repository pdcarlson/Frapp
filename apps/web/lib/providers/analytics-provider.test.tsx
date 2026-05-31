import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockPost, mockUseOrgConfig } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockUseOrgConfig: vi.fn(),
}));

// The provider only needs a POST-capable client and an active chapter id.
vi.mock("@repo/hooks", () => ({
  useFrappClient: () => ({ POST: mockPost }),
  useActiveChapterId: () => "chap-1",
}));

// Opt-out state is read from the merged chapter config.
vi.mock("@/lib/hooks/use-org-config", () => ({
  useOrgConfig: () => mockUseOrgConfig(),
}));

const { AnalyticsProvider, useAnalytics } = await import("./analytics-provider");

function Emitter() {
  const track = useAnalytics();
  return (
    <button type="button" onClick={() => track("opened-channel")}>
      emit
    </button>
  );
}

function renderWithOptOut(optOut: boolean | undefined) {
  mockUseOrgConfig.mockReturnValue({ data: { analytics_opt_out: optOut } });
  render(
    <AnalyticsProvider>
      <Emitter />
    </AnalyticsProvider>,
  );
}

describe("AnalyticsProvider client-side opt-out", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: {}, error: undefined });
    mockUseOrgConfig.mockReset();
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
});
