/** @vitest-environment jsdom */
import React, { useCallback } from "react";
import { act } from "react";
import * as expoRouter from "expo-router";
import { Alert, type AlertButton } from "react-native";
import {
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { TaskRow } from "@/components/tasks/task-row";
import { ItemActionsMenu } from "@/components/item-actions-menu";
import { toTaskRow, type TaskRowModel } from "@/lib/tasks/board";
import { MarkDoneHost, useTaskToggle } from "@/lib/tasks/use-task-toggle";
import { useTaskMenu } from "@/lib/tasks/use-task-menu";

/**
 * A task row's long-press menu (#5492): which rows it offers each viewer,
 * gated as `task.controller.ts` gates the calls, and what each row does.
 * Rendered on the board's own `TaskRow` with the board's `useTaskToggle`.
 */

const ME = "user-me";
const OFFICER = "officer-1";

const BASE = {
  id: "t1",
  title: "Sweep the porch",
  description: "Behind the bins too.",
  created_by: OFFICER,
  assignee_id: ME,
  status: "TODO",
  stored_status: "TODO",
  due_date: "2099-11-20",
  due_at: null,
  point_reward: 5,
  points_awarded: false,
  proof_kind: "none",
  subtasks: [{ id: "s1", title: "Sweep", done: false }],
  photos: [],
  group_id: null,
  group: null,
};

let viewer = ME;
let permissions: string[] = ["members:view"];
let tasks: Record<string, unknown>[] = [BASE];
const updateStatus = vi.fn<(input: unknown) => Promise<object>>(
  async () => ({}),
);
const deleteTask = vi.fn<(target: unknown) => Promise<object>>(
  async () => ({}),
);
const confirmTask = vi.fn<(id: string) => Promise<object>>(async () => ({}));
const rejectTask = vi.fn<(input: unknown) => Promise<object>>(async () => ({}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useViewerUserId: () => viewer,
  usePermissionList: () => permissions,
  useTasks: () => ({ data: tasks, isSuccess: true, isPending: false }),
  useUpdateTaskStatus: () => ({ mutateAsync: updateStatus }),
  useDeleteTask: () => ({ mutateAsync: deleteTask, isPending: false }),
  useConfirmTask: () => ({ mutateAsync: confirmTask, isPending: false }),
  useRejectTask: () => ({ mutateAsync: rejectTask, isPending: false }),
}));
/** `null` online; a reason while a write would be lost. */
const connection = vi.hoisted(() => ({
  writeBlockedReason: null as string | null,
}));
vi.mock("@/lib/connection/use-connection", () => ({
  useConnection: () => ({ writeBlockedReason: connection.writeBlockedReason }),
}));
vi.mock("@/components/tasks/send-back-sheet", async (importOriginal) => {
  const { createElement } = await import("react");
  return {
    ...(await importOriginal<
      typeof import("@/components/tasks/send-back-sheet")
    >()),
    SendBackSheet: (props: object) => createElement("SendBackSheet", props),
  };
});
vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));
// The sheets have their own specs; here only that a row opens them, on what.
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

function Board() {
  const rows = tasks.map((raw) => toTaskRow(raw)!);
  const find = useCallback(
    (id: string | null) => rows.find((row) => row.id === id) ?? null,
    [rows],
  );
  const toggles = useTaskToggle(find, { viewerId: viewer });
  const menu = useTaskMenu({ toggles });
  return (
    <>
      {rows.map((row: TaskRowModel) => (
        <TaskRow
          key={row.id}
          row={row}
          now={new Date(2026, 10, 18)}
          onOpen={() => undefined}
          menu={menu.menuFor(row)}
        />
      ))}
      {menu.host}
      <MarkDoneHost toggle={toggles} />
    </>
  );
}

const mounted: ReactTestRenderer[] = [];

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <Board />
      </FrappThemeProvider>,
    );
  });
  mounted.push(tree);
  return tree;
}

/** The first row's pressable with this title. */
function rowOf(tree: ReactTestRenderer, title: string): ReactTestInstance {
  return tree.root.findAll(
    (node) =>
      (node.type as unknown) === "Pressable" &&
      String(node.props.accessibilityLabel).startsWith(title),
  )[0]!;
}

/** Long-presses the row and returns the open menu's labels, in order. */
function longPress(tree: ReactTestRenderer, title = "Sweep the porch") {
  const row = rowOf(tree, title);
  expect(row.props.onLongPress, "a long press").toBeTypeOf("function");
  act(() => row.props.onLongPress({ nativeEvent: { pageY: 300 } }));
  return menuLabels(tree);
}

function menuLabels(tree: ReactTestRenderer): string[] {
  return tree.root
    .findByType(ItemActionsMenu)
    .findAll(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "menuitem",
    )
    .map((node) => node.props.accessibilityLabel as string);
}

function pick(tree: ReactTestRenderer, label: string) {
  const item = tree.root
    .findByType(ItemActionsMenu)
    .find(
      (node) =>
        (node.type as unknown) === "Pressable" &&
        node.props.accessibilityRole === "menuitem" &&
        node.props.accessibilityLabel === label,
    );
  act(() => item.props.onPress());
}

/** Presses the alert's button named `text`. */
async function answerAlert(text: string) {
  const calls = vi.mocked(Alert.alert).mock.calls;
  const buttons = calls[calls.length - 1]![2] as AlertButton[];
  const button = buttons.find((candidate) => candidate.text === text)!;
  await act(async () => {
    button.onPress?.();
  });
}

const sheets = (tree: ReactTestRenderer) =>
  tree.root.findAll((node) => (node.type as unknown) === "NewTaskSheet");

beforeEach(() => {
  connection.writeBlockedReason = null;
  viewer = ME;
  permissions = ["members:view"];
  tasks = [BASE];
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => {
    for (const tree of mounted.splice(0)) tree.unmount();
  });
});

describe("a member on their own task", () => {
  it("offers only Mark done and Start, and Mark done walks the checkbox's writes", async () => {
    const tree = render();
    expect(longPress(tree)).toEqual(["Mark done", "Start"]);
    await act(async () => {
      pick(tree, "Mark done");
    });
    expect(updateStatus).toHaveBeenNthCalledWith(1, {
      id: "t1",
      body: { status: "IN_PROGRESS" },
    });
    expect(updateStatus).toHaveBeenNthCalledWith(2, {
      id: "t1",
      body: { status: "COMPLETED" },
    });
    // The menu closed on the pick.
    expect(tree.root.findByType(ItemActionsMenu).props.target).toBeNull();
  });

  it("starts a To do with the status write alone, and offers no Start once started (#5492)", async () => {
    let tree = render();
    longPress(tree);
    await act(async () => {
      pick(tree, "Start");
    });
    expect(updateStatus).toHaveBeenCalledTimes(1);
    expect(updateStatus).toHaveBeenCalledWith({
      id: "t1",
      body: { status: "IN_PROGRESS" },
    });
    tasks = [{ ...BASE, status: "IN_PROGRESS", stored_status: "IN_PROGRESS" }];
    tree = render();
    expect(longPress(tree)).toEqual(["Mark done"]);
  });

  it("opens Mark done's proof sheet on a task that asks for a photo", async () => {
    tasks = [{ ...BASE, proof_kind: "photo" }];
    const tree = render();
    expect(longPress(tree)).toEqual(["Mark done with a photo", "Start"]);
    await act(async () => {
      pick(tree, "Mark done with a photo");
    });
    expect(updateStatus).not.toHaveBeenCalled();
    expect(
      tree.root.findAll((node) => (node.type as unknown) === "MarkDoneSheet"),
    ).toHaveLength(1);
  });

  it("offers Mark not done on their unconfirmed completion", () => {
    tasks = [{ ...BASE, status: "COMPLETED", stored_status: "COMPLETED" }];
    const tree = render();
    expect(longPress(tree)).toEqual(["Mark not done"]);
  });

  it("has no long press on a task that isn't theirs", () => {
    tasks = [{ ...BASE, assignee_id: "someone-else" }];
    const tree = render();
    expect(rowOf(tree, "Sweep the porch").props.onLongPress).toBeUndefined();
  });
});

describe("an officer on a member's task", () => {
  beforeEach(() => {
    viewer = OFFICER;
    permissions = ["members:view", "tasks:manage"];
  });

  it("offers Mark done, Edit, Reassign, Duplicate, then Delete last", () => {
    const tree = render();
    expect(longPress(tree)).toEqual([
      "Mark done",
      "Edit",
      "Reassign",
      "Duplicate",
      "Delete",
    ]);
  });

  it("Edit opens the task's screen in its edit mode, and Reassign there on Assign to (#5514)", () => {
    const push = vi.mocked(vi.mocked(expoRouter.useRouter)().push);
    push.mockClear();
    const tree = render();
    longPress(tree);
    pick(tree, "Edit");
    expect(push).toHaveBeenLastCalledWith({
      pathname: "/task-details",
      params: { id: "t1", edit: "1" },
    });

    longPress(tree);
    pick(tree, "Reassign");
    expect(push).toHaveBeenLastCalledWith({
      pathname: "/task-details",
      params: { id: "t1", who: "1" },
    });
    // No sheet rises for either: the task is edited in place there.
    expect(sheets(tree)).toHaveLength(0);
  });

  it("Duplicate opens New task filled in from the task, as a new task", () => {
    const tree = render();
    longPress(tree);
    pick(tree, "Duplicate");
    const [sheet] = sheets(tree);
    expect(sheet!.props.keptDraft).toBeUndefined();
    expect(sheet!.props.prefill).toMatchObject({
      title: "Sweep the porch",
      description: "Behind the bins too.",
      who: { kind: "person", userId: ME },
      pointsInput: "5",
      subtasks: ["Sweep"],
      due: { kind: "date", date: "2099-11-20" },
    });
  });

  it("Delete asks first, then deletes the one task", async () => {
    const tree = render();
    longPress(tree);
    pick(tree, "Delete");
    expect(Alert.alert).toHaveBeenCalledWith(
      'Delete "Sweep the porch"?',
      "This can't be undone.",
      expect.any(Array),
    );
    expect(deleteTask).not.toHaveBeenCalled();
    await answerAlert("Delete task");
    expect(deleteTask).toHaveBeenCalledWith("t1");
  });

  it("offers each action to a screen reader by name, Mark done once", () => {
    const tree = render();
    const row = rowOf(tree, "Sweep the porch");
    expect(
      (row.props.accessibilityActions as { label: string }[]).map(
        (action) => action.label,
      ),
    ).toEqual(["Mark done", "Edit", "Reassign", "Duplicate", "Delete"]);
    act(() =>
      row.props.onAccessibilityAction({
        nativeEvent: { actionName: "menu:delete" },
      }),
    );
    expect(Alert.alert).toHaveBeenCalledTimes(1);
  });
});

describe("an officer on a group's copy", () => {
  const groupCopy = (assignee: string) => ({
    ...BASE,
    id: `copy-${assignee}`,
    assignee_id: assignee,
    group_id: "g1",
    group: { id: "g1", audience: "everyone", total: 2, done: 0 },
  });

  beforeEach(() => {
    viewer = OFFICER;
    permissions = ["members:view", "tasks:manage"];
    tasks = [groupCopy(ME), groupCopy("u-ana")];
  });

  it("offers Remove people and Delete for everyone, and no Reassign", () => {
    const tree = render();
    expect(longPress(tree)).toEqual([
      "Mark done",
      "Edit",
      "Remove people",
      "Duplicate",
      "Delete",
      "Delete for everyone",
    ]);
  });

  it("Remove people opens the task's screen in select mode", () => {
    const tree = render();
    longPress(tree);
    pick(tree, "Remove people");
    expect(vi.mocked(expoRouter.useRouter)().push).toHaveBeenCalledWith({
      pathname: "/task-details",
      params: { id: `copy-${ME}`, select: "1" },
    });
  });

  it("Delete takes out one copy and never sends scope=group", async () => {
    const tree = render();
    longPress(tree);
    pick(tree, "Delete");
    await answerAlert("Delete task");
    expect(deleteTask).toHaveBeenCalledTimes(1);
    expect(deleteTask).toHaveBeenCalledWith(`copy-${ME}`);
  });

  it("Delete for everyone sends scope=group", async () => {
    const tree = render();
    longPress(tree);
    pick(tree, "Delete for everyone");
    await answerAlert("Delete for everyone");
    expect(deleteTask).toHaveBeenCalledWith({
      id: `copy-${ME}`,
      scope: "group",
    });
  });

  it("Duplicate sends it to the group again", () => {
    const tree = render();
    longPress(tree);
    pick(tree, "Duplicate");
    expect(sheets(tree)[0]!.props.prefill.who).toEqual({
      kind: "each",
      target: { kind: "chapter" },
    });
  });
});

describe("a confirmed task", () => {
  const confirmed = {
    ...BASE,
    status: "COMPLETED",
    stored_status: "COMPLETED",
    points_awarded: true,
    confirmed_at: "2026-11-17T12:00:00.000Z",
  };

  it("gives an officer only Duplicate and Delete", () => {
    viewer = OFFICER;
    permissions = ["members:view", "tasks:manage"];
    tasks = [confirmed];
    expect(longPress(render())).toEqual(["Duplicate", "Delete"]);
  });

  it("gives its member no menu at all", () => {
    tasks = [confirmed];
    const tree = render();
    expect(rowOf(tree, "Sweep the porch").props.onLongPress).toBeUndefined();
  });
});

describe("a completion waiting on the officer (#5513)", () => {
  const waiting = {
    ...BASE,
    status: "COMPLETED",
    stored_status: "COMPLETED",
    completed_at: "2026-11-17T12:00:00.000Z",
  };
  beforeEach(() => {
    viewer = OFFICER;
    permissions = ["members:view", "tasks:manage"];
    tasks = [waiting];
  });

  it("leads with Confirm and Send back, and Confirm confirms", async () => {
    const tree = render();
    expect(longPress(tree)).toEqual([
      "Confirm",
      "Send back",
      "Edit",
      "Reassign",
      "Duplicate",
      "Delete",
    ]);
    await act(async () => {
      pick(tree, "Confirm");
    });
    expect(confirmTask).toHaveBeenCalledWith("t1");
  });

  it("opens Send back's sheet, which sends through the reject route", async () => {
    const tree = render();
    longPress(tree);
    pick(tree, "Send back");
    const sheet = tree.root.find(
      (node) => (node.type as unknown) === "SendBackSheet",
    );
    expect(sheet.props.keptDraft).toBe("send-back:t1");
    await act(async () => {
      await sheet.props.onSubmit({ comment: "Not finished" });
    });
    expect(rejectTask).toHaveBeenCalledWith({
      id: "t1",
      body: { comment: "Not finished" },
    });
  });

  it("offers no Confirm on a task whose proof the menu can't show", () => {
    tasks = [{ ...waiting, proof_kind: "photo", point_reward: null }];
    expect(longPress(render())).toEqual([
      "Send back",
      "Edit",
      "Reassign",
      "Duplicate",
      "Delete",
    ]);
  });

  it("says a refused Confirm in the platform alert", async () => {
    confirmTask.mockRejectedValueOnce({ statusCode: 400, message: "No" });
    const tree = render();
    longPress(tree);
    await act(async () => {
      pick(tree, "Confirm");
    });
    expect(Alert.alert).toHaveBeenCalledWith("Couldn't confirm the task.");
  });

  const GATE = {
    statusCode: 403,
    error: "Forbidden",
    message:
      "Chapter subscription is not active; complete checkout to use this feature.",
  };

  it("says a gate refusal on Send back once, on its sheet, and then offers no status move or review", async () => {
    // A second task, the officer's own To do, to see Mark done withdrawn.
    tasks = [
      waiting,
      { ...BASE, id: "t2", title: "Order the cups", assignee_id: OFFICER },
    ];
    rejectTask.mockRejectedValueOnce(GATE);
    const tree = render();
    longPress(tree);
    pick(tree, "Send back");
    const sheet = tree.root.find(
      (node) => (node.type as unknown) === "SendBackSheet",
    );
    await act(async () => {
      await expect(
        sheet.props.onSubmit({ comment: "Not finished" }),
      ).rejects.toBe(GATE);
    });
    // The sheet says it; no alert over it.
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(longPress(tree)).toEqual([
      "Edit",
      "Reassign",
      "Duplicate",
      "Delete",
    ]);
    expect(longPress(tree, "Order the cups")).toEqual([
      "Edit",
      "Reassign",
      "Duplicate",
      "Delete",
    ]);
  });

  it("leaves Confirm and Send back out while a write would be lost", () => {
    connection.writeBlockedReason = "You're offline.";
    expect(longPress(render())).toEqual([
      "Edit",
      "Reassign",
      "Duplicate",
      "Delete",
    ]);
  });

  it("offers neither on the officer's own completion", () => {
    tasks = [{ ...waiting, assignee_id: OFFICER }];
    expect(longPress(render())).not.toContain("Confirm");
  });
});
