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
});

/**
 * #2175. The contract has two halves, and the second is the one worth a suite:
 * a rejected chunk must not be offered the Retry that Next's `retry()` cannot
 * satisfy, because `React.lazy` memoises the rejection and re-throws it without
 * ever calling the loader again (`lib/chunk-load-error.ts` carries the
 * evidence). A test that only checked "an error renders an error card" would
 * pass with both buttons wired to the wrong remedy.
 */
describe("SegmentError", () => {
  it("offers Reload for a stale chunk, and reloads the document", async () => {
    const retry = vi.fn();
    render(<SegmentError error={chunkLoadError()} retry={retry} />);

    await userEvent.click(screen.getByRole("button", { name: "Reload" }));

    expect(reload).toHaveBeenCalledOnce();
    // The half that actually protects the member: `retry()` here would be a
    // button that re-runs the same rejected import and fails identically.
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
