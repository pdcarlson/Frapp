// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  task: null as Record<string, unknown> | null,
  confirm: vi.fn(),
  reject: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useTask: () => ({
    data: state.task,
    isError: false,
    isFetching: false,
    refetch: state.refetch,
  }),
  useConfirmTask: () => ({ mutate: state.confirm, isPending: false }),
  useRejectTask: () => ({ mutateAsync: state.reject, isPending: false }),
  // Nov 4, 2026, noon UTC: the same calendar day as the hand-in everywhere.
  useNow: () => Date.parse("2026-11-04T12:00:00.000Z"),
  useTaskPhotoUrl: () => ({ data: undefined }),
}));
vi.mock("@/components/chat/renderers/task-card", () => ({
  CardTaskEdit: () => <div data-testid="task-edit" />,
  TASK_CONFIRM_FAILURE: { title: "Couldn't confirm task", fallback: "No" },
}));
vi.mock("@/components/shared/subscription-gate", () => ({
  SubscriptionNotice: () => null,
  useSubscriptionGate: () => ({ controlProps: () => ({}) }),
}));
vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { TaskReview } = await import("./task-review");

function submittedTask(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Clean his room",
    status: "COMPLETED",
    stored_status: "COMPLETED",
    assignee_id: "user-1",
    due_date: "2026-11-05",
    point_reward: 10,
    proof_kind: "photo",
    completed_at: "2026-11-04T10:00:00.000Z",
    completion_note: "Vacuumed and made the bed",
    photos: [
      { id: "ph-1", kind: "proof", storage_path: "t/1.jpg" },
      { id: "ph-2", kind: "proof", storage_path: "t/2.jpg" },
    ],
    ...overrides,
  };
}

function renderReview(onDone = vi.fn()) {
  render(
    <TaskReview
      taskId="task-1"
      assigneeName="Shawn Klein"
      face={null}
      onDone={onDone}
    />,
  );
  return onDone;
}

beforeEach(() => {
  state.task = submittedTask();
  state.confirm.mockReset();
  state.reject.mockReset().mockResolvedValue({});
});

describe("TaskReview (#4693)", () => {
  it("leads with who and when, then the task, its proof and the reply", () => {
    renderReview();
    expect(screen.getByText("Shawn Klein")).toBeInTheDocument();
    expect(screen.getByText(/^Submitted today at /)).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Clean his room" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/on time · 10 points$/)).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: /^Proof, photo \d of 2/ }),
    ).toHaveLength(2);
    expect(screen.getByText("Shawn:")).toBeInTheDocument();
    expect(screen.getByText("Vacuumed and made the bed")).toBeInTheDocument();
  });

  it("shows the send-back a resubmission answers", () => {
    state.task = submittedTask({
      sent_back_at: "2026-11-03T20:00:00.000Z",
      sent_back_reason: "Floor still dirty",
    });
    renderReview();
    expect(screen.getByText(/^Resubmitted today at /)).toBeInTheDocument();
    expect(screen.getByText("You sent it back:")).toBeInTheDocument();
    expect(screen.getByText(/Floor still dirty/)).toBeInTheDocument();
  });

  it("confirms with a button that names the payout, then closes", () => {
    state.confirm.mockImplementation(
      (_id: string, options: { onSuccess: () => void }) => options.onSuccess(),
    );
    const onDone = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Confirm · +10 pts" }));
    expect(state.confirm).toHaveBeenCalledWith("task-1", expect.anything());
    expect(onDone).toHaveBeenCalled();
  });

  it("sends back with a one-tap reason, then closes", async () => {
    const onDone = renderReview();
    fireEvent.click(screen.getByRole("button", { name: "Send back" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Photo doesn't show it" }),
    );
    expect(screen.getByLabelText("What needs to change")).toHaveValue(
      "Photo doesn't show it",
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      Array.from(dialog.querySelectorAll("button")).find(
        (button) => button.textContent === "Send back",
      )!,
    );
    await waitFor(() =>
      expect(state.reject).toHaveBeenCalledWith({
        id: "task-1",
        body: { comment: "Photo doesn't show it" },
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("says how many more wait, and skips to the next", () => {
    const onSkip = vi.fn();
    render(
      <TaskReview
        taskId="task-1"
        assigneeName="Shawn Klein"
        face={null}
        waitingAfter={3}
        onSkip={onSkip}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText("3 more waiting")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalled();
  });

  it("reads the task again on open, since a cached read can predate the submission", () => {
    renderReview();
    expect(state.refetch).toHaveBeenCalled();
  });

  it("offers no actions once the task stopped waiting elsewhere", () => {
    state.task = submittedTask({
      points_awarded: true,
      confirmed_at: "2026-11-04T11:00:00.000Z",
    });
    renderReview();
    expect(
      screen.getByText(
        /isn't waiting on a review anymore\. Status: Confirmed\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Confirm/ })).toBeNull();
  });

  it("says plainly when the task can't be read yet", () => {
    state.task = null;
    renderReview();
    expect(screen.getByText("Loading the task…")).toBeInTheDocument();
  });
});
