/** @vitest-environment jsdom */
import React from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
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
    .find((node) =>
      node.findAll((child) => child.props?.children === label).length > 0,
    );

describe("TaskDetailSheet", () => {
  it("shows what the row has no room for, and offers Mark done", () => {
    const onToggle = vi.fn();
    const tree = render(
      <TaskDetailSheet row={row()} assignedBy="Jordan Lee" onToggle={onToggle} />,
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
        row={row({ storedStatus: "COMPLETED", displayStatus: "COMPLETED", isDone: true })}
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
});
