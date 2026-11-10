import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { formatDueEntry } from "@repo/formatting";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";

const { mockCurrentChapter, mockToast } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockToast: vi.fn(),
}));

const MEMBERS_QUERY = {
  data: [
    { user_id: "u-1", display_name: "Rush Chair" },
    { user_id: "u-2", display_name: "Social Chair" },
  ],
};

vi.mock("@repo/hooks", () => ({
  useCurrentChapter: () => mockCurrentChapter(),
  useMembers: () => MEMBERS_QUERY,
}));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/components/shared/can", () => ({
  Can: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const { NewTaskDialog } = await import("./new-task-dialog");

const chapter = chapterSubscription(mockCurrentChapter);

function renderDialog(
  props: Partial<React.ComponentProps<typeof NewTaskDialog>> = {},
) {
  const onOpenChange = vi.fn();
  const onPost = vi.fn().mockResolvedValue({ ok: true });
  render(
    <NewTaskDialog
      open
      onOpenChange={onOpenChange}
      onPost={onPost}
      {...props}
    />,
  );
  return { onOpenChange, onPost: (props.onPost ?? onPost) as typeof onPost };
}

const create = () => screen.getByRole("button", { name: "Create task" });

describe("NewTaskDialog (#3865)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("opens filled in with what the typed /task named", () => {
    renderDialog({
      prefill: { title: "Sweep the porch", dueDate: "2026-11-12", pointReward: 5 },
      initialAssigneeId: "u-2",
    });
    expect(screen.getByLabelText("Title")).toHaveValue("Sweep the porch");
    // Shown as a day, not the wire date; the year appears outside this one.
    expect(screen.getByLabelText("Due date")).toHaveValue(
      formatDueEntry("2026-11-12", new Date()),
    );
    expect(screen.getByLabelText("Points (optional)")).toHaveValue(5);
    expect(screen.getByLabelText("Assignee")).toHaveTextContent("Social Chair");
  });

  it("flags what's missing on submit and posts nothing", async () => {
    const { onPost } = renderDialog({ prefill: { title: "Sweep" } });
    fireEvent.click(create());
    expect(await screen.findByText("Pick an assignee.")).toBeInTheDocument();
    expect(screen.getByText("Pick a due date.")).toBeInTheDocument();
    expect(onPost).not.toHaveBeenCalled();
  });

  it("posts the task and closes", async () => {
    const { onPost, onOpenChange } = renderDialog({
      prefill: { title: "Sweep", dueDate: "2026-11-12" },
      initialAssigneeId: "u-1",
    });
    fireEvent.change(screen.getByLabelText("Description (optional)"), {
      target: { value: "Front and back" },
    });
    fireEvent.click(create());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onPost).toHaveBeenCalledWith({
      title: "Sweep",
      description: "Front and back",
      assignee_id: "u-1",
      due_date: "2026-11-12",
      point_reward: undefined,
    });
  });

  it("keeps the draft and says why when the write is refused", async () => {
    const onPost = vi
      .fn()
      .mockResolvedValue({ ok: false, error: "Assignee is not a member" });
    const { onOpenChange } = renderDialog({
      prefill: { title: "Sweep", dueDate: "2026-11-12" },
      initialAssigneeId: "u-1",
      onPost,
    });
    fireEvent.click(create());
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't create task",
          description: "Assignee is not a member",
        }),
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByLabelText("Title")).toHaveValue("Sweep");
  });

  it("says a title is too long rather than posting it cut short", async () => {
    const { onPost } = renderDialog({
      prefill: { title: "x".repeat(300), dueDate: "2026-11-12" },
      initialAssigneeId: "u-1",
    });
    fireEvent.click(create());
    expect(
      await screen.findByText(/Keep the title to 255 characters/),
    ).toBeInTheDocument();
    expect(onPost).not.toHaveBeenCalled();
  });

  it("posts once however fast Create task is pressed", async () => {
    let finish: (value: { ok: true }) => void = () => undefined;
    const onPost = vi.fn(
      () => new Promise<{ ok: true }>((resolve) => (finish = resolve)),
    );
    renderDialog({
      prefill: { title: "Sweep", dueDate: "2026-11-12" },
      initialAssigneeId: "u-1",
      onPost,
    });
    fireEvent.click(create());
    fireEvent.click(screen.getByRole("button", { name: "Creating…" }));
    fireEvent.submit(screen.getByLabelText("Title").closest("form")!);
    expect(onPost).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating…" })).toBeDisabled();
    finish({ ok: true });
    await waitFor(() => expect(onPost).toHaveBeenCalledTimes(1));
  });

  it("holds the form shut for a chapter that can't write", () => {
    chapter.incomplete();
    renderDialog({ prefill: { title: "Sweep" } });
    expect(create()).toBeDisabled();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Due date")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
