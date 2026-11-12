import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { cardFilledContainers } from "@/tests/card-surfaces";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";
import {
  expectClearingEntriesEmpty,
  expectRefusedEntriesKeep,
} from "@/tests/numeric-input";

const {
  mockCurrentChapter,
  tasksRef,
  currentUserRef,
  createTaskMutate,
  permissionsRef,
  eventsRef,
  eventsEnabled,
  eventsModuleOn,
  permissionsFailed,
  chapterScopeRef,
  tasksPending,
  suggestionsPending,
  updateTaskMutate,
} = vi.hoisted(() => ({
  // The suggested-tasks read still in flight (#4313).
  suggestionsPending: { current: false },
  updateTaskMutate: vi.fn(),
  mockCurrentChapter: vi.fn(),
  createTaskMutate: vi.fn(),
  // Mutable so a test can swap the rows the board renders.
  tasksRef: { current: [] as unknown[] },
  // Mutable so a test can simulate `useCurrentUser` still in flight or errored,
  // which is when the Confirm gate has to fail closed.
  currentUserRef: { current: undefined as { id?: string } | undefined },
  // `undefined` is the permissions read still in flight.
  permissionsRef: { current: ["tasks:manage"] as string[] | undefined },
  eventsRef: { current: [] as unknown[] },
  // Every `enabled` the board passed to `useEvents`, to prove when it reads.
  eventsEnabled: [] as boolean[],
  eventsModuleOn: { current: true },
  // The permissions read failed (or can't run) rather than still loading.
  permissionsFailed: { current: false },
  // `useChapterScope` (#4094): `none` is a user the server can't scope, whose
  // `useTasks` read never goes out and so stays pending.
  chapterScopeRef: {
    current: "chapter" as "chapter" | "none" | "resolving",
  },
  tasksPending: { current: false },
}));

// Only the chapter payload is stubbed — `useSubscriptionWriteState` and
// `subscriptionWriteState` run for real, so this covers the whole path from
// the wire format to the disabled control.
const ME = "u-me";

const MEMBERS = [
  { user_id: ME, display_name: "Paul Carlson" },
  { user_id: "u-other", display_name: "Cole Martin" },
];

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

vi.mock("@repo/hooks", async (importOriginal) => ({
  // `actionStatus` stays real; only the data hooks are stubbed.
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useCurrentChapter: () => mockCurrentChapter(),
  useChapterScope: () => chapterScopeRef.current,
  useTasks: () => ({
    data: tasksPending.current ? undefined : tasksRef.current,
    isPending: tasksPending.current,
    isError: false,
    refetch: vi.fn(),
  }),
  useMembers: () => ({ data: MEMBERS }),
  useAiSuggestions: (options?: { enabled?: boolean }) => ({
    data: suggestionsPending.current ? undefined : { items: [] },
    isPending: suggestionsPending.current && (options?.enabled ?? true),
    fetchStatus:
      suggestionsPending.current && (options?.enabled ?? true)
        ? "fetching"
        : "idle",
  }),
  useMyPermissions: () => ({
    data:
      permissionsRef.current === undefined
        ? undefined
        : { permissions: permissionsRef.current },
    fetchStatus:
      permissionsRef.current === undefined && !permissionsFailed.current
        ? "fetching"
        : "idle",
    isError: permissionsFailed.current,
  }),
  useEvents: (options?: { enabled?: boolean }) => {
    eventsEnabled.push(options?.enabled ?? true);
    return { data: options?.enabled ? eventsRef.current : undefined };
  },
  useCurrentUser: () => ({ data: currentUserRef.current }),
  // The List / Grid pick is kept under the viewer's id (`lib/list-layout.ts`).
  useViewerUserId: () => "viewer-1",
  useCreateTask: () => ({ mutateAsync: createTaskMutate, isPending: false }),
  useUpdateTaskStatus: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRejectTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteTask: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateTask: () => ({ mutateAsync: updateTaskMutate, isPending: false }),
  useAddSubtask: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSubtask: () => ({ mutate: vi.fn(), isPending: false }),
  useSetSubtaskDone: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/use-chapter-module-gate", () => ({
  useChapterModuleGateState: () => ({
    status: "ready",
    isModuleEnabled: (key: string) =>
      key !== "events" || eventsModuleOn.current,
    retry: vi.fn(),
    fetchStatus: "idle",
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

// `tasks:manage` is answered from `permissionsRef`, with a stand-in for the
// real gate's offline chip when the read failed, so the board's own branching
// is tested against the answer the gate would give. Every other gate on the
// page (the notice's billing link) passes through, as before.
// The list has its own spec; here only where the board puts it.
vi.mock("@/components/ai/suggested-tasks", () => ({
  SuggestedTasks: () => <div data-testid="suggested-tasks" />,
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({
    children,
    permission,
  }: {
    children: React.ReactNode;
    permission: string;
  }) =>
    permission !== "tasks:manage" ? (
      <>{children}</>
    ) : permissionsFailed.current ? (
      <span>Permissions unavailable</span>
    ) : permissionsRef.current?.includes(permission) ? (
      <>{children}</>
    ) : null,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const { TasksBoard } = await import("./tasks-board");
const { resetListLayoutForTests } = await import("@/lib/list-layout");

const chapter = chapterSubscription(mockCurrentChapter);

// The add row at the top of To do: the board's one way to create a task.
const trigger = () => screen.getByRole("button", { name: /^add a task$/i });
const addForm = () => screen.getByRole("form", { name: /add a task/i });
const startButton = () => screen.getByRole("button", { name: /^start$/i });
const completeButton = () => screen.getByRole("button", { name: /mark done/i });
const confirmButton = () => screen.getByRole("button", { name: /^confirm$/i });
const rejectButton = () => screen.getByRole("button", { name: /^reject$/i });
// An icon on each tile, named for its task ("Delete Draft rush schedule").
const deleteButtons = () =>
  screen.getAllByRole("button", { name: /^delete /i });

beforeEach(() => {
  window.localStorage.clear();
  resetListLayoutForTests();
  permissionsRef.current = ["tasks:manage"];
  permissionsFailed.current = false;
  eventsRef.current = [];
  eventsEnabled.length = 0;
  eventsModuleOn.current = true;
});

describe("TasksBoard suggested tasks (#4313)", () => {
  it("puts the Suggested list above the columns for an officer, and nowhere for a member", () => {
    chapter.active();
    const { unmount } = render(<TasksBoard />);
    expect(screen.getByTestId("suggested-tasks")).toBeInTheDocument();
    unmount();

    permissionsRef.current = ["members:view"];
    tasksRef.current = TASKS;
    try {
      render(<TasksBoard />);
      expect(screen.queryByTestId("suggested-tasks")).toBeNull();
    } finally {
      tasksRef.current = [];
    }
  });

  it("waits for an officer's suggestions with the board, so the columns are drawn once", () => {
    chapter.active();
    suggestionsPending.current = true;
    try {
      render(<TasksBoard />);
      expect(screen.queryByTestId("suggested-tasks")).toBeNull();
      expect(
        screen.queryByRole("button", { name: /^add a task$/i }),
      ).toBeNull();
    } finally {
      suggestionsPending.current = false;
    }
  });

  it("never holds a member's board for a read it doesn't make", () => {
    chapter.active();
    permissionsRef.current = ["members:view"];
    suggestionsPending.current = true;
    tasksRef.current = TASKS;
    try {
      render(<TasksBoard />);
      expect(screen.getAllByRole("listitem").length).toBeGreaterThan(0);
    } finally {
      suggestionsPending.current = false;
      tasksRef.current = [];
    }
  });
});

describe("TasksBoard with no chapter the server can scope (#4094)", () => {
  it("says so instead of a skeleton that never ends", () => {
    chapter.active();
    chapterScopeRef.current = "none";
    tasksPending.current = true;
    try {
      render(<TasksBoard />);
      expect(
        screen.getByText("Pick an active chapter to load its tasks."),
      ).toBeInTheDocument();
    } finally {
      chapterScopeRef.current = "chapter";
      tasksPending.current = false;
    }
  });
});

describe("TasksBoard subscription gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tasksRef.current = TASKS;
    currentUserRef.current = { id: ME };
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

  it("hides Confirm on your own completed task but keeps Reject (#1056)", () => {
    // The API refuses a self-confirmation, so offering the control would be a
    // guaranteed 403 plus an optimistic flip-and-revert. Reject is untouched:
    // it withholds points rather than awarding them.
    chapter.active();
    tasksRef.current = [{ ...TASKS[2], id: "task-mine", assignee_id: ME }];
    render(<TasksBoard />);

    expect(
      screen.queryByRole("button", { name: /^confirm$/i }),
    ).not.toBeInTheDocument();
    expect(rejectButton()).toBeEnabled();
    // The missing control is explained on the tile it is missing from.
    expect(
      screen.getByText("You can't confirm your own task."),
    ).toBeInTheDocument();
  });

  it("moves a confirmed task out of the waiting column into Confirmed, with no controls", () => {
    // "Waiting on an officer" is the officer's queue: a confirmed task there
    // would read as still owed. It sits in the Confirmed list instead, which
    // says what the old disabled "Confirmed" button said, and the API refuses
    // a reject once points are awarded, so it offers neither.
    chapter.active();
    tasksRef.current = [
      {
        ...TASKS[2],
        id: "task-mine-awarded",
        assignee_id: ME,
        points_awarded: true,
        confirmed_at: new Date().toISOString(),
      },
    ];
    render(<TasksBoard />);

    const waiting = screen.getByRole("region", {
      name: "Waiting on an officer",
    });
    expect(within(waiting).getByText("Nothing to confirm")).toBeInTheDocument();
    const confirmed = screen.getByRole("region", { name: "Confirmed" });
    expect(within(confirmed).getByText(TASKS[2]!.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /reject/i })).toBeNull();
  });

  it("lets the assignee take back their own unconfirmed completion", () => {
    chapter.active();
    tasksRef.current = [{ ...TASKS[2], id: "task-mine", assignee_id: ME }];
    render(<TasksBoard />);

    expect(
      screen.getByRole("button", { name: /mark not done/i }),
    ).toBeInTheDocument();
  });

  it("hides Confirm while the viewer is unknown, rather than failing open", () => {
    // `myUserId` is "" until `useCurrentUser` resolves. If the gate keyed on
    // `isMine` alone, every row would read as someone else's during that window
    // and Confirm would come back on your own task.
    chapter.active();
    currentUserRef.current = undefined;
    tasksRef.current = [{ ...TASKS[2], id: "task-mine", assignee_id: ME }];
    render(<TasksBoard />);

    expect(
      screen.queryByRole("button", { name: /^confirm$/i }),
    ).not.toBeInTheDocument();
    // Unresolved viewer: "your own task" would be a guess (#1346).
    expect(screen.queryByText(/can't confirm your own task/i)).toBeNull();
  });

  it("still offers Confirm on someone else's completed task", () => {
    // The gate keys on the assignee, not on "is an admin looking" — the
    // ordinary two-party path must stay open.
    chapter.active();
    tasksRef.current = [TASKS[2]];
    render(<TasksBoard />);

    expect(confirmButton()).toBeEnabled();
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
    ).toHaveAttribute("href", "/settings?tab=billing");
    expect(screen.getByRole("status")).toHaveTextContent(
      /to restore managing tasks/i,
    );

    // §5 rule 4: disabled, not hidden — the board is still readable.
    expect(screen.getByText(/sweep the chapter room/i)).toBeInTheDocument();

    // And the row must not open onto an action that cannot succeed.
    await userEvent.click(trigger());
    expect(
      screen.queryByRole("form", { name: /add a task/i }),
    ).not.toBeInTheDocument();
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
    expect(deleteButtons()[0]).toHaveAttribute("aria-describedby", describedBy);
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("blocks paid-ops task writes immediately on past_due, grace or not", () => {
    chapter.pastDue();
    render(<TasksBoard />);

    expect(trigger()).toBeDisabled();
    expect(startButton()).toBeDisabled();
    // Scoped to the notice: an overdue tile's due line ("Overdue by …") sits
    // on the same board, and matching board text would pass with no gate.
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

  it("disables Add task in an open row when the subscription lapses under it", async () => {
    // A background refetch can revoke the write while the row is open. The
    // row keeps what was typed, and its submit says why it can't run.
    chapter.active();
    const { rerender } = render(<TasksBoard />);
    await userEvent.click(trigger());
    const submit = within(addForm()).getByRole("button", { name: "Add task" });
    expect(submit).toBeEnabled();

    chapter.incomplete();
    rerender(<TasksBoard />);

    expect(submit).toBeDisabled();
    expect(
      within(addForm()).getByRole("button", { name: "Cancel" }),
    ).toBeEnabled();
  });

  it("leaves the reads and the board itself ungated", () => {
    // `enforceSubscription` returns early for GET, so a lapsed chapter still
    // reads everything it owns — only the write affordances change.
    chapter.incomplete();
    render(<TasksBoard />);

    expect(screen.getByText(/draft the rush calendar/i)).toBeInTheDocument();
    expect(screen.getByText(/waiting on an officer/i)).toBeInTheDocument();
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
      screen.queryByRole("button", { name: /mark done/i }),
    ).not.toBeInTheDocument();
  });

  it("offers Mark done when the stored status is IN_PROGRESS", () => {
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
      screen.queryByRole("button", { name: /mark done/i }),
    ).not.toBeInTheDocument();
    // Still readable, and Delete still offered — only the ambiguous
    // lifecycle transition is withheld.
    expect(screen.getByText(/submit the ride-share list/i)).toBeInTheDocument();
  });
});

/**
 * List or Grid (#4175). The board of status columns was the page's only view,
 * so it is Grid and stays the default; List draws the same groups as rows,
 * with the same controls, Edit and Delete included.
 */
describe("TasksBoard List / Grid", () => {
  beforeEach(() => {
    chapter.active();
    currentUserRef.current = { id: "u-admin" };
    tasksRef.current = TASKS;
  });

  const layoutChoice = (name: "List" | "Grid") =>
    within(screen.getByRole("radiogroup", { name: "Layout" })).getByRole(
      "radio",
      { name },
    );

  it("opens on the board, as Grid, until the person picks", () => {
    render(<TasksBoard />);
    expect(layoutChoice("Grid")).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("region", { name: /to do/i }).querySelector("ul"),
    ).not.toHaveClass("divide-y");
  });

  it("draws the same groups as rows in List, keeping Edit and Delete, and remembers it", async () => {
    const user = userEvent.setup();
    const { container, unmount } = render(<TasksBoard />);
    await user.click(layoutChoice("List"));

    expect(layoutChoice("List")).toHaveAttribute("aria-checked", "true");
    const todo = screen.getByRole("region", { name: /to do/i });
    expect(todo.querySelector("ul")).toHaveClass("divide-y");
    expect(
      within(todo).getByRole("button", {
        name: /^edit sweep the chapter room$/i,
      }),
    ).toBeInTheDocument();
    expect(
      within(todo).getByRole("button", {
        name: /^delete sweep the chapter room$/i,
      }),
    ).toBeInTheDocument();
    // The same four groups, and the page stays flush.
    expect(screen.getAllByRole("region")).toHaveLength(4);
    expect(cardFilledContainers(container)).toEqual([]);
    expect(window.localStorage.getItem("frapp.tasks.layout.viewer-1")).toBe(
      "list",
    );

    unmount();
    render(<TasksBoard />);
    expect(layoutChoice("List")).toHaveAttribute("aria-checked", "true");
  });
});

describe("TasksBoard assignee label", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("names an assignee missing from the roster with the shared member label", () => {
    // #2422: a departed member keeps their tasks. They read `Member <first
    // six of id>` here, the label the leaderboard and chat give them too.
    tasksRef.current = [
      {
        ...TASKS[2],
        id: "task-departed",
        assignee_id: "2f4a1c9d-0000-4000-8000-000000000000",
      },
    ];
    render(<TasksBoard />);

    expect(screen.getByText(/Member 2f4a1c\b/)).toBeInTheDocument();
    expect(screen.queryByText(/2f4a1c9d-0000/)).toBeNull();
  });
});

describe("TasksBoard point reward guard (#2206)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tasksRef.current = TASKS;
    currentUserRef.current = { id: ME };
    chapter.active();
  });

  // The row needs a title, an assignee and a due date before it submits.
  async function openCreate() {
    render(<TasksBoard />);
    await userEvent.click(trigger());
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Order the composites" },
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Assignee" }));
    await userEvent.click(screen.getByRole("option", { name: "Cole Martin" }));
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-12-01" },
    });
    return screen.getByLabelText(/^points \(optional\)$/i);
  }

  it("keeps the last whole number through a negative or a decimal", async () => {
    const input = await openCreate();
    expectRefusedEntriesKeep(input, "7");
  });

  it("reads an emptied or unparseable field as no reward", async () => {
    const input = await openCreate();
    expectClearingEntriesEmpty(input, "7");
  });

  it("sends the kept whole number, never NaN or Infinity", async () => {
    const input = await openCreate();
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.submit(addForm());

    await waitFor(() => expect(createTaskMutate).toHaveBeenCalledTimes(1));
    expect(createTaskMutate.mock.calls[0]![0].point_reward).toBe(7);
  });

  it("omits the reward when the field is left empty", async () => {
    const input = await openCreate();
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.submit(addForm());

    await waitFor(() => expect(createTaskMutate).toHaveBeenCalledTimes(1));
    expect(createTaskMutate.mock.calls[0]![0].point_reward).toBeUndefined();
  });
});

describe("TasksBoard flush layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tasksRef.current = TASKS;
    currentUserRef.current = { id: ME };
    chapter.active();
  });

  it("draws each column as a labelled section on the page surface", () => {
    const { container } = render(<TasksBoard />);

    for (const [name, count] of [
      ["To do", "1"],
      ["In progress", "1"],
      ["Waiting on an officer", "1"],
      ["Overdue", "0"],
    ] as const) {
      const section = screen.getByRole("region", { name });
      expect(within(section).getByText(count)).toBeInTheDocument();
    }
    expect(
      within(screen.getByRole("region", { name: "Overdue" })).getByText(
        "Nothing overdue",
      ),
    ).toBeInTheDocument();
    expect(cardFilledContainers(container)).toEqual([]);
  });

  it("drops the narration the board used to carry", () => {
    render(<TasksBoard />);

    expect(screen.queryByText(/admins create and confirm/i)).toBeNull();
    expect(screen.queryByText(/assignee is working on it/i)).toBeNull();
    expect(screen.queryByText(/another admin has to/i)).toBeNull();
  });

  it("prints the due date in the house shape, never a numeric date", () => {
    tasksRef.current = [
      { ...TASKS[0], due_date: "2020-01-01", status: "OVERDUE" as const },
    ];
    render(<TasksBoard />);

    const due = screen.getByText(/^Overdue by \d+ days$/);
    expect(due).toHaveClass("text-destructive-text");
    expect(screen.queryByText(/\d+\/\d+\/\d{4}/)).toBeNull();
  });

  it("keeps the columns at zero for an officer, on the page surface", () => {
    tasksRef.current = [];
    const { container } = render(<TasksBoard />);

    for (const name of [
      "To do",
      "In progress",
      "Waiting on an officer",
      "Overdue",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }
    // The add row is where the first tile lands, in place of "No tasks".
    const todo = screen.getByRole("region", { name: "To do" });
    expect(
      within(todo).getByRole("button", { name: /^add a task$/i }),
    ).toBeInTheDocument();
    expect(within(todo).queryByText("No tasks")).toBeNull();
    expect(screen.queryByRole("heading", { name: /no tasks yet/i })).toBeNull();
    expect(cardFilledContainers(container)).toEqual([]);
  });
});

describe("TasksBoard add row", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tasksRef.current = [];
    currentUserRef.current = { id: ME };
    chapter.active();
    createTaskMutate.mockResolvedValue({});
  });

  it("is the only create control: no toolbar button, no dialog", async () => {
    render(<TasksBoard />);

    expect(screen.queryByRole("button", { name: /new task/i })).toBeNull();
    await userEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(addForm()).toBeInTheDocument();
    expect(screen.getByLabelText("Task title")).toHaveFocus();
  });

  it("flags a missing assignee and due date on Enter, and sends nothing", async () => {
    render(<TasksBoard />);
    await userEvent.click(trigger());

    await userEvent.type(
      screen.getByLabelText("Task title"),
      "Order pizza{Enter}",
    );

    expect(createTaskMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Pick an assignee.")).toBeInTheDocument();
    expect(screen.getByText("Pick a due date.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Assignee" })).toHaveFocus();
  });

  it("flags nothing while typing", async () => {
    render(<TasksBoard />);
    await userEvent.click(trigger());

    await userEvent.type(screen.getByLabelText("Task title"), "Order pizza");

    expect(screen.queryByText("Pick an assignee.")).toBeNull();
    expect(screen.queryByText("Pick a due date.")).toBeNull();
  });

  it("creates on Enter once the row is complete, then clears for the next one", async () => {
    render(<TasksBoard />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("combobox", { name: "Assignee" }));
    await userEvent.click(screen.getByRole("option", { name: "Cole Martin" }));
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-12-01" },
    });

    await userEvent.type(
      screen.getByLabelText("Task title"),
      "  Order pizza  {Enter}",
    );

    await waitFor(() => expect(createTaskMutate).toHaveBeenCalledTimes(1));
    expect(createTaskMutate.mock.calls[0]![0]).toEqual({
      title: "Order pizza",
      description: undefined,
      assignee_id: "u-other",
      due_date: "2026-12-01",
      point_reward: undefined,
    });
    // Still open, emptied and focused, for the next task.
    await waitFor(() =>
      expect(screen.getByLabelText("Task title")).toHaveValue(""),
    );
    expect(screen.getByLabelText("Task title")).toHaveFocus();
    expect(screen.getByLabelText("Due date")).toHaveValue("");
  });

  it("takes the due date as a typed month and day, with no year to set (#3928)", async () => {
    render(<TasksBoard />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("combobox", { name: "Assignee" }));
    await userEvent.click(screen.getByRole("option", { name: "Cole Martin" }));
    const due = screen.getByLabelText("Due date");
    // Not the browser's date input, which shows and asks for MM/DD/YYYY.
    expect(due).toHaveAttribute("type", "text");
    await userEvent.type(due, "12/31");
    await userEvent.type(
      screen.getByLabelText("Task title"),
      "Order pizza{Enter}",
    );

    await waitFor(() => expect(createTaskMutate).toHaveBeenCalledTimes(1));
    const sent = createTaskMutate.mock.calls[0]![0] as { due_date: string };
    // The next December 31st: this year's, whatever year the suite runs in.
    expect(sent.due_date).toBe(`${new Date().getFullYear()}-12-31`);
  });

  it("focuses the due field when it is the one thing missing", async () => {
    render(<TasksBoard />);
    await userEvent.click(trigger());
    await userEvent.click(screen.getByRole("combobox", { name: "Assignee" }));
    await userEvent.click(screen.getByRole("option", { name: "Cole Martin" }));
    await userEvent.type(
      screen.getByLabelText("Task title"),
      "Order pizza{Enter}",
    );

    expect(await screen.findByText("Pick a due date.")).toBeInTheDocument();
    expect(screen.getByLabelText("Due date")).toHaveFocus();
    expect(createTaskMutate).not.toHaveBeenCalled();
  });

  it("keeps what was typed when the create fails", async () => {
    createTaskMutate.mockRejectedValueOnce(new Error("nope"));
    await openRowWithEverything();
    fireEvent.submit(addForm());

    await waitFor(() => expect(createTaskMutate).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText("Task title")).toHaveValue("Order pizza");
  });

  it("puts focus back on a blank title instead of sending it", async () => {
    await openRowWithEverything();
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "   " },
    });
    fireEvent.submit(addForm());

    expect(createTaskMutate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Task title")).toHaveFocus();
  });

  it("closes only the list on Escape inside the assignee picker", async () => {
    render(<TasksBoard />);
    await userEvent.click(trigger());
    await userEvent.type(screen.getByLabelText("Task title"), "Order pizza");
    await userEvent.click(screen.getByRole("combobox", { name: "Assignee" }));
    expect(screen.getByRole("option", { name: "Cole Martin" })).toBeVisible();

    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("option", { name: "Cole Martin" })).toBeNull();
    expect(addForm()).toBeInTheDocument();
    expect(screen.getByLabelText("Task title")).toHaveValue("Order pizza");
  });

  it("closes on Escape and hands focus back to the row", async () => {
    render(<TasksBoard />);
    await userEvent.click(trigger());
    await userEvent.type(screen.getByLabelText("Task title"), "Order{Escape}");

    expect(screen.queryByRole("form", { name: /add a task/i })).toBeNull();
    await waitFor(() => expect(trigger()).toHaveFocus());
    // Reopening starts blank.
    await userEvent.click(trigger());
    expect(screen.getByLabelText("Task title")).toHaveValue("");
  });

  it("stays at the top of To do once the column has tiles", () => {
    tasksRef.current = TASKS;
    render(<TasksBoard />);

    const todo = screen.getByRole("region", { name: "To do" });
    const row = within(todo).getByRole("button", { name: /^add a task$/i });
    const tile = within(todo).getByText("Sweep the chapter room");
    expect(
      row.compareDocumentPosition(tile) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("isn't offered without tasks:manage", () => {
    permissionsRef.current = ["members:view"];
    tasksRef.current = TASKS.slice(0, 2);
    render(<TasksBoard />);

    expect(screen.queryByRole("button", { name: /^add a task$/i })).toBeNull();
    expect(
      within(screen.getByRole("region", { name: "To do" })).queryByText(
        "No tasks",
      ),
    ).toBeNull();
  });

  async function openRowWithEverything() {
    render(<TasksBoard />);
    await userEvent.click(trigger());
    fireEvent.change(screen.getByLabelText("Task title"), {
      target: { value: "Order pizza" },
    });
    await userEvent.click(screen.getByRole("combobox", { name: "Assignee" }));
    await userEvent.click(screen.getByRole("option", { name: "Cole Martin" }));
    fireEvent.change(screen.getByLabelText("Due date"), {
      target: { value: "2026-12-01" },
    });
  }
});

describe("TasksBoard member with nothing assigned", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tasksRef.current = [];
    currentUserRef.current = { id: ME };
    permissionsRef.current = ["members:view"];
    chapter.active();
  });

  const inDays = (days: number, hour = 19) => {
    const at = new Date();
    at.setDate(at.getDate() + days);
    at.setHours(hour, 0, 0, 0);
    return at.toISOString();
  };

  it("sees one line naming the next event instead of four empty columns", () => {
    eventsRef.current = [
      { id: "e-later", name: "Formal", start_time: inDays(20) },
      { id: "e-past", name: "Last week's meeting", start_time: inDays(-7) },
      { id: "e-next", name: "Chapter meeting", start_time: inDays(1) },
    ];
    render(<TasksBoard />);

    expect(
      screen.getByText(
        /^Nothing on your plate\. Next up: Chapter meeting, Tomorrow · 7:00\sPM\.$/,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "To do" })).toBeNull();
  });

  it("stops at the first sentence with nothing ahead", () => {
    eventsRef.current = [
      { id: "e-past", name: "Last week's meeting", start_time: inDays(-7) },
    ];
    render(<TasksBoard />);

    expect(screen.getByText("Nothing on your plate.")).toBeInTheDocument();
  });

  it("doesn't read events when the chapter turned Events off", () => {
    eventsModuleOn.current = false;
    eventsRef.current = [
      { id: "e-next", name: "Chapter meeting", start_time: inDays(1) },
    ];
    render(<TasksBoard />);

    expect(screen.getByText("Nothing on your plate.")).toBeInTheDocument();
    expect(eventsEnabled.every((enabled) => !enabled)).toBe(true);
  });

  it("keeps the board for a member who has tasks, and doesn't read events", () => {
    tasksRef.current = TASKS.slice(0, 2);
    render(<TasksBoard />);

    expect(screen.getByRole("region", { name: "To do" })).toBeInTheDocument();
    expect(screen.queryByText(/nothing on your plate/i)).toBeNull();
    expect(eventsEnabled.every((enabled) => !enabled)).toBe(true);
  });

  it("keeps the columns, and says why, when the permissions read failed", () => {
    // Not the loading window: nothing would ever answer it, so a blank page
    // here would stay blank (#1211's pattern).
    permissionsRef.current = undefined;
    permissionsFailed.current = true;
    render(<TasksBoard />);

    const todo = screen.getByRole("region", { name: "To do" });
    expect(
      within(todo).getByText("Permissions unavailable"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/nothing on your plate/i)).toBeNull();
  });

  it("never flashes the line at an officer while permissions load", () => {
    permissionsRef.current = undefined;
    render(<TasksBoard />);

    expect(screen.queryByText(/nothing on your plate/i)).toBeNull();
    expect(screen.queryByRole("region", { name: "To do" })).toBeNull();
  });
});

describe("TasksBoard editing a task (#4296)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
    tasksRef.current = TASKS;
    currentUserRef.current = { id: ME };
    updateTaskMutate.mockResolvedValue(undefined);
  });

  it("turns the tile into the task form and saves only what changed", async () => {
    const user = userEvent.setup();
    render(<TasksBoard />);

    await user.click(
      screen.getByRole("button", { name: "Edit Sweep the chapter room" }),
    );
    const editor = screen.getByRole("listitem", {
      name: "Editing Sweep the chapter room",
    });
    const title = within(editor).getByLabelText("Title");
    expect(title).toHaveFocus();
    await user.clear(title);
    await user.type(title, "Sweep and mop the chapter room");
    await user.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateTaskMutate).toHaveBeenCalledWith({
        id: "task-todo",
        body: { title: "Sweep and mop the chapter room" },
      }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("listitem", { name: /^editing/i }),
      ).not.toBeInTheDocument(),
    );
  });

  it("sends nothing when nothing changed", async () => {
    const user = userEvent.setup();
    render(<TasksBoard />);

    await user.click(
      screen.getByRole("button", { name: "Edit Sweep the chapter room" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(updateTaskMutate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("listitem", { name: /^editing/i }),
    ).not.toBeInTheDocument();
  });

  it("keeps the form open when the save fails", async () => {
    updateTaskMutate.mockRejectedValue(new Error("down"));
    const user = userEvent.setup();
    render(<TasksBoard />);

    await user.click(
      screen.getByRole("button", { name: "Edit Sweep the chapter room" }),
    );
    const title = screen.getByLabelText("Title");
    await user.type(title, "!");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateTaskMutate).toHaveBeenCalled());
    expect(
      screen.getByRole("listitem", { name: /^editing/i }),
    ).toBeInTheDocument();
  });

  it("puts Cancel back to the tile without saving", async () => {
    const user = userEvent.setup();
    render(<TasksBoard />);

    await user.click(
      screen.getByRole("button", { name: "Edit Draft the rush calendar" }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(updateTaskMutate).not.toHaveBeenCalled();
    expect(screen.getByText("Draft the rush calendar")).toBeInTheDocument();
  });

  it("puts the tile back on Escape", async () => {
    const user = userEvent.setup();
    render(<TasksBoard />);

    await user.click(
      screen.getByRole("button", { name: "Edit Sweep the chapter room" }),
    );
    await user.keyboard("{Escape}");

    expect(updateTaskMutate).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("listitem", { name: /^editing/i }),
    ).not.toBeInTheDocument();
  });

  it("offers no Edit without tasks:manage, or on a confirmed task", () => {
    tasksRef.current = [
      ...TASKS,
      {
        ...TASKS[2],
        id: "task-confirmed",
        title: "Order the composites",
        points_awarded: true,
        confirmed_at: "2026-08-11T00:00:00Z",
      },
    ];
    const { unmount } = render(<TasksBoard />);
    expect(
      screen.queryByRole("button", { name: "Edit Order the composites" }),
    ).not.toBeInTheDocument();
    unmount();

    permissionsRef.current = [];
    render(<TasksBoard />);
    expect(
      screen.queryByRole("button", { name: /^edit /i }),
    ).not.toBeInTheDocument();
  });
});
