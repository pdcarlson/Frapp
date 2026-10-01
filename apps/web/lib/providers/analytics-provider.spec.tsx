import { useContext } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockPost, mockClient, mockUseCurrentChapter, applyAnalyticsOptOut } =
  vi.hoisted(() => {
    const post = vi.fn();
    return {
      mockPost: post,
      // One client object, as `FrappProvider` gives, so `track`'s identity
      // depends only on what the provider does.
      mockClient: { POST: post },
      mockUseCurrentChapter: vi.fn(),
      applyAnalyticsOptOut: vi.fn(),
    };
  });

// The provider only needs a POST-capable client, an active chapter id, and
// the member view (`GET /v1/chapters/current`). The config read is what every
// role below President sees: refused (#2957). The provider must not depend on
// it, so it reports the refusal here rather than being left out of the mock.
vi.mock("@repo/hooks", () => ({
  useFrappClient: () => mockClient,
  useActiveChapterId: () => "chap-1",
  useCurrentChapter: () => mockUseCurrentChapter(),
  useOrgConfig: () => ({ data: undefined, isError: true }),
}));

vi.mock("@repo/observability/identified-posthog", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@repo/observability/identified-posthog")
    >();
  return {
    ...actual,
    applyAnalyticsOptOut: (...args: unknown[]) => applyAnalyticsOptOut(...args),
  };
});

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

function tree() {
  return (
    <AnalyticsProvider>
      <Emitter />
    </AnalyticsProvider>
  );
}

function renderWithOptOut(optOut: boolean | undefined) {
  mockUseCurrentChapter.mockReturnValue({
    data: { id: "chap-1", analytics_opt_out: optOut },
    isError: false,
  });
  return render(tree());
}

describe("AnalyticsProvider client-side opt-out", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: {}, error: undefined });
    mockUseCurrentChapter.mockReset();
    applyAnalyticsOptOut.mockReset();
  });

  it("posts the event when the chapter has not opted out", () => {
    renderWithOptOut(false);
    expect(applyAnalyticsOptOut).toHaveBeenLastCalledWith(false);
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

  // The #2957 case: a member below President, whose config read is refused,
  // in a chapter that turned analytics off. Read from the member view, the
  // flag reaches the SDK.
  it("opts a member out when their chapter has opted out", () => {
    renderWithOptOut(true);
    fireEvent.click(screen.getByText("emit"));
    expect(mockPost).not.toHaveBeenCalled();
    expect(applyAnalyticsOptOut).toHaveBeenCalledWith(true);
    expect(applyAnalyticsOptOut).not.toHaveBeenCalledWith(false);
  });

  it("stays opted out while the chapter read is pending, then opts in", () => {
    mockUseCurrentChapter.mockReturnValue({ data: undefined, isError: false });
    const view = render(tree());
    expect(applyAnalyticsOptOut).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByText("emit"));
    expect(mockPost).not.toHaveBeenCalled();

    mockUseCurrentChapter.mockReturnValue({
      data: { id: "chap-1", analytics_opt_out: false },
      isError: false,
    });
    view.rerender(tree());
    expect(applyAnalyticsOptOut).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByText("emit"));
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  it("stays opted out when the chapter read fails with nothing cached", () => {
    mockUseCurrentChapter.mockReturnValue({ data: undefined, isError: true });
    render(tree());
    fireEvent.click(screen.getByText("emit"));
    expect(mockPost).not.toHaveBeenCalled();
    expect(applyAnalyticsOptOut).toHaveBeenCalledWith(true);
    expect(applyAnalyticsOptOut).not.toHaveBeenCalledWith(false);
  });

  // Consumers key effects on `track` (`ChatProvider`'s boot outbox flush). A
  // new identity when the read settles re-ran them on every load.
  it("keeps one track identity while the chapter read settles", () => {
    const seen = new Set<unknown>();
    function Capture() {
      seen.add(useContext(AnalyticsContext));
      return null;
    }
    const capture = () => (
      <AnalyticsProvider>
        <Capture />
      </AnalyticsProvider>
    );
    mockUseCurrentChapter.mockReturnValue({ data: undefined, isError: false });
    const view = render(capture());
    mockUseCurrentChapter.mockReturnValue({
      data: { id: "chap-1", analytics_opt_out: false },
      isError: false,
    });
    view.rerender(capture());
    expect(applyAnalyticsOptOut).toHaveBeenLastCalledWith(false);
    expect(seen.size).toBe(1);
  });

  // Once a payload has loaded, the shared predicate decides: only an explicit
  // `true` opts out (`isAnalyticsOptedOut`).
  it("opts in when a loaded payload has no flag", () => {
    renderWithOptOut(undefined);
    fireEvent.click(screen.getByText("emit"));
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
