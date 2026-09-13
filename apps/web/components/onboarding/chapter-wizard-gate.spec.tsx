import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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

    expect(await screen.findByText("Couldn't load this page")).toBeTruthy();
    // The stale-chunk remedy, not the Retry that cannot re-run a settled
    // `React.lazy` payload.
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("states the failure rather than degrading to nothing", async () => {
    // A member reaching this gate has no chapter, and the wizard is their only
    // way out of that. Silently rendering `null` would leave them on an empty
    // dashboard with no dialog and no reason given.
    wizard.throws = chunkLoadError();
    const { container } = render(<ChapterWizardGate />);

    await screen.findByText("Couldn't load this page");
    expect(container.textContent).not.toBe("");
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
