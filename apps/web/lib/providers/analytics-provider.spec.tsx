import { useContext, useEffect } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  bindPostHogAdapterForTests,
  createMemoryPostHogAdapter,
} from "@repo/observability/identified-posthog";

const {
  mockPost,
  mockClient,
  mockUseCurrentChapter,
  applyAnalyticsOptOut,
  pathname,
} = vi.hoisted(() => {
  const post = vi.fn();
  return {
    mockPost: post,
    // One client object, as `FrappProvider` gives, so `track`'s identity
    // depends only on what the provider does.
    mockClient: { POST: post },
    mockUseCurrentChapter: vi.fn(),
    applyAnalyticsOptOut: vi.fn(),
    pathname: { current: null as string | null },
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

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
    // Recorded, then applied for real, so the route-view gate moves with it.
    applyAnalyticsOptOut: (next: boolean) => {
      applyAnalyticsOptOut(next);
      actual.applyAnalyticsOptOut(next);
    },
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
          app: "web",
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

  // The ref is written in `useLayoutEffect`, so a child effect in the commit
  // that flips the gate already reads the new value. Written in `useEffect`,
  // the child's passive effect would run first and post for a chapter that
  // has just opted out.
  it("applies a flip to child effects in the same commit", () => {
    function EffectEmitter({ tick }: { tick: number }) {
      const track = useContext(AnalyticsContext);
      useEffect(() => {
        track?.("opened-channel");
      }, [track, tick]);
      return null;
    }
    const withTick = (tick: number) => (
      <AnalyticsProvider>
        <EffectEmitter tick={tick} />
      </AnalyticsProvider>
    );
    mockUseCurrentChapter.mockReturnValue({
      data: { id: "chap-1", analytics_opt_out: false },
      isError: false,
    });
    const view = render(withTick(0));
    expect(mockPost).toHaveBeenCalledTimes(1);

    mockUseCurrentChapter.mockReturnValue({
      data: { id: "chap-1", analytics_opt_out: true },
      isError: false,
    });
    view.rerender(withTick(1));
    expect(mockPost).toHaveBeenCalledTimes(1);
  });

  // Once a payload has loaded, the shared predicate decides: only an explicit
  // `true` opts out (`isAnalyticsOptedOut`).
  it("opts in when a loaded payload has no flag", () => {
    renderWithOptOut(undefined);
    fireEvent.click(screen.getByText("emit"));
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

// #3382: one `$pageview` per route, as its template, only once opted in.
describe("AnalyticsProvider route views", () => {
  let memory: ReturnType<typeof createMemoryPostHogAdapter>;
  const routeViews = () =>
    memory.calls.flatMap((c) => (c.type === "routeView" ? [c.path] : []));
  const chapter = (optOut: boolean | undefined) =>
    mockUseCurrentChapter.mockReturnValue(
      optOut === undefined
        ? { data: undefined, isError: false }
        : { data: { id: "chap-1", analytics_opt_out: optOut }, isError: false },
    );

  beforeEach(() => {
    mockUseCurrentChapter.mockReset();
    applyAnalyticsOptOut.mockReset();
    memory = createMemoryPostHogAdapter();
    bindPostHogAdapterForTests(memory.adapter);
  });

  afterEach(() => {
    bindPostHogAdapterForTests(null);
    pathname.current = null;
  });

  it("records the first route once the chapter read opts in", () => {
    pathname.current = "/chat";
    chapter(undefined);
    const view = render(tree());
    expect(routeViews()).toEqual([]);

    chapter(false);
    view.rerender(tree());
    expect(routeViews()).toEqual(["/chat"]);

    view.rerender(tree());
    expect(routeViews()).toEqual(["/chat"]);
  });

  it("records each route change", () => {
    pathname.current = "/chat";
    chapter(false);
    const view = render(tree());
    pathname.current = "/events";
    view.rerender(tree());
    expect(routeViews()).toEqual(["/chat", "/events"]);
  });

  it("records a route with an id segment as its template", () => {
    pathname.current = "/events/3f2a9c1e-4b5d-4e6f-8a7b-9c0d1e2f3a4b";
    chapter(false);
    render(tree());
    expect(routeViews()).toEqual(["/events/[id]"]);
  });

  it("records nothing for a chapter that opted out", () => {
    pathname.current = "/chat";
    chapter(true);
    const view = render(tree());
    pathname.current = "/events";
    view.rerender(tree());
    expect(routeViews()).toEqual([]);
  });

  it("stops recording the moment the chapter opts out", () => {
    pathname.current = "/chat";
    chapter(false);
    const view = render(tree());
    chapter(true);
    pathname.current = "/events";
    view.rerender(tree());
    expect(routeViews()).toEqual(["/chat"]);
  });
});
