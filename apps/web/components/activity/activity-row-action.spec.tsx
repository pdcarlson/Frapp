import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityRow } from "@repo/hooks";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";

const confirmTask = vi.fn();
const approve = vi.fn();
const selfCheckIn = vi.fn();
const toast = vi.fn();

vi.mock("@repo/hooks", () => ({
  TASK_ACTION_LABELS: { confirm: "Confirm" },
  useConfirmTask: () => ({ mutateAsync: confirmTask }),
}));
vi.mock("@/components/service/use-service-review", () => ({
  useServiceReview: () => ({ approve }),
}));
vi.mock("@/lib/hooks/use-self-check-in", () => ({
  useSelfCheckIn: () => ({ run: selfCheckIn }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));

const { ActivityRowActionButton } = await import("./activity-row-action");
const { activityRowActionGate } = await import("./activity-row-action-gate");

/**
 * A gate as `useSubscriptionGate` builds one: `allowed` folds in offline
 * and a pending chapter read, `state.allowed` is the plan's verdict, and
 * `controlProps` disables on `!allowed` with the offline reason as title.
 */
function gate({
  plan = true,
  isOffline = false,
  isPending = false,
}: { plan?: boolean; isOffline?: boolean; isPending?: boolean } = {}) {
  const allowed = plan && !isOffline && !isPending;
  return {
    allowed,
    isOffline,
    isPending,
    state: { allowed: plan },
    noticeId: "notice",
    controlProps: (alsoDisabled = false) => ({
      disabled: !allowed || alsoDisabled,
      title: isOffline ? "Reconnect to make changes." : undefined,
      "aria-describedby": !allowed && !isOffline ? "notice" : undefined,
    }),
  } as unknown as SubscriptionGate;
}

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

function draw(
  row: ActivityRow,
  action: "confirm" | "approve" | "check-in",
  onActed = vi.fn(async () => {}),
  g = gate(),
) {
  render(
    <ul>
      <li>
        <ActivityRowActionButton
          row={row}
          action={action}
          gate={g}
          onActed={onActed}
        />
      </li>
    </ul>,
  );
  return onActed;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ActivityRowActionButton (#4402)", () => {
  it("confirms the task through the task card's hook, then hands the row on", async () => {
    confirmTask.mockResolvedValue({});
    const onActed = draw(taskRow, "confirm");
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm: Sweep the porch" }),
    );
    await waitFor(() => expect(onActed).toHaveBeenCalledWith(taskRow));
    expect(confirmTask).toHaveBeenCalledWith("t1");
  });

  it("says a refused confirm in the task card's words, and acts on nothing", async () => {
    confirmTask.mockRejectedValue({});
    const onActed = draw(taskRow, "confirm");
    const button = screen.getByRole("button", { name: /Confirm/ });
    fireEvent.click(button);
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: "Couldn't confirm task",
        description: "Only admins with tasks:manage can confirm completions.",
        variant: "destructive",
      }),
    );
    expect(onActed).not.toHaveBeenCalled();
    // Free to try again.
    expect(button).not.toBeDisabled();
  });

  it("approves through the Service hours review, handing the row on only when it was recorded", async () => {
    approve.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onActed = draw(hoursRow, "approve");
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

  it("checks in through the event card's hook, handing the row on only once the member is on the list (#4427)", async () => {
    selfCheckIn.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const onActed = draw(eventRow, "check-in");
    const button = screen.getByRole("button", {
      name: "Check in: Chapter meeting",
    });
    fireEvent.click(button);
    await waitFor(() => expect(selfCheckIn).toHaveBeenCalledWith("e1", 10));
    await waitFor(() => expect(button).not.toBeDisabled());
    expect(onActed).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(onActed).toHaveBeenCalledWith(eventRow));
  });

  it("stays disabled once its write lands, so a second press can't repeat it before the row leaves", async () => {
    confirmTask.mockResolvedValue({});
    // The page's re-read never settles here: the row is still on screen.
    draw(
      taskRow,
      "confirm",
      vi.fn(() => new Promise(() => {})),
    );
    const button = screen.getByRole("button", { name: /Confirm/ });
    fireEvent.click(button);
    await waitFor(() => expect(confirmTask).toHaveBeenCalledTimes(1));
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(confirmTask).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the next row once the acted-on row has gone", async () => {
    confirmTask.mockResolvedValue({});
    let leave!: () => void;
    function List() {
      const [gone, setGone] = useState(false);
      leave = () => setGone(true);
      return (
        <ul>
          {gone ? null : (
            <li>
              <ActivityRowActionButton
                row={taskRow}
                action="confirm"
                gate={gate()}
                onActed={async () => {
                  act(() => leave());
                }}
              />
            </li>
          )}
          <li>
            <button type="button">Next row</button>
          </li>
        </ul>
      );
    }
    render(<List />);
    const button = screen.getByRole("button", { name: /Confirm/ });
    button.focus();
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next row" })).toHaveFocus(),
    );
  });

  it("is disabled offline with the reason, and while the chapter is loading", () => {
    draw(taskRow, "confirm", undefined, gate({ isOffline: true }));
    const offline = screen.getByRole("button", { name: /Confirm/ });
    expect(offline).toBeDisabled();
    expect(offline).toHaveAttribute("title", "Reconnect to make changes.");
    // It names no notice: the page draws none.
    expect(offline).not.toHaveAttribute("aria-describedby");
  });

  it("is disabled, naming no notice, while the chapter record loads", () => {
    draw(hoursRow, "approve", undefined, gate({ isPending: true }));
    const pending = screen.getByRole("button", { name: /Approve/ });
    expect(pending).toBeDisabled();
    expect(pending).not.toHaveAttribute("aria-describedby");
  });
});

describe("activityRowActionGate", () => {
  it("follows the plan's own verdict, not the connection or the loading state", () => {
    expect(activityRowActionGate(gate())).not.toBeNull();
    expect(activityRowActionGate(gate({ isOffline: true }))).not.toBeNull();
    expect(activityRowActionGate(gate({ isPending: true }))).not.toBeNull();
    expect(activityRowActionGate(gate({ plan: false }))).toBeNull();
    // A refusing plan stays refused offline: no button that vanishes on reconnect.
    expect(
      activityRowActionGate(gate({ plan: false, isOffline: true })),
    ).toBeNull();
  });
});
