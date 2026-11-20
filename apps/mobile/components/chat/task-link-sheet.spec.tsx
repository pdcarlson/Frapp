/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";

/** The + sheet's Task picker (#5772), rendered: what it lists and links. */

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

const tasksState = vi.hoisted(() => ({
  value: { data: [] as unknown[], isPending: false, isError: false },
}));
vi.mock("@repo/hooks", async () => {
  const actual =
    await vi.importActual<typeof import("@repo/hooks")>("@repo/hooks");
  return {
    memberFallbackLabel: actual.memberFallbackLabel,
    taskLinkChoices: actual.taskLinkChoices,
    useTasks: () => ({ ...tasksState.value, refetch: vi.fn() }),
    useMemberDisplayNames: () => ({
      nameFor: (id: string) => (id === "u1" ? "Moiz Khan" : null),
    }),
  };
});

import { TaskLinkSheet, type TaskLinkSheetProps } from "./task-link-sheet";

const TASKS = [
  {
    id: "t-door",
    title: "Fix the door",
    status: "TODO",
    due_date: "2099-01-01",
    assignee_id: "u1",
  },
];

function render(over: Partial<TaskLinkSheetProps> = {}) {
  const props: TaskLinkSheetProps = {
    canCreate: false,
    onLink: vi.fn().mockResolvedValue({ ok: true }),
    onNew: vi.fn(),
    ...over,
  };
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <TaskLinkSheet {...props} />
      </FrappThemeProvider>,
    );
  });
  return { tree, props };
}

const list = (tree: ReactTestRenderer) =>
  tree.root.find((node) => (node.type as unknown) === "BottomSheetFlatList");

/** Draws one row or the header element on its own, as the list would. */
function draw(element: React.ReactElement) {
  let drawn!: ReactTestRenderer;
  act(() => {
    drawn = create(<FrappThemeProvider>{element}</FrappThemeProvider>);
  });
  return drawn;
}

const rowFor = (tree: ReactTestRenderer, index: number) =>
  list(tree).props.renderItem({
    item: list(tree).props.data[index],
  }) as React.ReactElement<{ onPress: () => Promise<void> | void }>;

describe("TaskLinkSheet (#5772)", () => {
  it("lists the tasks with whose they are, and links the one tapped", async () => {
    tasksState.value = { data: TASKS, isPending: false, isError: false };
    const { tree, props } = render();
    expect(list(tree).props.data).toEqual([
      expect.objectContaining({
        title: "Fix the door",
        detail: expect.stringMatching(/^Moiz Khan · Due /),
      }),
    ]);
    expect(screenText(draw(rowFor(tree, 0)))).toContain("Fix the door");
    await act(async () => {
      await rowFor(tree, 0).props.onPress();
    });
    expect(props.onLink).toHaveBeenCalledWith({
      id: "t-door",
      title: "Fix the door",
    });
  });

  it("says why when the link is refused", async () => {
    tasksState.value = { data: TASKS, isPending: false, isError: false };
    const { tree } = render({
      onLink: vi
        .fn()
        .mockResolvedValue({ ok: false, error: "Access denied to this task" }),
    });
    await act(async () => {
      await rowFor(tree, 0).props.onPress();
    });
    expect(screenText(draw(list(tree).props.ListHeaderComponent))).toContain(
      "Access denied to this task",
    );
  });

  it("offers New task only to a member who may create one", () => {
    tasksState.value = { data: [], isPending: false, isError: false };
    const header = (canCreate: boolean) =>
      screenText(
        draw(list(render({ canCreate }).tree).props.ListHeaderComponent),
      );
    expect(header(false)).not.toContain("New task");
    expect(header(true)).toContain("New task");
  });
});
