import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from the
// wire format to the disabled control.
const PENDING_ENTRY = {
  id: "svc-1",
  chapter_id: "chap-1",
  user_id: "u-1",
  date: "2026-08-01",
  duration_minutes: 120,
  description: "Soup kitchen shift",
  proof_path: "chap-1/svc-1.jpg",
  status: "PENDING" as const,
  reviewed_by: null,
  review_comment: null,
  points_awarded: false,
  created_at: "2026-08-01T00:00:00Z",
};

const APPROVED_ENTRY = {
  ...PENDING_ENTRY,
  id: "svc-2",
  description: "Highway cleanup",
  proof_path: null,
  status: "APPROVED" as const,
  points_awarded: true,
};

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useServiceEntries: () => ({
    data: [PENDING_ENTRY, APPROVED_ENTRY],
    isPending: false,
    isError: false,
  }),
  useMembers: () => ({ data: [] }),
  useCreateServiceEntry: () => ({ mutateAsync: vi.fn() }),
  useReviewServiceEntry: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteServiceEntry: () => ({ mutateAsync: vi.fn() }),
  useRequestServiceProofUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useGetServiceProofUrl: () => ({ mutateAsync: vi.fn(), isPending: false }),
  // Chapter policy only decides whether the proof input is `required`; it has
  // no bearing on the gate, so the neutral (unloaded) branch is enough here.
  useOrgConfig: () => ({ data: undefined }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { ServiceHoursPage } = await import("./service-page");

const chapter = chapterSubscription(mockCurrentChapter);

const logTrigger = () => screen.getByRole("button", { name: /log service/i });
const approveButton = () => screen.getByRole("button", { name: /approve/i });
const rejectButton = () => screen.getByRole("button", { name: /reject/i });
const withdrawButton = () => screen.getByRole("button", { name: /withdraw/i });
const viewProofButton = () =>
  screen.getByRole("button", { name: /view proof/i });

describe("ServiceHoursPage subscription gating", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves every service write alone on an active chapter", () => {
    chapter.active();
    render(<ServiceHoursPage />);

    expect(logTrigger()).toBeEnabled();
    expect(approveButton()).toBeEnabled();
    expect(rejectButton()).toBeEnabled();
    expect(withdrawButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the log trigger and names blocker plus recovery when incomplete", async () => {
    chapter.incomplete();
    render(<ServiceHoursPage />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(logTrigger()).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
    // §5 rule 2: name the next action, not just the blocker.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");

    // §5 rule 4: disabled, not hidden — the queue and history are still there.
    // The pending entry renders twice (review queue + your-pending card).
    expect(screen.getAllByText(/soup kitchen shift/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/highway cleanup/i)).toBeInTheDocument();

    // And the dialog must not open onto a submission the API will reject.
    await userEvent.click(logTrigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("gates the admin review controls and withdraw, not just the member submit", () => {
    // PATCH /v1/service-entries/:id/review and DELETE /v1/service-entries/:id
    // sit behind the same guard, so leaving them live would have the page claim
    // writes are blocked while still offering three of them.
    chapter.incomplete();
    render(<ServiceHoursPage />);

    expect(approveButton()).toBeDisabled();
    expect(rejectButton()).toBeDisabled();
    expect(withdrawButton()).toBeDisabled();
  });

  it("never gates reading a proof", () => {
    // The signed link comes from `GET /v1/service-entries/:id/proof-url`, and
    // `enforceSubscription` returns early for GET.
    chapter.incomplete();
    render(<ServiceHoursPage />);

    expect(viewProofButton()).toBeEnabled();
  });

  it("ties every disabled control to the one explanation", () => {
    chapter.incomplete();
    render(<ServiceHoursPage />);

    const describedBy = logTrigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(approveButton()).toHaveAttribute("aria-describedby", describedBy);
    expect(withdrawButton()).toHaveAttribute("aria-describedby", describedBy);
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("holds the gate shut while the chapter is still loading", () => {
    // The window between mount and the chapter resolving is the most common
    // path to the very 403 this gate exists to prevent.
    chapter.loading();
    render(<ServiceHoursPage />);

    expect(logTrigger()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
    // No blocked explanation yet — nothing has established a reason.
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("blocks paid-ops service writes immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<ServiceHoursPage />);

    expect(logTrigger()).toBeDisabled();
    expect(approveButton()).toBeDisabled();
    expect(screen.getByText(/past due/i)).toBeInTheDocument();
  });

  it("points a canceled chapter at the portal rather than at checkout", () => {
    chapter.canceled();
    render(<ServiceHoursPage />);

    expect(logTrigger()).toBeDisabled();
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /billing portal/i }),
    ).toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    // A failed chapter fetch must not lock a paying chapter out of logging its
    // own hours; the server guard is still the enforcement.
    chapter.unreadable();
    render(<ServiceHoursPage />);

    expect(logTrigger()).toBeEnabled();
    expect(approveButton()).toBeEnabled();
    expect(withdrawButton()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("gates the dialog submit as well as the trigger", async () => {
    // The proof upload URL and the entry create both fire from this one button,
    // and both are paid-ops.
    chapter.active();
    render(<ServiceHoursPage />);
    await userEvent.click(logTrigger());

    expect(
      screen.getByRole("button", { name: /submit for approval/i }),
    ).toBeEnabled();
  });

  it("closes an already-open log dialog when the subscription lapses under it", async () => {
    // Radix fires onOpenChange only on an open/close request, so a background
    // refetch that revokes the write cannot be caught there — otherwise the
    // member finishes a form guaranteed to 403.
    chapter.active();
    const { rerender } = render(<ServiceHoursPage />);
    await userEvent.click(logTrigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    chapter.incomplete();
    rerender(<ServiceHoursPage />);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(logTrigger()).toBeDisabled();
  });
});
