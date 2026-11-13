import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { TaskCard } from "./task-card";
import type { ChatMessage } from "@repo/chat-core/types";
import { chapterSubscription } from "@/tests/chapter-subscription";

// ── Mocks ────────────────────────────────────────────────────────────────
// The card is hook-driven (unlike the props-only settings tabs), so we stub
// the data layer and the permission gate to isolate the rendering + gating.

const mockUseTask = vi.fn();
const mockCurrentChapter = vi.fn();
// `mutate`, not `mutateAsync`: the card no longer awaits these. The optimistic
// write and its rollback live in the shared hooks (#560), so the card fires and
// forgets, passing only its per-call error copy as the second argument.
const updateStatus = vi.fn();
const confirmTask = vi.fn();
const rejectTask = vi.fn();
// Send back awaits its write so its sheet can say why it failed (#4635).
const rejectTaskAsync = vi.fn();
const updateTask = vi.fn();

const { mockOffline } = vi.hoisted(() => ({
  mockOffline: { value: false },
}));

vi.mock("@/lib/providers/network-provider", async () => {
  const { networkMock } = await import("@/tests/network");
  return networkMock(mockOffline);
});

vi.mock("@repo/hooks", async (importOriginal) => ({
  // The shared card rules (`taskCardControls`, `readLiveTask`, the labels) stay
  // real, so these cases test the rules the mobile card applies too.
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  // Task photos (#4565): no photo reads or uploads in these cases.
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useTaskPhotoUrl: () => ({ data: undefined }),
  // The real hook is disabled on an empty id, so an empty id reads nothing and
  // never reaches `mockUseTask`: a case can assert the card didn't ask.
  useTask: (id: string) => (id ? mockUseTask(id) : { data: undefined }),
  useUpdateTaskStatus: () => ({ mutate: updateStatus, isPending: false }),
  useConfirmTask: () => ({ mutate: confirmTask, isPending: false }),
  useRejectTask: () => ({
    mutate: rejectTask,
    mutateAsync: rejectTaskAsync,
    isPending: false,
  }),
  // The edit form's writes and roster (#4512).
  useUpdateTask: () => ({ mutateAsync: updateTask, isPending: false }),
  useSetSubtaskDone: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSubtask: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteSubtask: () => ({ mutate: vi.fn(), isPending: false }),
  useMembers: () => ({
    data: [
      { user_id: "assignee-1", display_name: "Bob" },
      { user_id: "admin-1", display_name: "Alice" },
    ],
  }),
  // The card's task routes are paid-ops, so it now reads the chapter's
  // subscription (#841). Default every existing case to an active chapter so
  // they assert the same behaviour they always did.
  useCurrentChapter: () => mockCurrentChapter(),
  // Driven by the same `canManage` flag as the <Can> stub below, so the notice's
  // visibility and the buttons' visibility can never disagree in a test.
  useMyPermissions: () => ({
    data: { permissions: canManage ? ["tasks:manage"] : [] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// `canManage` flips whether <Can permission="tasks:manage"> renders its children.
// `gateMounts` records each mount, so a case can tell the card handed a control
// to the gate (whose offline branch `can-fallback.spec.tsx` covers) from one
// that never drew it.
let canManage = false;
const gateMounts: string[] = [];
vi.mock("@/components/shared/can", () => ({
  Can: ({
    children,
    permission,
  }: {
    children: ReactNode;
    permission: string;
  }) => {
    gateMounts.push(permission);
    return canManage ? <>{children}</> : null;
  },
}));

const ASSIGNEE = "assignee-1";

/** `GET /v1/tasks/{id}` for the card's task, freshly assigned. */
function liveTask(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      id: "task-1",
      status: "TODO",
      stored_status: "TODO",
      points_awarded: false,
      // Points mean a completion waits on an officer's sign-off (#4635).
      point_reward: 10,
      ...overrides,
    },
  };
}

function makeMessage(overrides: Record<string, unknown> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "ch-1",
    sender_id: "admin-1",
    content: 'Assigned "Clean the house" to Bob (due 2026-06-15)',
    kind: "task",
    is_deleted: false,
    payload: {
      task_id: "task-1",
      title: "Clean the house",
      assigner_user_id: "admin-1",
      assigner_name: "Alice",
      assignee_user_id: ASSIGNEE,
      assignee_name: "Bob",
      due_date: "2026-06-15",
      status: "TODO",
      point_reward: 10,
      created_at: "2026-05-31T00:00:00.000Z",
      ...overrides,
    },
  } as unknown as ChatMessage;
}

const chapter = chapterSubscription(mockCurrentChapter);

describe("TaskCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    canManage = false;
    mockUseTask.mockReturnValue(liveTask());
    chapter.active();
  });

  it("renders the assignment snapshot (title, names, due, points)", () => {
    render(<TaskCard message={makeMessage()} viewerId="someone" isConfirmed />);
    expect(screen.getByText("Clean the house")).toBeInTheDocument();
    expect(screen.getByText(/Alice → Bob/)).toBeInTheDocument();
    expect(screen.getByText(/\+10 pts/)).toBeInTheDocument();
  });

  it("falls back to the content string on a malformed payload", () => {
    const message = makeMessage();
    (message as { payload: unknown }).payload = { nonsense: true };
    render(<TaskCard message={message} viewerId="someone" isConfirmed />);
    expect(
      screen.getByText(/Assigned "Clean the house" to Bob/),
    ).toBeInTheDocument();
  });

  it("shows Start to the assignee on a TODO task and dispatches IN_PROGRESS", () => {
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    const start = screen.getByRole("button", { name: /start/i });
    fireEvent.click(start);
    expect(updateStatus).toHaveBeenCalledWith(
      { id: "task-1", body: { status: "IN_PROGRESS" } },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
  });

  it("hides assignee actions from a non-assignee", () => {
    render(<TaskCard message={makeMessage()} viewerId="other" isConfirmed />);
    expect(
      screen.queryByRole("button", { name: /start/i }),
    ).not.toBeInTheDocument();
  });

  it("offers no action and no badge until the live task is read (#2065)", () => {
    // The payload says TODO forever. Drawing Start off it offered the move on
    // tasks already in progress or done, which the server then refused.
    mockUseTask.mockReturnValue({ data: undefined });
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByText("To do")).not.toBeInTheDocument();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("doesn't ask for a task the viewer can't read, and shows no status", () => {
    // `GET /v1/tasks/{id}` answers only the assignee and a tasks:manage holder,
    // so for anyone else the request is a guaranteed 403.
    render(<TaskCard message={makeMessage()} viewerId="other" isConfirmed />);
    expect(mockUseTask).not.toHaveBeenCalled();
    expect(screen.queryByText("To do")).not.toBeInTheDocument();
  });

  it("badges a confirmed completion as Confirmed, not still awaiting it", () => {
    mockUseTask.mockReturnValue(
      liveTask({
        status: "COMPLETED",
        stored_status: "COMPLETED",
        points_awarded: true,
      }),
    );
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    expect(screen.queryByText("Waiting on an officer")).not.toBeInTheDocument();
  });

  it("badges the live status for a viewer who can read it", () => {
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(mockUseTask).toHaveBeenCalledWith("task-1");
    expect(screen.getByText("To do")).toBeInTheDocument();
  });

  it("reflects the live status over the snapshot (IN_PROGRESS → Mark done)", () => {
    mockUseTask.mockReturnValue({
      data: { id: "task-1", status: "IN_PROGRESS", points_awarded: false },
    });
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(
      screen.getByRole("button", { name: /mark done/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /start/i }),
    ).not.toBeInTheDocument();
  });

  // Both of these render the Overdue badge; only `stored_status` says which
  // transition is legal, which is the whole point of #1051. Before it, neither
  // offered any action and the task could never be moved.
  it("offers Start on an overdue task whose stored status is TODO", () => {
    mockUseTask.mockReturnValue({
      data: {
        id: "task-1",
        status: "OVERDUE",
        stored_status: "TODO",
        points_awarded: false,
      },
    });
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /mark done/i }),
    ).not.toBeInTheDocument();
  });

  it("offers Mark done on an overdue task whose stored status is IN_PROGRESS", () => {
    mockUseTask.mockReturnValue({
      data: {
        id: "task-1",
        status: "OVERDUE",
        stored_status: "IN_PROGRESS",
        points_awarded: false,
      },
    });
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /mark done/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /start/i }),
    ).not.toBeInTheDocument();
  });

  it("offers no action on an overdue task from an API that sends no stored_status", () => {
    // Back-compat: without the field the card falls back to `status`, which
    // matches no branch — the pre-#1051 behaviour, and better than guessing a
    // transition the server would reject.
    mockUseTask.mockReturnValue({
      data: { id: "task-1", status: "OVERDUE", points_awarded: false },
    });
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    // No action at all, not merely no Start — asserting only the latter would
    // still pass if the fallback guessed "IN_PROGRESS" and offered Mark
    // complete, which the server would reject.
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("offers Start on a task whose stored status is literally OVERDUE", () => {
    // `tasks.status` permits OVERDUE and the scheduled-jobs sweep queries for
    // it, so persisted-OVERDUE rows exist. The server accepts
    // OVERDUE → IN_PROGRESS, which is the move Start makes.
    mockUseTask.mockReturnValue({
      data: {
        id: "task-1",
        status: "OVERDUE",
        stored_status: "OVERDUE",
        points_awarded: false,
      },
    });
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(screen.getByRole("button", { name: /start/i })).toBeInTheDocument();
  });

  it("offers Confirm/Send back to an admin on a COMPLETED task", () => {
    canManage = true;
    mockUseTask.mockReturnValue({
      data: {
        id: "task-1",
        status: "COMPLETED",
        points_awarded: false,
        point_reward: 10,
      },
    });
    render(<TaskCard message={makeMessage()} viewerId="other" isConfirmed />);
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(confirmTask).toHaveBeenCalledWith(
      "task-1",
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(
      screen.getByRole("button", { name: /send back/i }),
    ).toBeInTheDocument();
  });

  it("hides Confirm from a tasks:manage assignee on their own card (#1056)", () => {
    // The API refuses a self-confirmation, so the assignee gets no confirm
    // affordance here even holding tasks:manage. Send back survives — it withholds
    // points rather than awarding them — so the card still shows an action.
    canManage = true;
    mockUseTask.mockReturnValue({
      data: {
        id: "task-1",
        status: "COMPLETED",
        points_awarded: false,
        point_reward: 10,
      },
    });
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );

    expect(
      screen.queryByRole("button", { name: /confirm/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send back/i }),
    ).toBeInTheDocument();
  });

  it("keeps the disabled Confirmed indicator for an assignee-admin", () => {
    // Once another admin confirms, the assignee-admin must still be able to see
    // that it happened. The button is disabled and reads "Confirmed", so it
    // reports state rather than offering the refused action — and it is what
    // keeps the card from rendering a lone SubscriptionNotice on a lapsed
    // chapter, which is why the subscription is inactive here.
    chapter.incomplete();
    canManage = true;
    mockUseTask.mockReturnValue({
      data: {
        id: "task-1",
        status: "COMPLETED",
        points_awarded: true,
        point_reward: 10,
      },
    });
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );

    const confirmed = screen.getByRole("button", { name: /confirmed/i });
    expect(confirmed).toBeInTheDocument();
    expect(confirmed).toBeDisabled();
    // Send back is gone once points are awarded — that gate is pre-existing.
    expect(
      screen.queryByRole("button", { name: /send back/i }),
    ).not.toBeInTheDocument();
  });

  it("leaves the admin controls to the permission gate, not a plain denial", () => {
    // An assignee's task is read whatever their permissions, so when the check
    // can't run (offline, nothing cached) the gate must get the chance to say
    // so with its offline chip, rather than the card dropping Send back unseen
    // (design-system README §4, §5 rule 4). Denied here: the row is left
    // empty, and `empty:hidden` keeps it from adding its margin. jsdom applies
    // no Tailwind, so the spec pins the class and the emptiness, not the CSS.
    // The chapter has lapsed so that the notice, which belongs to controls the
    // viewer holds, would show up here if it ever stopped being guarded.
    chapter.incomplete();
    gateMounts.length = 0;
    mockUseTask.mockReturnValue(
      liveTask({ status: "COMPLETED", stored_status: "COMPLETED" }),
    );
    const { container } = render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );

    expect(gateMounts).toContain("tasks:manage");
    expect(
      screen.queryByRole("button", { name: /send back/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const row = container.querySelector('[class~="empty:hidden"]');
    expect(row).not.toBeNull();
    expect(row).toBeEmptyDOMElement();
  });

  it("disables actions while the chat row is unconfirmed", () => {
    render(
      <TaskCard
        message={makeMessage()}
        viewerId={ASSIGNEE}
        isConfirmed={false}
      />,
    );
    expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();
  });
});

describe("TaskCard subscription gating", () => {
  // The card lives in chat, which is `@FreeTier`, but its buttons call
  // `task.controller.ts`, which is paid-ops. The host surface does not decide
  // the gate — the route does (#841).
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    canManage = false;
    mockUseTask.mockReturnValue(liveTask());
  });

  it("disables the assignee's action and explains why on a lapsed chapter", () => {
    chapter.incomplete();
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );

    expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();
    expect(screen.getByText(/subscription is not active/i)).toBeInTheDocument();
  });

  it("ties the disabled action to its explanation", () => {
    chapter.incomplete();
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );

    const describedBy = screen
      .getByRole("button", { name: /start/i })
      .getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent(
      /subscription is not active/i,
    );
  });

  it("leaves the action alone on an active chapter", () => {
    chapter.active();
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );

    expect(screen.getByRole("button", { name: /start/i })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    chapter.unreadable();
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );

    expect(screen.getByRole("button", { name: /start/i })).toBeEnabled();
  });

  it("keeps the notice off cards that offer this viewer no action", () => {
    // A timeline would otherwise repeat one chapter-wide sentence under every
    // task card, including ones the viewer could never act on.
    chapter.incomplete();
    render(
      <TaskCard message={makeMessage()} viewerId="someone-else" isConfirmed />,
    );

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("disables card actions while OFFLINE without a per-card notice", () => {
    // Finding 4: the buttons are queueless POSTs so they disable, but the
    // transcript must not sprout one SubscriptionNotice per message. The
    // composer is the outbox carve-out and is not this card.
    chapter.active();
    mockOffline.value = true;
    render(
      <>
        <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />
        <TaskCard
          message={{ ...makeMessage(), id: "msg-2" }}
          viewerId={ASSIGNEE}
          isConfirmed
        />
      </>,
    );

    const starts = screen.getAllByRole("button", { name: /start/i });
    expect(starts).toHaveLength(2);
    for (const start of starts) {
      expect(start).toBeDisabled();
      expect(start).toHaveAttribute("title", "Reconnect to make changes.");
      expect(start).not.toHaveAttribute("aria-describedby");
    }
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

// #4133 / #4135: the badge is the phone's colour, never the chapter accent,
// and the due line is the shared countdown, read off the live due date.
describe("TaskCard status colour and due line", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canManage = false;
    chapter.active();
    mockUseTask.mockReturnValue(liveTask());
    vi.useFakeTimers({ toFake: ["Date"] });
    // Sat Jun 13, 2026, noon local: the snapshot's Jun 15 is two days out.
    vi.setSystemTime(new Date(2026, 5, 13, 12));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["TODO", false, "To do", "border-border"],
    ["IN_PROGRESS", false, "In progress", "bg-info-tint"],
    ["COMPLETED", false, "Waiting on an officer", "bg-warning-tint"],
    ["COMPLETED", true, "Confirmed", "bg-success-tint"],
    ["OVERDUE", false, "Overdue", "bg-destructive-tint"],
  ])(
    "draws %s (awarded %s) as %s in %s, never the accent",
    (status, awarded, label, cls) => {
      mockUseTask.mockReturnValue(
        liveTask({ status, stored_status: status, points_awarded: awarded }),
      );
      render(
        <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
      );
      const badge = screen.getByText(label);
      expect(badge).toHaveClass(cls);
      expect(badge).not.toHaveClass("bg-accent-subtle");
    },
  );

  it("counts down to the due date while the task is open", () => {
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(screen.getByText("Due Monday")).toBeInTheDocument();
  });

  it("reads the live due date over the snapshot's, so a moved task isn't called late", () => {
    vi.setSystemTime(new Date(2026, 5, 17, 12));
    mockUseTask.mockReturnValue(liveTask({ due_date: "2026-06-25" }));
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(screen.getByText("Due Jun 25")).toBeInTheDocument();
    expect(screen.queryByText(/Overdue by/)).not.toBeInTheDocument();
  });

  it("draws an overdue due line in the lifted danger tone", () => {
    vi.setSystemTime(new Date(2026, 5, 17, 12));
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(screen.getByText("Overdue by 2 days")).toHaveClass(
      "text-destructive-text",
    );
  });

  it("gives a viewer who can't read the task the plain date", () => {
    render(<TaskCard message={makeMessage()} viewerId="someone" isConfirmed />);
    expect(screen.getByText("Due Jun 15")).toBeInTheDocument();
  });
});

describe("TaskCard Edit (#4512)", () => {
  /** The live task as the edit form needs it. */
  const editable = (overrides: Record<string, unknown> = {}) =>
    liveTask({
      title: "Clean the house",
      description: null,
      assignee_id: ASSIGNEE,
      due_date: "2026-06-15",
      due_at: null,
      point_reward: 10,
      subtasks: [],
      ...overrides,
    });
  const edit = () =>
    screen.queryByRole("button", { name: "Edit Clean the house" });

  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    canManage = true;
    mockUseTask.mockReturnValue(editable());
    chapter.active();
  });

  it("opens the board's edit form in the card's place, and Cancel puts it back", () => {
    render(<TaskCard message={makeMessage()} viewerId="admin-1" isConfirmed />);
    fireEvent.click(edit()!);
    expect(
      screen.getByRole("group", { name: "Editing Clean the house" }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Clean the house");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Clean the house")).toBeInTheDocument();
    expect(edit()).toBeInTheDocument();
  });

  it("saves only what changed", async () => {
    updateTask.mockResolvedValue({});
    render(<TaskCard message={makeMessage()} viewerId="admin-1" isConfirmed />);
    fireEvent.click(edit()!);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Clean the kitchen" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith({
        id: "task-1",
        body: { title: "Clean the kitchen" },
      }),
    );
  });

  it("isn't offered to a member without tasks:manage", () => {
    canManage = false;
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(edit()).toBeNull();
  });

  it("puts the card back on Escape, and claims Escape from a panel around it", () => {
    render(<TaskCard message={makeMessage()} viewerId="admin-1" isConfirmed />);
    fireEvent.click(edit()!);
    const form = screen.getByRole("group", { name: "Editing Clean the house" });
    expect(form).toHaveAttribute("data-owns-escape");
    fireEvent.keyDown(screen.getByLabelText("Title"), { key: "Escape" });
    expect(screen.queryByRole("group", { name: /Editing/ })).toBeNull();
    expect(edit()).toBeInTheDocument();
  });

  it("holds Edit until the card's message is acknowledged", () => {
    render(
      <TaskCard
        message={makeMessage()}
        viewerId="admin-1"
        isConfirmed={false}
      />,
    );
    expect(edit()).toBeDisabled();
  });

  it("isn't offered while the chapter has Tasks turned off", () => {
    mockCurrentChapter.mockReturnValue({
      data: {
        subscription_status: "active",
        enabled_modules: { tasks: false },
      },
      isPending: false,
      isError: false,
    });
    render(<TaskCard message={makeMessage()} viewerId="admin-1" isConfirmed />);
    expect(edit()).toBeNull();
  });

  it("isn't offered on a confirmed task", () => {
    mockUseTask.mockReturnValue(
      editable({
        status: "COMPLETED",
        stored_status: "COMPLETED",
        points_awarded: true,
      }),
    );
    render(<TaskCard message={makeMessage()} viewerId="admin-1" isConfirmed />);
    expect(edit()).toBeNull();
  });
});

// #4635: decision C, Send back's reason, and what the card shows of proof.
describe("TaskCard proof and send back (#4635)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOffline.value = false;
    canManage = false;
    chapter.active();
  });

  it("shows a no-points, no-proof completion as Done, with only Send back to an officer", () => {
    canManage = true;
    mockUseTask.mockReturnValue(
      liveTask({
        status: "COMPLETED",
        stored_status: "COMPLETED",
        // Confirmed by the server as it was marked done (decision C),
        // stamped with the completion's own time.
        points_awarded: true,
        point_reward: null,
        proof_kind: "none",
        completed_at: "2026-11-13T10:00:00.000Z",
        confirmed_at: "2026-11-13T10:00:00.000Z",
      }),
    );
    render(
      <TaskCard
        message={makeMessage({ point_reward: null })}
        viewerId="other"
        isConfirmed
      />,
    );
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Confirmed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /confirm/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /send back/i }),
    ).toBeInTheDocument();
  });

  it("still waits on an officer for a no-points task that asks for a photo", () => {
    canManage = true;
    mockUseTask.mockReturnValue(
      liveTask({
        status: "COMPLETED",
        stored_status: "COMPLETED",
        point_reward: null,
        proof_kind: "photo",
      }),
    );
    render(<TaskCard message={makeMessage()} viewerId="other" isConfirmed />);
    expect(screen.getByText("Waiting on an officer")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^confirm$/i }),
    ).toBeInTheDocument();
  });

  it("sends back only with a reason, through the awaited write", async () => {
    canManage = true;
    rejectTaskAsync.mockResolvedValue({});
    mockUseTask.mockReturnValue(
      liveTask({ status: "COMPLETED", stored_status: "COMPLETED" }),
    );
    render(<TaskCard message={makeMessage()} viewerId="other" isConfirmed />);
    fireEvent.click(screen.getByRole("button", { name: /send back/i }));
    const dialog = await screen.findByRole("dialog", { name: "Send back" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    expect(
      await within(dialog).findByText("Say what needs to change."),
    ).toBeInTheDocument();
    expect(rejectTaskAsync).not.toHaveBeenCalled();

    fireEvent.change(within(dialog).getByLabelText("What needs to change"), {
      target: { value: "Missing the back porch" },
    });
    fireEvent.click(
      within(dialog).getByRole("switch", { name: "Ask for a photo next time" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Send back" }));
    await waitFor(() =>
      expect(rejectTaskAsync).toHaveBeenCalledWith({
        id: "task-1",
        body: { comment: "Missing the back porch", require_photo: true },
      }),
    );
    // The fire-and-forget write is no longer how a card sends back.
    expect(rejectTask).not.toHaveBeenCalled();
  });

  it("offers no Ask for a photo on a task that already asks for one", async () => {
    canManage = true;
    mockUseTask.mockReturnValue(
      liveTask({
        status: "COMPLETED",
        stored_status: "COMPLETED",
        proof_kind: "photo",
      }),
    );
    render(<TaskCard message={makeMessage()} viewerId="other" isConfirmed />);
    fireEvent.click(screen.getByRole("button", { name: /send back/i }));
    const dialog = await screen.findByRole("dialog", { name: "Send back" });
    expect(
      within(dialog).queryByRole("switch", {
        name: "Ask for a photo next time",
      }),
    ).toBeNull();
  });

  it("badges a sent-back task Needs changes and shows the reason to its assignee", () => {
    mockUseTask.mockReturnValue(
      liveTask({
        status: "IN_PROGRESS",
        stored_status: "IN_PROGRESS",
        sent_back_at: "2026-06-14T00:00:00Z",
        sent_back_reason: "Missing the back porch",
      }),
    );
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(screen.getByText("Needs changes")).toBeInTheDocument();
    expect(screen.getByText("Missing the back porch")).toBeInTheDocument();
  });
});
