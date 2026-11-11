/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const addSubtask = vi.fn();
const deleteSubtask = vi.fn();
vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useSetSubtaskDone: () => ({ mutate: vi.fn(), isPending: false }),
  useAddSubtask: () => ({ mutate: addSubtask, isPending: false }),
  useDeleteSubtask: () => ({ mutate: deleteSubtask, isPending: false }),
}));

import { TaskDetailSheet } from "./task-detail-sheet";
import type { TaskRowModel } from "@/lib/tasks/board";

function row(overrides: Partial<TaskRowModel> = {}): TaskRowModel {
  return {
    id: "t1",
    title: "Clean the kitchen",
    description: "Counters, floor, and take the recycling out.",
    createdBy: "officer-1",
    storedStatus: "TODO",
    displayStatus: "TODO",
    dueDate: "2026-08-18",
    dueDay: "2026-08-18",
    dueAt: null,
    assigneeId: "me",
    completedAt: null,
    confirmedAt: null,
    pointReward: 15,
    pointsAwarded: false,
    isDone: false,
    isOverdue: false,
    subtasks: [],
    ...overrides,
  };
}

function render(node: React.ReactElement): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<FrappThemeProvider>{node}</FrappThemeProvider>);
  });
  return tree;
}

function texts(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAllByType("Text" as never, { deep: true })
    .flatMap((node) =>
      React.Children.toArray(node.props.children).filter(
        (child): child is string => typeof child === "string",
      ),
    );
}

const pressByText = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAll((node) => typeof node.props?.onPress === "function")
    .find(
      (node) =>
        node.findAll((child) => child.props?.children === label).length > 0,
    );

describe("TaskDetailSheet", () => {
  it("shows what the row has no room for, and offers Mark done", () => {
    const onToggle = vi.fn();
    const tree = render(
      <TaskDetailSheet
        row={row()}
        assignedBy="Jordan Lee"
        onToggle={onToggle}
      />,
    );
    const all = texts(tree);
    expect(all).toContain("To do");
    expect(all).toContain("Counters, floor, and take the recycling out.");
    expect(all).toContain("Jordan Lee");
    act(() => pressByText(tree, "Mark done")!.props.onPress());
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("says who a completion waits on and offers Mark not done", () => {
    const tree = render(
      <TaskDetailSheet
        row={row({
          storedStatus: "COMPLETED",
          displayStatus: "COMPLETED",
          isDone: true,
        })}
        assignedBy="You"
        onToggle={() => {}}
      />,
    );
    const all = texts(tree);
    expect(all).toContain("Waiting on an officer");
    expect(all).toContain(
      "You marked this done. An officer confirms it before the points count.",
    );
    expect(pressByText(tree, "Mark not done")).toBeDefined();
    expect(pressByText(tree, "Mark done")).toBeUndefined();
  });

  it("offers nothing once an officer has confirmed it", () => {
    const tree = render(
      <TaskDetailSheet
        row={row({
          storedStatus: "COMPLETED",
          displayStatus: "COMPLETED",
          isDone: true,
          pointsAwarded: true,
        })}
        assignedBy={null}
        onToggle={() => {}}
      />,
    );
    expect(texts(tree)).toContain("Confirmed. The 15 points are yours.");
    expect(pressByText(tree, "Mark not done")).toBeUndefined();
    expect(pressByText(tree, "Mark done")).toBeUndefined();
  });

  it("gives an officer Edit and lets them add and remove steps (#4296)", () => {
    const onEdit = vi.fn();
    const tree = render(
      <TaskDetailSheet
        row={row({
          subtasks: [{ id: "s1", title: "Wipe the counters", done: false }],
        })}
        assignedBy="You"
        onEdit={onEdit}
      />,
    );
    act(() => pressByText(tree, "Edit")!.props.onPress());
    expect(onEdit).toHaveBeenCalledTimes(1);

    const remove = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Remove subtask: Wipe the counters" &&
        typeof node.props.onPress === "function",
    );
    act(() => remove.props.onPress());
    expect(deleteSubtask).toHaveBeenCalledWith(
      { taskId: "t1", subtaskId: "s1" },
      expect.anything(),
    );

    const field = tree.root.find(
      (node) =>
        node.props.accessibilityLabel === "Add a subtask" &&
        typeof node.props.onChangeText === "function",
    );
    act(() => field.props.onChangeText("Take the recycling out"));
    act(() =>
      tree.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Add a subtask" &&
            typeof node.props.onSubmitEditing === "function",
        )
        .props.onSubmitEditing(),
    );
    expect(addSubtask).toHaveBeenCalledWith(
      { taskId: "t1", title: "Take the recycling out" },
      expect.anything(),
    );
  });

  it("offers a member no Edit and no step editing", () => {
    const tree = render(
      <TaskDetailSheet
        row={row({
          subtasks: [{ id: "s1", title: "Wipe the counters", done: false }],
        })}
        assignedBy="Jordan Lee"
      />,
    );
    expect(pressByText(tree, "Edit")).toBeUndefined();
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Add a subtask",
      ),
    ).toHaveLength(0);
  });
});
