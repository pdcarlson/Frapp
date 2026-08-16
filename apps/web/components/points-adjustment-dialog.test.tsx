import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter, mockAdjustMutate } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockAdjustMutate: vi.fn().mockResolvedValue({}),
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from
// the wire format to the disabled control.
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useAdjustPoints: () => ({ mutateAsync: mockAdjustMutate, isPending: false }),
  useMembers: () => ({
    data: [{ user_id: "u-1", display_name: "Rush Chair" }],
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { PointsAdjustmentDialog } = await import("./points-adjustment-dialog");

const chapter = chapterSubscription(mockCurrentChapter);

function renderDialog() {
  return render(
    <PointsAdjustmentDialog
      open
      onOpenChange={vi.fn()}
      onAdjusted={vi.fn()}
    />,
  );
}

const submit = () =>
  screen.getByRole("button", { name: /submit adjustment/i });
const memberSelect = () => screen.getByLabelText(/member/i);
const amountInput = () => screen.getByLabelText(/amount/i);
const categorySelect = () => screen.getByLabelText(/category/i);
const reasonField = () => screen.getByLabelText(/reason/i);
const cancel = () => screen.getByRole("button", { name: /cancel/i });

describe("PointsAdjustmentDialog subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("leaves every control alone on an active chapter", () => {
    chapter.active();
    renderDialog();

    expect(submit()).toBeEnabled();
    expect(memberSelect()).toBeEnabled();
    expect(amountInput()).toBeEnabled();
    expect(categorySelect()).toBeEnabled();
    expect(reasonField()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the adjustment and names blocker plus next action when incomplete", () => {
    chapter.incomplete();
    renderDialog();

    expect(submit()).toBeDisabled();
    // The blocker, in the API's own words...
    expect(
      screen.getByText(/subscription is not active/i),
    ).toBeInTheDocument();
    // ...then the next action, pointing at the screen that clears it.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");
  });

  it("gates the form fields too, not just the submit", () => {
    // §5 rule 2. This dialog's trigger lives on the points page, so it can be
    // opened while blocked — an editable form behind a dead Submit would be
    // the wasted-effort failure the gate exists to prevent.
    chapter.incomplete();
    renderDialog();

    expect(memberSelect()).toBeDisabled();
    expect(amountInput()).toBeDisabled();
    expect(categorySelect()).toBeDisabled();
    expect(reasonField()).toBeDisabled();
  });

  it("keeps the way out of the dialog open", () => {
    // Cancel writes nothing; gating it would trap a blocked member in a form
    // they cannot submit.
    chapter.incomplete();
    renderDialog();

    expect(cancel()).toBeEnabled();
  });

  it("ties every disabled control to the one explanation", () => {
    chapter.incomplete();
    renderDialog();

    const describedBy = submit().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(reasonField()).toHaveAttribute("aria-describedby", describedBy);
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("holds the gate shut while the chapter is still loading", () => {
    chapter.loading();
    renderDialog();

    expect(submit()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
    // No blocked explanation yet — nothing has established a reason.
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    // Deliberately asymmetric with `<Can>`, which fails closed: locking the
    // whole paid surface over a failed fetch is worse than the late 403.
    chapter.unreadable();
    renderDialog();

    expect(submit()).toBeEnabled();
    expect(reasonField()).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("blocks paid-ops on past_due immediately, grace or not", () => {
    chapter.pastDue();
    renderDialog();

    expect(submit()).toBeDisabled();
  });

  it("points a canceled chapter at the portal, not at checkout", () => {
    chapter.canceled();
    renderDialog();

    expect(submit()).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /billing portal/i }),
    ).toBeInTheDocument();
  });
});
