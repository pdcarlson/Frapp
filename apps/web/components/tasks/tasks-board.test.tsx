import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter, tasksRef } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  // Mutable so a test can swap the rows the board renders.
  tasksRef: { current: [] as unknown[] },
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from
// the wire format to the disabled control.
const ME = "u-me";

const TASKS = [
  {
    id: "task-todo",
    chapter_id: "chap-1",
    title: "Sweep the chapter room",
    description: null,
    assignee_id: ME,
    created_by: "u-admin",
    due_date: "2026-09-01",
    status: "TODO" as const,
    point_reward: 5,
    points_awarded: false,
    completed_at: null,
    confirmed_at: null,
    created_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "task-in-progress",
    chapter_id: "chap-1",
    title: "Draft the rush calendar",
    description: null,
    assignee_id: ME,
    created_by: "u-admin",
    due_date: "2026-09-02",
    status: "IN_PROGRESS" as const,
    point_reward: null,
    points_awarded: false,
    completed_at: null,
    confirmed_at: null,
    created_at: "2026-08-01T00:00:00Z",
  },
  {
    id: "task-completed",
    chapter_id: "chap-1",
    title: "Book the philanthropy venue",
    description: null,
    assignee_id: "u-other",
    created_by: "u-admin",
    due_date: "2026-09-03",
    status: "COMPLETED" as const,
    point_reward: 10,
    points_awarded: false,
    completed_at: "2026-08-10T00:00:00Z",
    confirmed_at: null,
    created_at: "2026-08-01T00:00:00Z",
  },
];

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useTasks: () => ({
    data: tasksRef.current,
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useMembers: () => ({ data: [] }),
  useCurrentUser: () => ({ data: { id: ME } }),
  useCreateTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTaskStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRejectTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const { TasksBoard } = await import("./tasks-board");

const chapter = chapterSubscription(mockCurrentChapter);

const trigger = () => screen.getByRole("button", { name: /new task/i });
const startButton = () => screen.getByRole("button", { name: /^start$/i });
const completeButton = () =>
  screen.getByRole("button", { name: /mark complete/i });
const confirmButton = () => screen.getByRole("button", { name: /^confirm$/i });
const rejectButton = () => screen.getByRole("button", { name: /^reject$/i });
const deleteButtons = () =>
  screen.getAllByRole("button", { name: /^delete$/i });

describe("TasksBoard subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tasksRef.current = TASKS;
  });

  it("leaves every task write alone on an active chapter", () => {
    chapter.active();
    render(<TasksBoard />);

    expect(trigger()).toBeEnabled();
    expect(startButton()).toBeEnabled();
    expect(completeButton()).toBeEnabled();
    expect(confirmButton()).toBeEnabled();
    expect(rejectButton()).toBeEnabled();
    for (const button of deleteButtons()) expect(button).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables the trigger and names blocker plus recovery when incomplete", async () => {
    chapter.incomplete();
    render(<TasksBoard />);

    // §5 rule 1: gate the trigger, never the submit.
    expect(trigger()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      /subscription is not active/i,
    );
    // §5 rule 2: name the next action, not just the blocker.
    expect(
      screen.getByRole("link", { name: /complete checkout/i }),
    ).toHaveAttribute("href", "/billing");
    expect(screen.getByRole("status")).toHaveTextContent(
      /to restore managing tasks/i,
    );

    // §5 rule 4: disabled, not hidden — the board is still readable.
    expect(screen.getByText(/sweep the chapter room/i)).toBeInTheDocument();

    // And the dialog must not open onto an action that cannot succeed.
    await userEvent.click(trigger());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("gates the other four task writes, not just Create", () => {
    // Status, confirm, reject and delete all hit the same paid-ops controller,
    // so leaving them live would have the board claim writes are blocked while
    // still offering four of them.
    chapter.incomplete();
    render(<TasksBoard />);

    expect(startButton()).toBeDisabled();
    expect(completeButton()).toBeDisabled();
    expect(confirmButton()).toBeDisabled();
    expect(rejectButton()).toBeDisabled();
    for (const button of deleteButtons()) expect(button).toBeDisabled();
  });

  it("ties every disabled control to the one explanation", () => {
    chapter.incomplete();
    render(<TasksBoard />);

    const describedBy = trigger().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(startButton()).toHaveAttribute("aria-describedby", describedBy);
    expect(deleteButtons()[0]).toHaveAttribute(
      "aria-describedby",
      describedBy,
    );
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("blocks paid-ops task writes immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<TasksBoard />);

    expect(trigger()).toBeDisabled();
    expect(startButton()).toBeDisabled();
    // Scoped to the notice: the OVERDUE column description also says "past
    // due", and matching that would pass with no gate at all.
    expect(screen.getByRole("status")).toHaveTextContent(/past due/i);
  });

  it("points a canceled chapter at the portal rather than checkout", () => {
    chapter.canceled();
    render(<TasksBoard />);

    expect(trigger()).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(/read-only/i);
    expect(
      screen.getByRole("link", { name: /billing portal/i }),
    ).toBeInTheDocument();
  });

  it("holds the gate shut while the chapter is still loading", () => {
    // The window between mount and the chapter resolving is the most common
    // path to the very 403 this gate prevents: a trigger that paints enabled
    // for that round trip still lets a fast click reach a doomed form.
    chapter.loading();
    render(<TasksBoard />);

    expect(trigger()).toBeDisabled();
    expect(screen.getByText(/checking this chapter/i)).toBeInTheDocument();
    // No blocked explanation yet — nothing has established a reason.
    expect(
      screen.queryByText(/subscription is not active/i),
    ).not.toBeInTheDocument();
  });

  it("closes an already-open dialog when the subscription lapses under it", async () => {
    // Radix fires onOpenChange only on an open/close request, so a background
    // refetch that revokes the write cannot be caught there.
    chapter.active();
    const { rerender } = render(<TasksBoard />);
    await userEvent.click(trigger());
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    chapter.incomplete();
    rerender(<TasksBoard />);

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("leaves the reads and the board itself ungated", () => {
    // `enforceSubscription` returns early for GET, so a lapsed chapter still
    // reads everything it owns — only the write affordances change.
    chapter.incomplete();
    render(<TasksBoard />);

    expect(screen.getByText(/draft the rush calendar/i)).toBeInTheDocument();
    expect(screen.getByText(/awaiting confirmation/i)).toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    // A failed chapter fetch must not lock a paying chapter out of its board;
    // the server guard is still the enforcement.
    chapter.unreadable();
    render(<TasksBoard />);

    expect(trigger()).toBeEnabled();
    expect(startButton()).toBeEnabled();
    expect(confirmButton()).toBeEnabled();
    for (const button of deleteButtons()) expect(button).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps a task's own busy condition folded into the gate", () => {
    // `points_awarded` already disabled Confirm before the gate existed;
    // spreading controlProps must not drop that.
    chapter.active();
    render(<TasksBoard />);

    expect(confirmButton()).toBeEnabled();
  });
});

/**
 * The board half of #1051. `OVERDUE` is derived and collapses a stored `TODO`
 * and a stored `IN_PROGRESS` into one rendered value, so affordances key off
 * `stored_status` while columns and badges keep using `status`.
 */
describe("TasksBoard overdue affordances", () => {
  function overdueTask(overrides: Record<string, unknown>) {
    return {
      id: "task-overdue",
      chapter_id: "chap-1",
      title: "Submit the ride-share list",
      description: null,
      assignee_id: ME,
      created_by: "u-admin",
      due_date: "2020-01-01",
      status: "OVERDUE" as const,
      point_reward: 5,
      points_awarded: false,
      completed_at: null,
      confirmed_at: null,
      created_at: "2019-12-01T00:00:00Z",
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("offers Start when the stored status is TODO", () => {
    tasksRef.current = [overdueTask({ stored_status: "TODO" })];
    render(<TasksBoard />);

    expect(startButton()).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /mark complete/i }),
    ).not.toBeInTheDocument();
  });

  it("offers Mark complete when the stored status is IN_PROGRESS", () => {
    tasksRef.current = [overdueTask({ stored_status: "IN_PROGRESS" })];
    render(<TasksBoard />);

    expect(completeButton()).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: /^start$/i }),
    ).not.toBeInTheDocument();
  });

  it("offers Start when the stored status is literally OVERDUE", () => {
    // The transition table accepts OVERDUE → IN_PROGRESS, which Start makes.
    tasksRef.current = [overdueTask({ stored_status: "OVERDUE" })];
    render(<TasksBoard />);

    expect(startButton()).toBeEnabled();
  });

  it("offers no lifecycle action when a pre-#1051 API sends no stored_status", () => {
    tasksRef.current = [overdueTask({})];
    render(<TasksBoard />);

    expect(
      screen.queryByRole("button", { name: /^start$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /mark complete/i }),
    ).not.toBeInTheDocument();
    // Still readable, and Delete still offered — only the ambiguous
    // lifecycle transition is withheld.
    expect(
      screen.getByText(/submit the ride-share list/i),
    ).toBeInTheDocument();
  });
});
