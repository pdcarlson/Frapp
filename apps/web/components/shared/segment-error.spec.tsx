import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

// The chunk remedy replaces the document; jsdom's real `location.reload`
// throws "not implemented", so stand in for it and assert it was called.
// Same stand-in `chapter-nav-header.spec.tsx` makes for `location.assign`.
const reload = vi.fn();
Object.defineProperty(window, "location", {
  value: { ...window.location, reload },
  writable: true,
});

const { network } = vi.hoisted(() => ({ network: { isOffline: false } }));
vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => network,
}));

import { SegmentError } from "@/components/shared/segment-error";
import DashboardSegmentError from "@/app/(dashboard)/error";

function chunkLoadError() {
  const error = new Error("Failed to load chunk static/chunks/x.js");
  error.name = "ChunkLoadError";
  return error;
}

beforeEach(() => {
  captureException.mockClear();
  reload.mockClear();
  network.isOffline = false;
});

/**
 * #2175. The contract has two halves, and the second is the one worth a suite:
 * which remedy each class of failure is offered. A stale chunk gets Reload
 * because `React.lazy` memoises the rejection for the life of the document, so
 * only replacing the document revives the control that failed; an offline
 * member gets Retry instead, because reloading with no service worker would
 * strand them. A test that only checked "an error renders an error card" would
 * pass with every button wired to the wrong remedy.
 */
describe("SegmentError", () => {
  it("offers Reload for a stale chunk, and reloads the document", async () => {
    const retry = vi.fn();
    render(<SegmentError error={chunkLoadError()} retry={retry} />);

    await userEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(reload).toHaveBeenCalledOnce();
    // `retry()` would bring the page back but leave the control that failed
    // still dead, because the lazy payload stays settled for this document.
    expect(retry).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("offers Retry for any other render error, and calls Next's retry", async () => {
    const retry = vi.fn();
    render(
      <SegmentError
        error={new TypeError("Cannot read properties of undefined")}
        retry={retry}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(retry).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });

  it("reports both classes to Sentry, tagged so they can be told apart", () => {
    const { unmount } = render(
      <SegmentError error={chunkLoadError()} retry={vi.fn()} />,
    );
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ChunkLoadError" }),
      { tags: { chunk_load_error: true } },
    );
    unmount();

    captureException.mockClear();
    render(<SegmentError error={new Error("boom")} retry={vi.fn()} />);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "boom" }),
      { tags: { chunk_load_error: false } },
    );
  });

  it("never offers Reload to an offline member", async () => {
    // The case that made this branch necessary: offline, the chunk was simply
    // never fetched, and apps/web registers no service worker — so a reload
    // cannot fetch the document and would replace a working cache-backed
    // dashboard with the browser's offline page, with no way back.
    network.isOffline = true;
    const retry = vi.fn();
    render(<SegmentError error={chunkLoadError()} retry={retry} />);

    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(reload).not.toHaveBeenCalled();
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.getByText(/You're offline/)).toBeTruthy();
  });

  it("reports one event per error, however often the boundary remounts", () => {
    // A boundary reset tears the fallback subtree down and rebuilds it, so a
    // mount-scoped effect re-reported the same error on every Retry press and,
    // for the gate's copy, on every dashboard navigation.
    const error = chunkLoadError();
    const { unmount } = render(<SegmentError error={error} retry={vi.fn()} />);
    unmount();
    render(<SegmentError error={error} retry={vi.fn()} />);

    expect(captureException).toHaveBeenCalledOnce();
  });

  it("renders rather than throwing when the thrown value fights back", () => {
    // `catch-error.js` does not guarantee an Error. A throwing getter here
    // would escape the boundary that is meant to contain it and escalate to the
    // full-page crest — the exact outcome this change removes.
    const hostile = {
      name: "Error",
      get message(): string {
        throw new TypeError("message getter blew up");
      },
    };

    expect(() =>
      render(<SegmentError error={hostile} retry={vi.fn()} />),
    ).not.toThrow();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("states what failed and what to do, per writing.md §3", () => {
    render(<SegmentError error={chunkLoadError()} retry={vi.fn()} />);

    // §1 bans the vague shapes outright; §3 wants the next step present.
    const description = screen.getByText(/Reload to pick it up\./);
    expect(description.textContent).not.toMatch(/Something went wrong/i);
    expect(description.textContent).toMatch(/new version shipped/);
    expect(screen.getByRole("heading").textContent).toBe(
      "Couldn't load this page",
    );
  });
});

describe("the (dashboard) segment boundary", () => {
  it("renders the route's h1, which it takes over from PageHeader", () => {
    // It renders instead of the page, and PageHeader owns the route's only h1
    // now that the shell's was deleted. Left at ErrorState's default h2, the
    // document would have no level-1 heading at all.
    render(<DashboardSegmentError error={new Error("boom")} retry={vi.fn()} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
      "Couldn't load this page",
    );
  });

  it("keeps a gutter, so the card is not flush on a full-bleed route", () => {
    // `<main>` drops its padding entirely on a full-bleed route, so on /chat —
    // the route this change is motivated by — a bare card painted against the
    // nav rail and the viewport edge.
    const { container } = render(
      <DashboardSegmentError error={new Error("boom")} retry={vi.fn()} />,
    );

    expect(container.firstElementChild?.className).toMatch(/\bp-4\b/);
    expect(container.firstElementChild?.className).toMatch(/\bmax-w-md\b/);
  });

  it("degrades to §10's card rather than a second full-page crest", () => {
    // The whole point of the file: `app/error.tsx` paints `CrestPage`, which is
    // `min-h-screen` with the 260px raster. Rendered under a shell that is
    // still working, that would be a full-viewport takeover inside a viewport
    // that is not gone. Guarding on the crest because that is the concrete
    // regression — someone "consolidating" the two boundaries.
    const { container } = render(
      <DashboardSegmentError error={new Error("boom")} retry={vi.fn()} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("main")).toBeNull();
    expect(container.innerHTML).not.toMatch(/min-h-screen/);
    // §10's Error variant: the sanctioned semantic border on card chrome.
    expect(container.innerHTML).toMatch(/border-destructive/);
  });

  it("takes `retry`, not `reset` — both exist in Next 16", () => {
    // Reaching for `reset` from memory type-checks and ships a Retry that
    // re-renders without re-fetching. This pins the prop the component reads.
    const retry = vi.fn();
    render(<DashboardSegmentError error={new Error("boom")} retry={retry} />);

    screen.getByRole("button", { name: "Retry" }).click();
    expect(retry).toHaveBeenCalledOnce();
  });
});
