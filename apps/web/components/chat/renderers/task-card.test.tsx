import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { TaskCard } from "./task-card";
import type { ChatMessage } from "@/lib/chat/types";
import { chapterSubscription } from "@/tests/chapter-subscription";

// ── Mocks ────────────────────────────────────────────────────────────────
// The card is hook-driven (unlike the props-only settings tabs), so we stub
// the data layer and the permission gate to isolate the rendering + gating.

const mockUseTask = vi.fn();
const mockCurrentChapter = vi.fn();
const updateStatus = vi.fn().mockResolvedValue(undefined);
const confirmTask = vi.fn().mockResolvedValue(undefined);
const rejectTask = vi.fn().mockResolvedValue(undefined);

vi.mock("@repo/hooks", () => ({
  useTask: (id: string) => mockUseTask(id),
  useUpdateTaskStatus: () => ({ mutateAsync: updateStatus, isPending: false }),
  useConfirmTask: () => ({ mutateAsync: confirmTask, isPending: false }),
  useRejectTask: () => ({ mutateAsync: rejectTask, isPending: false }),
  // The card's task routes are paid-ops, so it now reads the chapter's
  // subscription (#841). Default every existing case to an active chapter so
  // they assert the same behaviour they always did.
  useCurrentChapter: () => mockCurrentChapter(),
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    getQueryData: vi.fn(),
    setQueryData: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// `canManage` flips whether <Can permission="tasks:manage"> renders its children.
let canManage = false;
vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: ReactNode }) =>
    canManage ? <>{children}</> : null,
}));

const ASSIGNEE = "assignee-1";

function makeMessage(overrides: Record<string, unknown> = {}): ChatMessage {
  return {
    id: "msg-1",
    channel_id: "ch-1",
    sender_id: "admin-1",
    content: "Assigned \"Clean the house\" to Bob (due 2026-06-15)",
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
    canManage = false;
    mockUseTask.mockReturnValue({ data: undefined });
    chapter.active();
  });

  it("renders the assignment snapshot (title, names, due, points)", () => {
    render(
      <TaskCard message={makeMessage()} viewerId="someone" isConfirmed />,
    );
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
    expect(updateStatus).toHaveBeenCalledWith({
      id: "task-1",
      body: { status: "IN_PROGRESS" },
    });
  });

  it("hides assignee actions from a non-assignee", () => {
    render(
      <TaskCard message={makeMessage()} viewerId="other" isConfirmed />,
    );
    expect(
      screen.queryByRole("button", { name: /start/i }),
    ).not.toBeInTheDocument();
  });

  it("reflects the live status over the snapshot (IN_PROGRESS → Mark complete)", () => {
    mockUseTask.mockReturnValue({
      data: { id: "task-1", status: "IN_PROGRESS", points_awarded: false },
    });
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(
      screen.getByRole("button", { name: /mark complete/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /start/i }),
    ).not.toBeInTheDocument();
  });

  it("offers no Start on a displayed-OVERDUE task (avoids an invalid transition)", () => {
    // A stored IN_PROGRESS task past its due date renders as OVERDUE; Start
    // would send IN_PROGRESS→IN_PROGRESS, which the backend rejects. Mirror the
    // dashboard: no assignee action on an overdue display.
    mockUseTask.mockReturnValue({
      data: { id: "task-1", status: "OVERDUE", points_awarded: false },
    });
    render(
      <TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />,
    );
    expect(
      screen.queryByRole("button", { name: /start/i }),
    ).not.toBeInTheDocument();
  });

  it("offers Confirm/Reject to an admin on a COMPLETED task", () => {
    canManage = true;
    mockUseTask.mockReturnValue({
      data: { id: "task-1", status: "COMPLETED", points_awarded: false },
    });
    render(<TaskCard message={makeMessage()} viewerId="other" isConfirmed />);
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));
    expect(confirmTask).toHaveBeenCalledWith("task-1");
    expect(
      screen.getByRole("button", { name: /reject/i }),
    ).toBeInTheDocument();
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
    canManage = false;
    mockUseTask.mockReturnValue({ data: undefined });
  });

  it("disables the assignee's action and explains why on a lapsed chapter", () => {
    chapter.incomplete();
    render(<TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />);

    expect(screen.getByRole("button", { name: /start/i })).toBeDisabled();
    expect(
      screen.getByText(/subscription is not active/i),
    ).toBeInTheDocument();
  });

  it("ties the disabled action to its explanation", () => {
    chapter.incomplete();
    render(<TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />);

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
    render(<TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />);

    expect(screen.getByRole("button", { name: /start/i })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("fails open when the chapter record cannot be read", () => {
    chapter.unreadable();
    render(<TaskCard message={makeMessage()} viewerId={ASSIGNEE} isConfirmed />);

    expect(screen.getByRole("button", { name: /start/i })).toBeEnabled();
  });

  it("keeps the notice off cards that offer this viewer no action", () => {
    // A timeline would otherwise repeat one chapter-wide sentence under every
    // task card, including ones the viewer could never act on.
    chapter.incomplete();
    render(<TaskCard message={makeMessage()} viewerId="someone-else" isConfirmed />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
