import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@repo/hooks";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";

const confirmTask = vi.fn();
const approve = vi.fn();
const checkIn = vi.fn();
const toast = vi.fn();

vi.mock("@repo/hooks", () => ({
  TASK_ACTION_LABELS: { confirm: "Confirm" },
  useConfirmTask: () => ({ mutateAsync: confirmTask }),
}));
vi.mock("@/components/service/use-service-review", () => ({
  useServiceReview: () => ({ approve }),
}));
vi.mock("@/lib/hooks/use-self-check-in", () => ({
  useSelfCheckIn: () => ({ run: checkIn }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const { ActivityRowActionButton, activityRowActionGate } =
  await import("./activity-row-action");

const gate = (over: Partial<SubscriptionGate> = {}) =>
  ({
    allowed: true,
    isOffline: false,
    isPending: false,
    controlProps: (alsoDisabled = false) => ({ disabled: alsoDisabled }),
    ...over,
  }) as unknown as SubscriptionGate;

const taskRow = {
  kind: "task",
  key: "needs-confirm:task:t1",
  title: "Sweep the porch",
  glyph: "confirm",
  task: { id: "t1" },
} as unknown as ActivityRow;
const hoursRow = {
  kind: "hours",
  key: "needs:hours:h1",
  title: "Food bank",
  entry: { id: "h1", description: "Food bank" },
} as unknown as ActivityRow;
const eventRow = {
  kind: "event",
  key: "needs:event:e1",
  title: "Chapter meeting",
  event: { id: "e1", point_value: 10 },
} as unknown as ActivityRow;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ActivityRowActionButton (#4402)", () => {
  it("confirms the task through the task card's hook, then re-reads", async () => {
    confirmTask.mockResolvedValue({});
    const onActed = vi.fn();
    render(
      <ActivityRowActionButton
        row={taskRow}
        action="confirm"
        gate={gate()}
        onActed={onActed}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm: Sweep the porch" }),
    );
    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
    expect(confirmTask).toHaveBeenCalledWith("t1");
  });

  it("says a refused confirm, and doesn't re-read for it", async () => {
    confirmTask.mockRejectedValue(new Error("Invalid status transition"));
    const onActed = vi.fn();
    render(
      <ActivityRowActionButton
        row={taskRow}
        action="confirm"
        gate={gate()}
        onActed={onActed}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Confirm/ }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't confirm task",
          variant: "destructive",
        }),
      ),
    );
    expect(onActed).not.toHaveBeenCalled();
  });

  it("approves through the Service hours review, re-reading only when it was recorded", async () => {
    const onActed = vi.fn();
    approve.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(
      <ActivityRowActionButton
        row={hoursRow}
        action="approve"
        gate={gate()}
        onActed={onActed}
      />,
    );
    const button = screen.getByRole("button", { name: "Approve: Food bank" });
    fireEvent.click(button);
    await waitFor(() => expect(approve).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(onActed).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
    expect(approve).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "h1" }),
    );
  });

  it("checks in through the event card's hook, with the event's points", async () => {
    checkIn.mockResolvedValue(undefined);
    const onActed = vi.fn();
    render(
      <ActivityRowActionButton
        row={eventRow}
        action="check-in"
        gate={gate()}
        onActed={onActed}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Check in: Chapter meeting" }),
    );
    await waitFor(() => expect(onActed).toHaveBeenCalledTimes(1));
    expect(checkIn).toHaveBeenCalledWith("e1", 10);
  });

  it("is disabled while its write is on the way", async () => {
    let finish!: () => void;
    confirmTask.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    render(
      <ActivityRowActionButton
        row={taskRow}
        action="confirm"
        gate={gate()}
        onActed={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: /Confirm/ });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    finish();
    await waitFor(() => expect(button).not.toBeDisabled());
  });
});

describe("activityRowActionGate", () => {
  it("hands the gate on unless the chapter's plan refuses the writes", () => {
    expect(activityRowActionGate(gate())).not.toBeNull();
    // Offline and still checking draw the buttons, disabled by the gate.
    expect(
      activityRowActionGate(gate({ allowed: false, isOffline: true })),
    ).not.toBeNull();
    expect(
      activityRowActionGate(gate({ allowed: false, isPending: true })),
    ).not.toBeNull();
    expect(activityRowActionGate(gate({ allowed: false }))).toBeNull();
  });
});
