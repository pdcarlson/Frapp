/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import * as expoRouter from "expo-router";
import { AccessibilityInfo, Alert, StyleSheet } from "react-native";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { expectBackRow } from "@/test/back-row";
import { screenText } from "@/test/screen-text";
import { StatusChip } from "@/components/status-chip";
import {
  TaskActionBar,
  TaskActionBarSpacer,
} from "@/components/tasks/task-action-bar";
import { UndoBar } from "@/components/tasks/undo-bar";
import { SUBSCRIPTION_REFUSAL_COPY } from "@/lib/subscription-refusal";
import type { ActionMenu } from "@/lib/action-menu";
import { TASK_AUDIENCE_COPY } from "@repo/validation";

/**
 * The task screen (#5492), which replaced the task detail sheet: what it
 * shows for a little and a lot, and which controls each viewer gets, as the
 * API grants them. Its assertions from the sheet's spec moved here.
 *
 * It renders `app/(app)/task-details.tsx` but lives here: a spec under
 * `app/` ships as a route module (`lib/routes.spec.ts`).
 */

const ME = "user-me";
const OFFICER = "officer-1";

/** A member's own plain task: no description, steps, photos or group. */
const PLAIN = {
  id: "t1",
  title: "Sweep the porch",
  description: null,
  created_by: OFFICER,
  assignee_id: ME,
  status: "TODO",
  stored_status: "TODO",
  due_date: "2026-11-20",
  due_at: null,
  point_reward: null,
  points_awarded: false,
  completed_at: null,
  confirmed_at: null,
  sent_back_at: null,
  sent_back_reason: null,
  proof_kind: "none",
  proof_link: null,
  completion_note: null,
  subtasks: [],
  photos: [],
  group_id: null,
  group: null,
  created_at: "2026-11-17T15:00:00.000Z",
};

/** One member's copy of a task for everyone. */
function copy(
  assignee: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...PLAIN,
    id: `copy-${assignee}`,
    title: "Fill in the housing form",
    assignee_id: assignee,
    group_id: "g1",
    group: { id: "g1", audience: "everyone", total: 7, done: 2, confirmed: 1 },
    ...overrides,
  };
}

const GROUP_COPIES = [
  copy(ME, { description: "Due before the housing meeting." }),
  copy("u-ana", {
    status: "COMPLETED",
    stored_status: "COMPLETED",
    points_awarded: true,
    completed_at: "2026-11-18T10:00:00.000Z",
    confirmed_at: "2026-11-18T11:00:00.000Z",
    point_reward: 5,
  }),
  copy("u-ben", {
    status: "COMPLETED",
    stored_status: "COMPLETED",
    completed_at: "2026-11-18T10:00:00.000Z",
  }),
  copy("u-cal"),
  copy("u-dee", { status: "OVERDUE" }),
  copy("u-eli"),
  copy("u-fay"),
];

const NAMES: Record<string, string> = {
  [ME]: "Riley Me",
  [OFFICER]: "Jordan Lee",
  "u-ana": "Ana Park",
  "u-ben": "Ben Ortiz",
  "u-cal": "Cal Reyes",
  "u-dee": "Dee Moss",
  "u-eli": "Eli Shaw",
  "u-fay": "Fay Wu",
};

let task: Record<string, unknown> | undefined = PLAIN;
let taskPending = false;
let tasks: unknown[] = [];
let permissions: string[] = ["members:view"];
const mutateStatus = vi.fn(async () => ({}));
const deleteTask = vi.fn(async () => ({}));
const releaseTask = vi.fn<(id: string, options?: unknown) => void>();
const removeFromGroup = vi.fn(
  async (input: { assigneeIds: string[] }): Promise<unknown> => ({
    removed: input.assigneeIds,
    group: { id: "g1", audience: "everyone", total: 5, done: 2, confirmed: 1 },
  }),
);
const confirmTask = vi.fn<(id: string) => Promise<unknown>>(async () => ({}));
const rejectTask = vi.fn<
  (input: {
    id: string;
    body: { comment: string; require_photo?: boolean };
  }) => Promise<unknown>
>(async () => ({}));
const addSubtask = vi.fn();
const deleteSubtask = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useActiveChapterId: () => "chapter-1",
  useViewerUserId: () => ME,
  usePermissionList: () => permissions,
  useTask: () => ({
    data: taskPending ? undefined : task,
    isPending: taskPending,
    isError: !taskPending && task === undefined,
    error: task === undefined ? { statusCode: 404 } : null,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useTasks: () => ({ data: tasks, isSuccess: true, isPending: false }),
  useMemberDisplayNames: () => ({
    byId: NAMES,
    avatarFor: () => null,
    avatarTintFor: () => ({ fill: "#222222", text: "#EEEEEE" }),
  }),
  useUpdateTaskStatus: () => ({ mutateAsync: mutateStatus }),
  useConfirmTask: () => ({ mutateAsync: confirmTask, isPending: false }),
  useRejectTask: () => ({ mutateAsync: rejectTask, isPending: false }),
  useDeleteTask: () => ({ mutateAsync: deleteTask, isPending: false }),
  useReleaseTask: () => ({ mutate: releaseTask, isPending: false }),
  useRemoveFromTaskGroup: () => ({
    mutateAsync: removeFromGroup,
    isPending: false,
  }),
  useSetSubtaskDone: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSubtask: () => ({ mutate: addSubtask, isPending: false }),
  useDeleteSubtask: () => ({ mutate: deleteSubtask, isPending: false }),
  useTaskPhotoUrl: (_taskId: string, photoId: string | null) => ({
    data: photoId ? `https://signed/${photoId}` : undefined,
  }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));
vi.mock("@/lib/kept-sheet-draft", () => ({
  useDropKeptSheetDraft: () => undefined,
}));
// The sheets have their own specs; here only that the screen opens them, on
// what.
vi.mock("@/components/tasks/new-task-sheet", async () => {
  const { forwardRef, createElement } = await import("react");
  return {
    NewTaskSheet: forwardRef(function NewTaskSheet(props: object) {
      return createElement("NewTaskSheet", props);
    }),
  };
});
vi.mock("@/components/tasks/mark-done-sheet", async () => {
  const { createElement } = await import("react");
  return {
    MARK_DONE_ALREADY_DONE: "Already done.",
    MarkDoneSheet: (props: object) => createElement("MarkDoneSheet", props),
  };
});
const menus: ActionMenu[] = [];
vi.mock("@/lib/action-menu", () => ({
  showActionMenu: (menu: ActionMenu) => menus.push(menu),
}));
vi.mock("@/lib/haptics", () => ({ successHaptic: () => undefined }));
/** `null` online; a reason while a write would be lost. */
const connection = vi.hoisted(() => ({
  writeBlockedReason: null as string | null,
}));
vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: connection.writeBlockedReason }),
}));
// Send back's sheet has its own spec; here only what the screen hands it.
vi.mock("@/components/tasks/send-back-sheet", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<
      typeof import("@/components/tasks/send-back-sheet")
    >()),
    SendBackSheet: (props: object) => createElement("SendBackSheet", props),
  };
});

import TaskDetailsScreen from "@/app/(app)/task-details";

function render(id: string | null = "t1"): ReactTestRenderer {
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue(
    id === null ? {} : { id },
  );
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <TaskDetailsScreen />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

/** The pressable a screen reader names `label`, or `undefined`. */
function control(
  tree: ReactTestRenderer,
  label: string,
): ReactTestInstance | undefined {
  return tree.root.findAll(
    (node) =>
      typeof node.type === "string" &&
      node.props.accessibilityLabel === label &&
      typeof node.props.onPress === "function",
  )[0];
}

const press = (tree: ReactTestRenderer, label: string) => {
  const found = control(tree, label);
  expect(found, label).toBeDefined();
  act(() => found!.props.onPress());
};

beforeEach(() => {
  task = PLAIN;
  taskPending = false;
  tasks = [];
  permissions = ["members:view"];
  menus.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({});
});

describe("A member's own plain task: a little", () => {
  it("shows its status, its facts and its history, and nothing for the parts it lacks", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Sweep the porch");
    expect(tree.root.findByType(StatusChip).props.label).toBe("To do");
    expect(text).toContain("Due");
    expect(text).toContain("From");
    expect(text).toContain("Jordan Lee");
    expect(text).toContain("Assigned by Jordan Lee");
    // No points, description, checklist, photos or group: nothing drawn.
    expect(text).not.toContain("Points");
    expect(text).not.toContain("WHO HAS IT");
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Add a subtask",
      ),
    ).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("offers Start in More, and it sends the assignee's To do → In progress (#5492)", () => {
    const tree = render();
    press(tree, "More");
    expect(menus[0]!.rows.map((row) => row.label)).toEqual(["Start"]);
    act(() => menus[0]!.rows[0]!.onPress());
    expect(mutateStatus).toHaveBeenCalledTimes(1);
    expect(mutateStatus).toHaveBeenCalledWith({
      id: "t1",
      body: { status: "IN_PROGRESS" },
    });
    act(() => tree.unmount());

    // Started, it has nothing for More.
    task = { ...PLAIN, status: "IN_PROGRESS", stored_status: "IN_PROGRESS" };
    const started = render();
    expect(control(started, "More")).toBeUndefined();
    act(() => started.unmount());
  });

  it("offers Mark done, and Mark done marks it done and offers Undo", async () => {
    const tree = render();
    expect(control(tree, "Mark done")).toBeDefined();
    expect(control(tree, "Edit task")).toBeUndefined();
    expect(control(tree, "Remove people")).toBeUndefined();
    await act(async () => {
      control(tree, "Mark done")!.props.onPress();
    });
    // TODO → COMPLETED walks IN_PROGRESS first.
    expect(mutateStatus).toHaveBeenNthCalledWith(1, {
      id: "t1",
      body: { status: "IN_PROGRESS" },
    });
    expect(mutateStatus).toHaveBeenNthCalledWith(2, {
      id: "t1",
      body: { status: "COMPLETED" },
    });
    // Their own completion: they may take it back.
    expect(tree.root.findAllByType(UndoBar)).toHaveLength(1);
    act(() => tree.unmount());
  });

  it("says a gate refusal on Mark done, and withdraws Mark done", async () => {
    mutateStatus.mockRejectedValueOnce({
      statusCode: 403,
      error: "Forbidden",
      message:
        "Chapter subscription is not active; complete checkout to use this feature.",
    });
    const tree = render();
    await act(async () => {
      control(tree, "Mark done")!.props.onPress();
    });
    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.taskStatus);
    expect(control(tree, "Mark done")).toBeUndefined();
    act(() => tree.unmount());
  });

  it("says why when a Mark not done is refused", async () => {
    task = {
      ...PLAIN,
      status: "COMPLETED",
      stored_status: "COMPLETED",
      point_reward: 15,
      completed_at: "2026-11-18T09:00:00.000Z",
    };
    mutateStatus.mockRejectedValueOnce({ statusCode: 400, message: "No" });
    const tree = render();
    press(tree, "More");
    await act(async () => {
      menus[0]!.rows[0]!.onPress();
    });
    expect(screenText(tree)).toContain(
      "Couldn't mark that task not done. An officer may have confirmed it already.",
    );
    act(() => tree.unmount());
  });

  it("goes back to Tasks", () => {
    const tree = render();
    expectBackRow(tree, "Tasks", "/tasks");
    act(() => tree.unmount());
  });

  it("leaves room under its last section for the floating bar", () => {
    const tree = render();
    expect(tree.root.findAllByType(TaskActionBarSpacer)).toHaveLength(1);
    act(() => tree.unmount());
  });
});

describe("The task's states", () => {
  it("names what Mark done needs and opens Mark done's sheet for proof (#4635)", async () => {
    task = {
      ...PLAIN,
      proof_kind: "photo",
      photos: [{ id: "p1", kind: "reference", storage_path: "a/1.jpg" }],
    };
    const tree = render();
    expect(screenText(tree)).toContain("Photos");
    await act(async () => {
      control(tree, "Mark done with a photo")!.props.onPress();
    });
    expect(mutateStatus).not.toHaveBeenCalled();
    const sheet = tree.root.find(
      (node) => (node.type as unknown) === "MarkDoneSheet",
    );
    expect(sheet.props.task.id).toBe("t1");
    act(() => tree.unmount());
  });

  it("shows Needs changes and the officer's reason on a sent-back task, and the send-back in History", () => {
    task = {
      ...PLAIN,
      status: "IN_PROGRESS",
      stored_status: "IN_PROGRESS",
      sent_back_at: "2026-11-18T12:00:00.000Z",
      sent_back_reason: "Floor is still sticky",
    };
    const tree = render();
    const text = screenText(tree);
    expect(tree.root.findByType(StatusChip).props.label).toBe("Needs changes");
    expect(text).toContain("Floor is still sticky");
    expect(text).toContain("Sent back");
    act(() => tree.unmount());
  });

  it("offers Mark not done on a completion still waiting on an officer", () => {
    task = {
      ...PLAIN,
      status: "COMPLETED",
      stored_status: "COMPLETED",
      point_reward: 15,
      completed_at: "2026-11-18T09:00:00.000Z",
    };
    const tree = render();
    expect(tree.root.findByType(StatusChip).props.label).toBe(
      "Waiting on an officer",
    );
    expect(screenText(tree)).toContain("Marked done");
    expect(screenText(tree)).not.toContain("Marked done by");
    expect(control(tree, "Mark done")).toBeUndefined();
    press(tree, "More");
    expect(menus[0]!.rows.map((row) => row.label)).toEqual(["Mark not done"]);
    act(() => tree.unmount());
  });

  it("still offers Mark not done on a completion signed off as it was marked (no points, no proof)", () => {
    task = {
      ...PLAIN,
      status: "COMPLETED",
      stored_status: "COMPLETED",
      point_reward: null,
      points_awarded: true,
      completed_at: "2026-11-13T10:00:00.000Z",
      confirmed_at: "2026-11-13T10:00:00.000Z",
    };
    const tree = render();
    expect(tree.root.findByType(StatusChip).props.label).toBe("Done");
    press(tree, "More");
    expect(menus[0]!.rows.map((row) => row.label)).toEqual(["Mark not done"]);
    act(() => tree.unmount());
  });

  it("offers nothing to change once an officer has confirmed it", () => {
    task = {
      ...PLAIN,
      status: "COMPLETED",
      stored_status: "COMPLETED",
      point_reward: 15,
      points_awarded: true,
      completed_at: "2026-11-18T09:00:00.000Z",
      confirmed_at: "2026-11-18T10:00:00.000Z",
    };
    const tree = render();
    expect(tree.root.findByType(StatusChip).props.label).toBe("Confirmed");
    expect(screenText(tree)).toContain("Confirmed");
    // No control left for a member: no bar, and no room kept for one.
    expect(tree.root.findAllByType(TaskActionBar)).toHaveLength(0);
    expect(tree.root.findAllByType(TaskActionBarSpacer)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("draws a skeleton while the task loads, and says so when it can't be read", () => {
    taskPending = true;
    let tree = render();
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Loading task",
      ).length,
    ).toBeGreaterThan(0);
    act(() => tree.unmount());

    taskPending = false;
    task = undefined;
    tree = render();
    expect(screenText(tree)).toContain("Couldn't load this task");
    expectBackRow(tree, "Tasks", "/tasks");
    act(() => tree.unmount());
  });

  it("says where to open a task from without an id", () => {
    const tree = render(null);
    expect(screenText(tree)).toContain("Open a task from Tasks.");
    act(() => tree.unmount());
  });
});

describe("An officer on a task for everyone: a lot", () => {
  beforeEach(() => {
    permissions = ["members:view", "tasks:manage"];
    task = GROUP_COPIES[0] as Record<string, unknown>;
    tasks = GROUP_COPIES;
  });

  it("lists who has it, what's left first, collapsed to a few with N more", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("WHO HAS IT");
    expect(text).toContain("Everyone · 2 of 7 done");
    expect(text).toContain("Due before the housing meeting.");
    // Overdue leads; five shown, two behind "2 more".
    expect(text).toContain("Dee Moss");
    expect(text).toContain("2 more");
    expect(text).not.toContain("Ana Park");
    press(tree, "Show 2 more");
    expect(screenText(tree)).toContain("Ana Park");
    act(() => tree.unmount());
  });

  it("gives an officer Edit, Remove people and the deletes, Delete for everyone last", () => {
    const tree = render();
    expect(control(tree, "Edit task")).toBeDefined();
    expect(control(tree, "Remove people")).toBeDefined();
    press(tree, "More");
    // Their own copy, still To do: Start leads, and three is the most.
    expect(menus[0]!.rows.map((row) => row.label)).toEqual([
      "Start",
      "Delete",
      "Delete for everyone",
    ]);
    expect(menus[0]!.rows.at(-1)!.style).toBe("destructive");
    act(() => tree.unmount());
  });

  it("deletes only this copy from More's plain Delete", async () => {
    const tree = render();
    press(tree, "More");
    act(() => menus[0]!.rows.find((row) => row.label === "Delete")!.onPress());
    const [title, , buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect(title).toBe('Delete "Fill in the housing form"?');
    await act(async () => {
      buttons!.find((button) => button.style === "destructive")!.onPress?.();
    });
    expect(deleteTask).toHaveBeenCalledWith(`copy-${ME}`);
    act(() => tree.unmount());
  });

  it("goes back where the member came from after a delete, when there is somewhere", async () => {
    const router = vi.mocked(expoRouter.useRouter)();
    vi.mocked(router.canGoBack).mockReturnValue(true);
    const tree = render();
    press(tree, "More");
    act(() => menus[0]!.rows.find((row) => row.label === "Delete")!.onPress());
    await act(async () => {
      vi.mocked(Alert.alert)
        .mock.calls[0]![2]!.find((button) => button.style === "destructive")!
        .onPress?.();
    });
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.dismissTo).not.toHaveBeenCalled();
    vi.mocked(router.canGoBack).mockReturnValue(false);
    act(() => tree.unmount());
  });

  it("says Mark done in a crowded bar, the proof it asks for in the hint (320pt)", () => {
    task = {
      ...(GROUP_COPIES[0] as Record<string, unknown>),
      proof_kind: "photo",
    };
    const tree = render();
    // Edit, Remove people and More beside it: the whole verb won't fit.
    expect(control(tree, "Mark done with a photo")).toBeUndefined();
    const pill = control(tree, "Mark done")!;
    expect(pill.props.accessibilityHint).toBe("Mark done with a photo.");
    act(() => tree.unmount());
  });

  it("gives an officer Mark done on a member's copy, and no Undo once it lands", async () => {
    task = GROUP_COPIES[3] as Record<string, unknown>;
    const tree = render("copy-u-cal");
    await act(async () => {
      control(tree, "Mark done")!.props.onPress();
    });
    expect(mutateStatus).toHaveBeenCalledWith({
      id: "copy-u-cal",
      body: { status: "COMPLETED" },
    });
    // Taking it back is the assignee's alone (Send back is the officer's).
    expect(tree.root.findAllByType(UndoBar)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("opens the Edit task sheet on this copy, its draft kept by task (#4872)", () => {
    const tree = render();
    press(tree, "Edit task");
    const edit = tree.root.find(
      (node) =>
        (node.type as unknown) === "NewTaskSheet" && !!node.props.editing,
    );
    expect(edit.props.editing.id).toBe(`copy-${ME}`);
    expect(edit.props.keptDraft).toBe(`task-edit:copy-${ME}`);
    act(() => tree.unmount());
  });

  it("lets the officer add and remove steps (#4296)", () => {
    task = {
      ...(GROUP_COPIES[0] as Record<string, unknown>),
      subtasks: [{ id: "s1", title: "Sign page 2", done_at: null }],
    };
    const tree = render();
    press(tree, "Remove subtask: Sign page 2");
    expect(deleteSubtask).toHaveBeenCalledWith(
      { taskId: `copy-${ME}`, subtaskId: "s1" },
      expect.anything(),
    );
    act(() => tree.unmount());
  });

  it("deletes for everyone after the platform alert, then goes back to Tasks", async () => {
    const tree = render();
    press(tree, "More");
    act(() => menus[0]!.rows.at(-1)!.onPress());
    const [title, , buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
    expect(title).toBe('Delete "Fill in the housing form" for everyone?');
    const go = buttons!.find((button) => button.style === "destructive")!;
    await act(async () => {
      go.onPress?.();
    });
    expect(deleteTask).toHaveBeenCalledWith({
      id: `copy-${ME}`,
      scope: "group",
    });
    expect(vi.mocked(expoRouter.useRouter)().dismissTo).toHaveBeenCalledWith(
      "/tasks",
    );
    act(() => tree.unmount());
  });

  describe("Remove people's select mode", () => {
    it("opens in select mode from a row's long-press Remove people (select=1, #5492)", () => {
      vi.mocked(expoRouter.useLocalSearchParams).mockReturnValue({
        id: "t1",
        select: "1",
      });
      let tree!: ReactTestRenderer;
      act(() => {
        tree = create(
          <FrappThemeProvider>
            <TaskDetailsScreen />
          </FrappThemeProvider>,
        );
      });
      expect(control(tree, "Remove 0")).toBeDefined();
      expect(control(tree, "Cancel")).toBeDefined();
      // Cleared, so coming back to the screen doesn't select again.
      expect(vi.mocked(expoRouter.useRouter)().setParams).toHaveBeenCalledWith({
        select: undefined,
      });
      act(() => tree.unmount());
    });

    it("lists everyone with a circle; a confirmed copy is dimmed and can't be picked", () => {
      const tree = render();
      press(tree, "Remove people");
      const boxes = tree.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props.accessibilityRole === "checkbox" &&
          typeof node.props.onPress === "function",
      );
      // Every member, none collapsed.
      expect(boxes).toHaveLength(7);
      const ana = boxes.find((box) =>
        String(box.props.accessibilityLabel).startsWith("Ana Park"),
      )!;
      expect(ana.props.disabled).toBe(true);
      expect(ana.props.accessibilityState).toMatchObject({ disabled: true });
      // The bar is now Cancel and one red Remove, held until a pick.
      expect(control(tree, "Mark done")).toBeUndefined();
      expect(control(tree, "Remove 0")!.props.disabled).toBe(true);
      expect(control(tree, "Cancel")).toBeDefined();
      act(() => tree.unmount());
    });

    it("asks first, takes the picked members out, and says so", async () => {
      const tree = render();
      press(tree, "Remove people");
      press(tree, "Cal Reyes, To do");
      press(tree, "Eli Shaw, To do");
      press(tree, "Remove 2");
      const [title, , buttons] = vi.mocked(Alert.alert).mock.calls[0]!;
      expect(title).toBe("Take 2 people out?");
      const go = buttons!.find((button) => button.style === "destructive")!;
      expect(go.text).toBe("Remove 2");
      await act(async () => {
        go.onPress?.();
      });
      expect(removeFromGroup).toHaveBeenCalledWith({
        id: `copy-${ME}`,
        assigneeIds: ["u-cal", "u-eli"],
      });
      expect(screenText(tree)).toContain("Took 2 people out of this task.");
      expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
        "Took 2 people out of this task.",
      );
      // Out of select mode, the bar is back.
      expect(control(tree, "Remove people")).toBeDefined();
      act(() => tree.unmount());
    });

    it("holds Remove when every copy would go, and says to delete for everyone", () => {
      // No confirmed copy, so all seven are removable.
      tasks = GROUP_COPIES.map((row) => ({
        ...(row as Record<string, unknown>),
        points_awarded: false,
      }));
      const tree = render();
      press(tree, "Remove people");
      for (const box of tree.root.findAll(
        (node) =>
          typeof node.type === "string" &&
          node.props.accessibilityRole === "checkbox" &&
          typeof node.props.onPress === "function",
      )) {
        act(() => box.props.onPress());
      }
      expect(control(tree, "Remove 7")!.props.disabled).toBe(true);
      expect(screenText(tree)).toContain(
        "That's everyone. Use Delete for everyone in More instead.",
      );
      act(() => tree.unmount());
    });

    it("leaves the screen when the copy on it was one taken out", async () => {
      const tree = render();
      press(tree, "Remove people");
      press(tree, "Riley Me, To do");
      press(tree, "Remove 1");
      const buttons = vi.mocked(Alert.alert).mock.calls[0]![2]!;
      await act(async () => {
        buttons.find((button) => button.style === "destructive")!.onPress?.();
      });
      expect(vi.mocked(expoRouter.useRouter)().dismissTo).toHaveBeenCalledWith(
        "/tasks",
      );
      act(() => tree.unmount());
    });
  });
});

describe("A member on a task for everyone", () => {
  it("shows no Who has it and no officer controls", () => {
    task = GROUP_COPIES[0] as Record<string, unknown>;
    // A member's read holds only their own copy.
    tasks = [GROUP_COPIES[0]];
    const tree = render();
    expect(screenText(tree)).not.toContain("WHO HAS IT");
    expect(control(tree, "Remove people")).toBeUndefined();
    expect(control(tree, "Edit task")).toBeUndefined();
    // Their own copy's Start, and nothing an officer has.
    press(tree, "More");
    expect(menus[0]!.rows.map((row) => row.label)).toEqual(["Start"]);
    act(() => tree.unmount());
  });

  it("says who a group task went to, by its real target, and how many have done it (#5503)", () => {
    task = {
      ...(GROUP_COPIES[0] as Record<string, unknown>),
      group: {
        id: "g1",
        audience: "group",
        target_id: "grp-1",
        target_name: "Philanthropy",
        total: 6,
        done: 2,
        confirmed: 1,
      },
    };
    tasks = [task];
    const tree = render();
    expect(screenText(tree)).toContain(
      `${TASK_AUDIENCE_COPY.everyoneIn("Philanthropy")} · ${TASK_AUDIENCE_COPY.progress(2, 6)}`,
    );
    // Shown as a meter too, a third of the way.
    const meter = tree.root.findByProps({ testID: "group-progress-meter" });
    const fill = meter.children[0] as ReactTestInstance;
    expect(StyleSheet.flatten(fill.props.style).width).toBe("33%");
    act(() => tree.unmount());
  });
});

describe("Give it back, on a task claimed from Up for grabs (#5503)", () => {
  it("is in More until the task is done, and goes back to Tasks once it lands", () => {
    task = { ...PLAIN, open_task_id: "open-1" };
    const tree = render();
    press(tree, "More");
    const giveBack = menus[0]!.rows.find(
      (row) => row.label === TASK_AUDIENCE_COPY.release,
    );
    expect(giveBack).toBeDefined();
    act(() => giveBack!.onPress());
    expect(releaseTask).toHaveBeenCalledWith("t1", expect.anything());
    const { onSuccess } = releaseTask.mock.calls[0]![1] as {
      onSuccess: () => void;
    };
    act(() => onSuccess());
    // To the board, which says so in its line (`tasks-screen.spec.tsx`).
    expect(vi.mocked(expoRouter.useRouter)().dismissTo).toHaveBeenCalledWith({
      pathname: "/tasks",
      params: { released: "1" },
    });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      `It's back on ${TASK_AUDIENCE_COPY.upForGrabs}.`,
    );
    act(() => tree.unmount());

    task = {
      ...PLAIN,
      open_task_id: "open-1",
      status: "COMPLETED",
      stored_status: "COMPLETED",
      completed_at: "2026-11-18T09:00:00.000Z",
    };
    menus.length = 0;
    const done = render();
    press(done, "More");
    expect(menus[0]!.rows.map((row) => row.label)).not.toContain(
      TASK_AUDIENCE_COPY.release,
    );
    act(() => done.unmount());
  });

  it("is not offered on an ordinary task", () => {
    const tree = render();
    // More holds only Start on a member's ordinary open task.
    press(tree, "More");
    expect(menus[0]!.rows.map((row) => row.label)).toEqual(["Start"]);
    act(() => tree.unmount());
  });
});

describe("An officer's Confirm and Send back (#5513)", () => {
  /** A member's completion of the officer's task, waiting on a sign-off. */
  const WAITING = {
    ...PLAIN,
    created_by: ME,
    assignee_id: "u-ben",
    status: "COMPLETED",
    stored_status: "COMPLETED",
    point_reward: 10,
    completed_at: "2026-11-18T09:00:00.000Z",
  };
  const CONFIRM = "Confirm · +10 pts";
  const OFFLINE = "You're offline.";
  const GATE = {
    statusCode: 403,
    error: "Forbidden",
    message:
      "Chapter subscription is not active; complete checkout to use this feature.",
  };
  const sendBackSheet = (tree: ReactTestRenderer) =>
    tree.root.findAll((node) => (node.type as unknown) === "SendBackSheet")[0];
  const moreLabels = (tree: ReactTestRenderer) => {
    menus.length = 0;
    press(tree, "More");
    return menus[0]!.rows.map((row) => row.label);
  };

  beforeEach(() => {
    permissions = ["members:view", "tasks:manage"];
    task = WAITING;
    connection.writeBlockedReason = null;
  });

  it("gives an officer's usual review Confirm with its payout, Send back beside it, and Edit in More", () => {
    const tree = render();
    expect(control(tree, CONFIRM)).toBeDefined();
    expect(control(tree, CONFIRM)!.props.accessibilityHint).toBeUndefined();
    expect(control(tree, "Send back")).toBeDefined();
    expect(control(tree, "Mark done")).toBeUndefined();
    // Edit under More, as web's review keeps it under its ⋯ (#4693).
    expect(control(tree, "Edit task")).toBeUndefined();
    expect(moreLabels(tree)).toEqual(["Edit", "Delete"]);
    act(() => menus[0]!.rows[0]!.onPress());
    const edit = tree.root.find(
      (node) =>
        (node.type as unknown) === "NewTaskSheet" && !!node.props.editing,
    );
    expect(edit.props.editing.id).toBe("t1");
    act(() => tree.unmount());
  });

  it("confirms through the confirm route, and says so", async () => {
    const tree = render();
    await act(async () => {
      control(tree, CONFIRM)!.props.onPress();
    });
    expect(confirmTask).toHaveBeenCalledTimes(1);
    expect(confirmTask).toHaveBeenCalledWith("t1");
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      "Confirmed.",
    );
    act(() => tree.unmount());
  });

  it("stays busy through a second tap while the first Confirm sends", async () => {
    let land!: () => void;
    confirmTask.mockImplementationOnce(
      () => new Promise((resolve) => (land = () => resolve({}))),
    );
    const tree = render();
    act(() => control(tree, CONFIRM)!.props.onPress());
    // Settled, so a second tap that returned early has had its say.
    await act(async () => control(tree, CONFIRM)!.props.onPress());
    expect(confirmTask).toHaveBeenCalledTimes(1);
    expect(control(tree, CONFIRM)!.props.accessibilityState).toMatchObject({
      busy: true,
    });
    await act(async () => land());
    expect(control(tree, CONFIRM)!.props.accessibilityState).toMatchObject({
      busy: false,
    });
    act(() => tree.unmount());
  });

  it("says a gate refusal on Confirm, and withdraws Confirm and Send back", async () => {
    confirmTask.mockRejectedValueOnce(GATE);
    const tree = render();
    await act(async () => {
      control(tree, CONFIRM)!.props.onPress();
    });
    expect(screenText(tree)).toContain(SUBSCRIPTION_REFUSAL_COPY.taskStatus);
    expect(control(tree, CONFIRM)).toBeUndefined();
    expect(control(tree, "Send back")).toBeUndefined();
    act(() => tree.unmount());
  });

  it("holds Confirm and Send back while a write would be lost, and says why", () => {
    connection.writeBlockedReason = OFFLINE;
    const tree = render();
    const confirm = control(tree, CONFIRM)!;
    const sendBack = control(tree, "Send back")!;
    expect(confirm.props.disabled).toBe(true);
    expect(confirm.props.accessibilityHint).toBe(OFFLINE);
    expect(sendBack.props.disabled).toBe(true);
    expect(sendBack.props.accessibilityHint).toBe(OFFLINE);
    act(() => tree.unmount());
  });

  it("opens Send back's sheet, which sends the reason and the photo ask", async () => {
    const tree = render();
    expect(sendBackSheet(tree)).toBeUndefined();
    press(tree, "Send back");
    const sheet = sendBackSheet(tree)!;
    expect(sheet.props).toMatchObject({
      title: "Sweep the porch",
      proofKind: "none",
      submittedAt: "2026-11-18T09:00:00.000Z",
      keptDraft: "send-back:t1",
    });
    await act(async () => {
      await sheet.props.onSubmit({
        comment: "Floor is still sticky",
        require_photo: true,
      });
    });
    expect(rejectTask).toHaveBeenCalledWith({
      id: "t1",
      body: { comment: "Floor is still sticky", require_photo: true },
    });
    act(() => sheet.props.onClosed());
    expect(sendBackSheet(tree)).toBeUndefined();
    act(() => tree.unmount());
  });

  it("withdraws Confirm and Send back after a gate refusal on Send back's sheet", async () => {
    rejectTask.mockRejectedValueOnce(GATE);
    const tree = render();
    press(tree, "Send back");
    const sheet = sendBackSheet(tree)!;
    await act(async () => {
      // The sheet says why itself; it hears the rejection.
      await expect(
        sheet.props.onSubmit({ comment: "Not finished" }),
      ).rejects.toBe(GATE);
    });
    expect(control(tree, CONFIRM)).toBeUndefined();
    expect(control(tree, "Send back")).toBeUndefined();
    act(() => tree.unmount());
  });

  it("gives Send back alone on a completion that needed no sign-off, as chat's card does", () => {
    // Signed off as it was marked: nothing was paid, so it can go back.
    task = {
      ...WAITING,
      point_reward: null,
      points_awarded: true,
      confirmed_at: WAITING.completed_at,
    };
    const tree = render();
    expect(control(tree, "Send back")).toBeDefined();
    expect(control(tree, "Confirm")).toBeUndefined();
    act(() => tree.unmount());
  });

  describe("with no room for Send back in the bar", () => {
    // A group's copy needing no sign-off, not paid yet: Edit, Remove people
    // and More are rounds, and Confirm has nothing to do.
    beforeEach(() => {
      task = {
        ...WAITING,
        point_reward: null,
        group_id: "g1",
        group: (GROUP_COPIES[0] as { group: unknown }).group,
      };
      tasks = [task, ...GROUP_COPIES.slice(1)];
    });

    it("leads More with Send back", () => {
      const tree = render();
      expect(control(tree, "Send back")).toBeUndefined();
      expect(control(tree, "Edit task")).toBeDefined();
      expect(moreLabels(tree)).toEqual([
        "Send back",
        "Delete",
        "Delete for everyone",
      ]);
      act(() => menus[0]!.rows[0]!.onPress());
      expect(sendBackSheet(tree)).toBeDefined();
      act(() => tree.unmount());
    });

    it("holds it out of More while a write would be lost", () => {
      connection.writeBlockedReason = OFFLINE;
      const tree = render();
      expect(moreLabels(tree)).toEqual(["Delete", "Delete for everyone"]);
      act(() => tree.unmount());
    });
  });

  it("offers neither on the viewer's own completion, a confirmed one, or to a member", () => {
    const none = () => {
      const tree = render();
      expect(control(tree, "Confirm")).toBeUndefined();
      expect(control(tree, CONFIRM)).toBeUndefined();
      expect(control(tree, "Send back")).toBeUndefined();
      if (control(tree, "More")) {
        expect(moreLabels(tree)).not.toContain("Send back");
      }
      act(() => tree.unmount());
    };
    // Their own: no Confirm (the API refuses a self-confirm), and Mark not
    // done in More instead of Send back.
    task = { ...WAITING, assignee_id: ME };
    none();
    task = {
      ...WAITING,
      points_awarded: true,
      confirmed_at: "2026-11-18T10:00:00.000Z",
    };
    none();
    permissions = ["members:view"];
    task = WAITING;
    none();
  });
});
