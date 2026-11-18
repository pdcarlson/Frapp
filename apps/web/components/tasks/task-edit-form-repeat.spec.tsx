import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { chapterSubscription } from "@/tests/chapter-subscription";
import type { SubscriptionGate } from "@/components/shared/subscription-gate";

/**
 * Repeating tasks on the web edit and composer forms (#5119): the scope
 * prompt on save, decided before any upload, and the Repeat pick in the
 * form's write and its More options summary.
 */

const { mockCurrentChapter, mockToast, updateTask, photo } = vi.hoisted(() => ({
  mockCurrentChapter: vi.fn(),
  mockToast: vi.fn(),
  updateTask: vi.fn(),
  photo: { requestUrl: vi.fn(), put: vi.fn() },
}));

vi.mock("@repo/hooks", () => ({
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: photo.requestUrl }),
  useTaskPhotoUrl: () => ({ data: undefined }),
  putSignedUpload: photo.put,
  useCurrentChapter: () => mockCurrentChapter(),
  useMembers: () => ({
    data: [{ user_id: "u1", display_name: "Aaron Whitfield" }],
  }),
  useUpdateTask: () => ({ mutateAsync: updateTask, isPending: false }),
  // The Who picker's other lists (2026-11-18): none needed here.
  useRoles: () => ({ data: [] }),
  useRoleTiers: () => ({ data: [] }),
  useGroups: () => ({ data: [] }),
  useCurrentUser: () => ({ data: undefined }),
  useMemberDisplayNames: () => ({ avatarTintFor: () => null }),
}));

// The live checklist has its own spec; here it only has to render.
vi.mock("./task-subtasks", () => ({ TaskSubtaskList: () => null }));

vi.mock("@/lib/stores/chapter-store", () => ({
  useChapterStore: (selector: (s: { activeChapterId: string }) => unknown) =>
    selector({ activeChapterId: "chap-1" }),
}));

vi.mock("@/lib/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

URL.createObjectURL = () => "blob:preview";
URL.revokeObjectURL = () => undefined;

const { TaskEditForm } = await import("./task-edit-form");
const { TaskForm, taskDraftFrom } = await import("./task-form");

const chapter = chapterSubscription(mockCurrentChapter);
const gate = { controlProps: () => ({}) } as unknown as SubscriptionGate;
const RULE = "FREQ=WEEKLY;INTERVAL=1;BYDAY=MO;TZID=America/New_York";

/** A copy of a live weekly series, still to come, untimed. */
const COPY = {
  id: "t1",
  title: "Kitchen duty",
  description: null,
  assignee_id: "u1",
  due_date: "2099-11-16",
  due_at: null,
  point_reward: 5,
  status: "TODO",
  stored_status: "TODO",
  subtasks: [],
  photos: [],
  proof_kind: "none" as const,
  series: { recurrence_rule: RULE, next_due_date: "2099-11-23", ended: false },
};

function openEdit(task: typeof COPY | Record<string, unknown> = COPY) {
  const onClose = vi.fn();
  render(
    <TaskEditForm
      task={task as typeof COPY}
      assigneeName="Aaron Whitfield"
      gate={gate}
      onClose={onClose}
    />,
  );
  return onClose;
}

function rename(to: string) {
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: to } });
}

describe("TaskEditForm on a repeating task (#5119)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
    updateTask.mockResolvedValue(undefined);
  });

  it("asks, and saves All upcoming tasks to the series", async () => {
    openEdit();
    rename("Kitchen");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByText("This is a repeating task"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "All upcoming tasks" }));
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith({
        id: "t1",
        body: { title: "Kitchen", scope: "series" },
      }),
    );
  });

  it("saves This task only to the one copy", async () => {
    openEdit();
    rename("Kitchen");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "This task only" }),
    );
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith({
        id: "t1",
        body: { title: "Kitchen" },
      }),
    );
  });

  it("writes nothing when the prompt is dismissed", async () => {
    openEdit();
    rename("Kitchen");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("This is a repeating task");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByText("This is a repeating task")).toBeNull(),
    );
    expect(updateTask).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
  });

  it("keeps an overdue copy's save to that copy, unasked", async () => {
    openEdit({ ...COPY, status: "OVERDUE" });
    rename("Kitchen");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith({
        id: "t1",
        body: { title: "Kitchen" },
      }),
    );
    expect(screen.queryByText("This is a repeating task")).toBeNull();
  });

  it("saves a Repeat change alone to the series, without asking", async () => {
    openEdit();
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Doesn't repeat" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith({
        id: "t1",
        body: { recurrence_rule: null, scope: "series" },
      }),
    );
  });

  it("refuses a Repeat change saved with a rename, writing nothing", async () => {
    openEdit();
    rename("Kitchen");
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Doesn't repeat" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description:
            "Save the repeat change on its own first, then make your other changes.",
        }),
      ),
    );
    expect(updateTask).not.toHaveBeenCalled();
  });

  it("shows no Repeat on a task that doesn't repeat", () => {
    openEdit({ ...COPY, series: null });
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    expect(screen.queryByRole("radio", { name: "Weekly" })).toBeNull();
  });
});

describe("TaskForm's Repeat (#5119)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    chapter.active();
  });

  it("creates with the rule and says it in the More options summary", async () => {
    const onPost = vi.fn().mockResolvedValue({ ok: true });
    render(
      <TaskForm
        initialDraft={{
          ...taskDraftFrom({ title: "Kitchen duty", dueDate: "2099-12-31" }),
          assigneeId: "u1",
          points: "5",
        }}
        onPost={onPost}
        onDone={vi.fn()}
        onDiscard={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /more options/i }));
    fireEvent.click(screen.getByRole("radio", { name: "Weekly" }));
    // The summary reads while More options is closed. Dec 31 2099 is a
    // Thursday.
    fireEvent.click(screen.getByRole("button", { name: /fewer options/i }));
    expect(screen.getByText(/5 points · Every Thursday/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create task" }));
    await waitFor(() => expect(onPost).toHaveBeenCalled());
    expect(onPost.mock.calls[0]![0].recurrence_rule).toMatch(
      /^FREQ=WEEKLY;INTERVAL=1;BYDAY=TH;TZID=/,
    );
  });
});
