import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { formatDateEntry } from "@repo/formatting";
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
  // Task photos (#4565): no photo reads or uploads in these cases.
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useTaskPhotoUrl: () => ({ data: undefined }),
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

const { TaskForm, taskDraftFrom } = await import("./task-form");

const chapter = chapterSubscription(mockCurrentChapter);

function renderDialog(
  props: Partial<React.ComponentProps<typeof TaskForm>> & {
    prefill?: Parameters<typeof taskDraftFrom>[0];
    initialAssigneeId?: string;
  } = {},
) {
  const onOpenChange = vi.fn();
  const onDraftChange = vi.fn();
  const onPost = vi.fn().mockResolvedValue({ ok: true });
  const { prefill, initialAssigneeId, ...rest } = props;
  render(
    <TaskForm
      initialDraft={taskDraftFrom(prefill, initialAssigneeId)}
      onDone={() => onOpenChange(false)}
      onDiscard={vi.fn()}
      onDraftChange={onDraftChange}
      onPost={onPost}
      {...rest}
    />,
  );
  return {
    onOpenChange,
    onDraftChange,
    onPost: (props.onPost ?? onPost) as typeof onPost,
  };
}

const create = () => screen.getByRole("button", { name: "Create task" });

describe("TaskForm (#3865, #3983)", () => {
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
      formatDateEntry("2026-11-12", new Date()),
    );
    // Points live behind More options, open because the command set them.
    expect(screen.getByLabelText("Points")).toHaveValue(5);
    expect(screen.getByLabelText("Assignee")).toHaveTextContent("Social Chair");
  });

  it("flags what's missing on submit and posts nothing", async () => {
    const { onPost } = renderDialog({ prefill: { title: "Sweep" } });
    fireEvent.click(create());
    expect(await screen.findByText("Pick an assignee.")).toBeInTheDocument();
    expect(screen.getByText("Pick a due date.")).toBeInTheDocument();
    // Outlined like the fields beside it, not only named under it (#3983).
    expect(screen.getByLabelText("Assignee")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(onPost).not.toHaveBeenCalled();
  });

  it("posts the task and closes", async () => {
    const { onPost, onOpenChange } = renderDialog({
      prefill: { title: "Sweep", dueDate: "2026-11-12" },
      initialAssigneeId: "u-1",
    });
    fireEvent.click(screen.getByRole("button", { name: /More options/ }));
    fireEvent.change(screen.getByLabelText("Description"), {
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
      photo_required: false,
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
    expect(screen.getByRole("button", { name: "Discard draft" })).toBeEnabled();
  });

  it("reports each edit to its host, so a closed card keeps the draft", () => {
    const { onDraftChange } = renderDialog();
    expect(onDraftChange).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Sweep" },
    });
    expect(onDraftChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "Sweep" }),
    );
  });
});

describe("TaskForm's due time (#4512)", () => {
  // A time long gone by, so no clock is needed: any submit refuses it unless
  // it is the task's own.
  const PAST = "2020-01-06T09:00";
  const editing = { steps: null, assigneeNote: () => null };

  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("refuses a new time already gone by, and posts nothing", async () => {
    const { onPost } = renderDialog({
      prefill: { title: "Sweep", dueDate: PAST },
      initialAssigneeId: "u-1",
    });
    fireEvent.click(create());
    expect(
      await screen.findByText(/That time has already passed/),
    ).toBeInTheDocument();
    expect(onPost).not.toHaveBeenCalled();
  });

  it("keeps a task's own time on an edit, even once it has passed", async () => {
    const { onPost } = renderDialog({
      prefill: { title: "Sweep", dueDate: PAST },
      initialAssigneeId: "u-1",
      editing,
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onPost).toHaveBeenCalledTimes(1));
    expect(onPost.mock.calls[0]![0]).toMatchObject({ due_date: "2020-01-06" });
    expect(onPost.mock.calls[0]![0].due_at).toEqual(expect.any(String));
  });

  it("keeps a suggestion's own time when it is accepted", async () => {
    const { onPost } = renderDialog({
      prefill: { title: "Sweep", dueDate: PAST },
      initialAssigneeId: "u-1",
      suggestion: true,
    });
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(onPost).toHaveBeenCalledTimes(1));
  });

  it("refuses a time newly moved into the past on an edit", async () => {
    const { onPost } = renderDialog({
      prefill: { title: "Sweep", dueDate: PAST },
      initialAssigneeId: "u-1",
      editing,
    });
    fireEvent.change(screen.getByLabelText("Due time"), {
      target: { value: "08:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText(/That time has already passed/),
    ).toBeInTheDocument();
    expect(onPost).not.toHaveBeenCalled();
  });
});
