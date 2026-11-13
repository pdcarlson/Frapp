import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  consent: undefined as Record<string, unknown> | null | undefined,
  memberships: [] as { chapter_id: string; has_completed_onboarding: boolean }[],
  pathname: "/chat",
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useAiConsent: () => ({ data: state.consent }),
  useAccessibleChapters: () => ({ data: state.memberships }),
}));
vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (pick: (s: { activeChapterId: string }) => unknown) =>
    pick({ activeChapterId: "ch-1" }),
}));
// The dialog has its own spec (`meet-frapp-ai.spec.tsx`).
vi.mock("@/components/ai/meet-frapp-ai", () => ({
  MeetFrappAiDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog">Meet Frapp AI</div> : null,
}));

const { MeetFrappAiHost, MEET_FRAPP_AI_OPEN_DELAY_MS } = await import(
  "./meet-frapp-ai-host"
);

const UNANSWERED = {
  answer: null,
  answered_at: null,
  sheet_changed: false,
  sheet: { version: 2, providers: [], data: [] },
};

async function wait() {
  await act(async () => {
    vi.advanceTimersByTime(MEET_FRAPP_AI_OPEN_DELAY_MS + 10);
  });
}

/** Meet Frapp AI once, by itself, for an account that never answered (#4790). */
describe("MeetFrappAiHost", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.consent = UNANSWERED;
    state.memberships = [{ chapter_id: "ch-1", has_completed_onboarding: true }];
    state.pathname = "/chat";
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("opens a moment after the page loads", async () => {
    render(<MeetFrappAiHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await wait();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("waits while the first-run tour is due", async () => {
    state.memberships = [{ chapter_id: "ch-1", has_completed_onboarding: false }];
    render(<MeetFrappAiHost />);
    await wait();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["the member has answered", { ...UNANSWERED, answer: "no" }],
    ["the server has no AI", null],
  ])("stays shut when %s", async (_why, consent) => {
    state.consent = consent;
    render(<MeetFrappAiHost />);
    await wait();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stands down when another dialog is already up", async () => {
    const other = document.createElement("div");
    other.setAttribute("role", "alertdialog");
    document.body.appendChild(other);
    render(<MeetFrappAiHost />);
    await wait();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
