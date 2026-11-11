import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";
import type {
  DispatchResult,
  PointsAdjustmentInput,
} from "@repo/chat-core/dispatch";

const { mockCurrentChapter, mockAdjustMutate, mockAdjustReset } = vi.hoisted(
  () => ({
    mockCurrentChapter: vi.fn(),
    mockAdjustMutate: vi.fn().mockResolvedValue({}),
    mockAdjustReset: vi.fn(),
  }),
);

const MEMBERS_QUERY = {
  data: [
    { user_id: "u-1", display_name: "Rush Chair" },
    // `users.display_name` is NOT NULL DEFAULT '', so this is what a member
    // who never set a name actually looks like on the wire.
    { user_id: "u-2", display_name: "" },
  ],
};

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from
// the wire format to the disabled control.
vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useAdjustPoints: () => ({
    mutateAsync: mockAdjustMutate,
    reset: mockAdjustReset,
    isPending: false,
  }),
  // One array for every render, as React Query hands back: a fresh one each
  // render would re-run the dialog's reset effect and wipe a typed draft.
  useMembers: () => MEMBERS_QUERY,
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

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
const memberSelect = () => screen.getByRole("combobox", { name: /member/i });
const amountInput = () => screen.getByLabelText(/amount/i);
const categorySelect = () =>
  screen.getByRole("combobox", { name: /category/i });
const reasonField = () => screen.getByLabelText(/reason/i);
const cancel = () => screen.getByRole("button", { name: /cancel/i });

describe("PointsAdjustmentDialog member labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("never offers an option whose name slot is blank", async () => {
    // The picker is the only control identifying the target of an adjustment
    // or a fine, so an unlabelled option is unusable rather than untidy. This
    // used to read `display_name ?? userId`, and `??` cannot fire on a field
    // the contract types `string` — the empty name went straight through.
    chapter.active();
    renderDialog();

    await userEvent.click(memberSelect());
    const labels = screen
      .getAllByRole("option")
      .map((option) => option.textContent ?? "");

    expect(labels).toContain("Rush Chair (u-1)");
    // The shared no-name label (#2422), never the bare id in the name slot:
    // `Member u-2` here is what the directory and leaderboard call this member.
    expect(labels).toContain("Member u-2 (u-2)");
    for (const label of labels) {
      expect(label.trimStart()).toBe(label);
      expect(label).not.toMatch(/^\s*\(/);
      expect(label.split(" (")[0]).not.toBe("");
    }
  });
});

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

describe("PointsAdjustmentDialog idempotency key", () => {
  beforeEach(() => {
    chapter.active();
    mockAdjustReset.mockClear();
  });

  // Opening is a new adjustment, so the key the hook held for the last one
  // goes (#1906); otherwise a later identical grant would replay a stale key.
  it("starts each opening under a fresh key", () => {
    const view = render(
      <PointsAdjustmentDialog
        open={false}
        onOpenChange={vi.fn()}
        onAdjusted={vi.fn()}
      />,
    );
    expect(mockAdjustReset).not.toHaveBeenCalled();

    view.rerender(
      <PointsAdjustmentDialog open onOpenChange={vi.fn()} onAdjusted={vi.fn()} />,
    );
    expect(mockAdjustReset).toHaveBeenCalledTimes(1);
  });
});

describe("PointsAdjustmentDialog posting into a chat channel (#3865)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  function renderInChat(
    submitToChannel: (input: PointsAdjustmentInput) => Promise<DispatchResult>,
    onOpenChange = vi.fn(),
  ) {
    render(
      <PointsAdjustmentDialog
        open
        onOpenChange={onOpenChange}
        onAdjusted={vi.fn()}
        submitToChannel={submitToChannel}
      />,
    );
    return onOpenChange;
  }

  async function fillAndSubmit() {
    fireEvent.change(amountInput(), { target: { value: "-5" } });
    await userEvent.click(categorySelect());
    await userEvent.click(screen.getByRole("option", { name: "Fine" }));
    fireEvent.change(reasonField(), { target: { value: "Missed chapter" } });
    fireEvent.click(submit());
  }

  it("adjusts through chat, not the dashboard hook, and closes", async () => {
    const submitToChannel = vi.fn().mockResolvedValue({ ok: true });
    const onOpenChange = renderInChat(submitToChannel);
    await fillAndSubmit();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(submitToChannel).toHaveBeenCalledWith({
      target_user_id: "u-1",
      amount: -5,
      category: "FINE",
      reason: "Missed chapter",
    });
    expect(mockAdjustMutate).not.toHaveBeenCalled();
  });

  it("names an amount past the API's bound before anything is sent", async () => {
    const submitToChannel = vi.fn().mockResolvedValue({ ok: true });
    renderInChat(submitToChannel);
    fireEvent.change(amountInput(), { target: { value: "200000" } });
    fireEvent.change(reasonField(), { target: { value: "Missed chapter" } });
    fireEvent.click(submit());
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(submitToChannel).not.toHaveBeenCalled();
  });

  it("adjusts once however fast Submit is pressed", async () => {
    let finish: (value: DispatchResult) => void = () => undefined;
    const submitToChannel = vi.fn(
      () => new Promise<DispatchResult>((resolve) => (finish = resolve)),
    );
    renderInChat(submitToChannel);
    await fillAndSubmit();
    const busy = await screen.findByRole("button", { name: /submitting/i });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(submitToChannel).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await waitFor(() => expect(submitToChannel).toHaveBeenCalledTimes(1));
  });

  it("stays open with the draft when chat refuses it", async () => {
    const submitToChannel = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "You can't adjust your own points" });
    const onOpenChange = renderInChat(submitToChannel);
    await fillAndSubmit();
    await waitFor(() => expect(submitToChannel).toHaveBeenCalled());
    await waitFor(() => expect(submit()).toBeEnabled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(reasonField()).toHaveValue("Missed chapter");
  });
});
