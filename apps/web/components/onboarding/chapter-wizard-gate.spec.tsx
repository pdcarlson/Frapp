import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException }));

const { wizard } = vi.hoisted(() => ({ wizard: { throws: null as Error | null } }));
vi.mock("@/components/onboarding/chapter-wizard", () => ({
  ChapterWizard: () => {
    if (wizard.throws) throw wizard.throws;
    return <div>chapter wizard</div>;
  },
}));

const { chapters } = vi.hoisted(() => ({
  chapters: { data: [] as unknown[], isSuccess: true },
}));
vi.mock("@repo/hooks", () => ({ useAccessibleChapters: () => chapters }));

vi.mock("@/lib/providers/network-provider", () => ({
  useNetwork: () => ({ linkOnline: true }),
}));

import { ChapterWizardGate } from "@/components/onboarding/chapter-wizard-gate";

function chunkLoadError() {
  const error = new Error("Failed to load chunk chapter-wizard-a1b2c3.js");
  error.name = "ChunkLoadError";
  return error;
}

beforeEach(() => {
  wizard.throws = null;
  chapters.data = [];
  chapters.isSuccess = true;
  captureException.mockClear();
});

/**
 * #2175's second boundary, and the one that is easy to argue away.
 *
 * `(dashboard)/error.tsx` looks like it covers all three of #2145's splits, and
 * it covers two. This one is rendered by `dashboard-shell.tsx` — the
 * `(dashboard)` *layout* — and a route `error.tsx` does not wrap the layout
 * above it, so a rejection here escapes to `app/error.tsx` and takes the whole
 * dashboard with it. That is the exact outcome #2175 exists to stop, on the one
 * split that loads on every dashboard route, so it is worth a test that fails
 * if someone deletes the boundary as redundant.
 */
describe("the chapter wizard gate's own boundary", () => {
  it("catches a rejected wizard chunk instead of letting it reach the app", async () => {
    wizard.throws = chunkLoadError();

    // No `expect(...).toThrow`: the point is that rendering does NOT throw.
    render(<ChapterWizardGate />);

    // The title names the wizard, not "this page": the page behind this dialog
    // rendered fine, and §3 asks the title for what actually failed.
    await screen.findByRole("dialog");
    // Two nodes carry it — Radix's title (the dialog's accessible name) and the
    // card's own heading — and both must be the same one spelling.
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.length).toBeGreaterThan(0);
    for (const heading of headings) {
      expect(heading.textContent).toBe("Couldn't open chapter setup");
    }
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("is a real dialog, so it is announced and focus-managed", async () => {
    wizard.throws = chunkLoadError();
    render(<ChapterWizardGate />);

    // The hand-rolled scrim this replaced had no role and no accessible name,
    // so a screen-reader user got a silent overlay.
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("can be dismissed, so a repeating error is not a lockout", async () => {
    // The lockout this fixes: on a non-chunk error Retry re-renders the wizard,
    // it throws identically, and the overlay returns — and navigating away
    // re-mounts the gate on the new route, which throws again. Without a
    // dismiss, a member with no chapter could not reach the app at all.
    wizard.throws = new TypeError("a deterministic bug in the wizard");
    render(<ChapterWizardGate />);

    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /close/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stays dismissed when the boundary resets, not just for one route", async () => {
    // The dismissal lives above the boundary for this reason. Held inside the
    // fallback it reset whenever `CatchError` cleared its error on a pathname
    // change, so the wizard re-threw on the next route and the dialog came
    // back — one dismissal per route, forever. `rerender` stands in for that
    // cycle: the gate re-renders, the wizard would throw again, and the gate
    // must still be suppressed.
    wizard.throws = new TypeError("a deterministic bug in the wizard");
    const { rerender, container } = render(<ChapterWizardGate />);

    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    rerender(<ChapterWizardGate />);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(container.innerHTML).toBe("");
  });

  it("renders the wizard untouched when nothing fails", () => {
    render(<ChapterWizardGate />);

    expect(screen.getByText("chapter wizard")).toBeTruthy();
    expect(screen.queryByText("Couldn't load this page")).toBeNull();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("stays closed for a member who already has a chapter", () => {
    chapters.data = [{ id: "chapter-1" }];
    const { container } = render(<ChapterWizardGate />);

    // The boundary must not change the gate's own trigger: a member with a
    // chapter must never see a flash of onboarding.
    expect(container.innerHTML).toBe("");
  });
});
