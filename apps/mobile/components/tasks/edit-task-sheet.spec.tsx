/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { screenText } from "@/test/screen-text";
import type { TaskEditTarget } from "@/lib/tasks/create-task";

/**
 * The New task sheet as an edit (#4296): opened on a task, it saves only what
 * changed through `PATCH /v1/tasks/:id`, keeps an overdue task's own date,
 * and says before Save when a new assignee starts the task over.
 */

let updateOutcome: "ok" | "fail" = "ok";
const update = vi.fn(
  (
    _vars: unknown,
    options: { onSuccess: () => void; onError: (error: unknown) => void },
  ) =>
    updateOutcome === "ok"
      ? options.onSuccess()
      : options.onError({ statusCode: 500, message: "down" }),
);
const create_ = vi.fn();

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useViewerUserId: () => "user-1",
  useChapterRoster: () => ({
    data: [
      { user_id: "user-1", display_name: "Paul Carlson" },
      { user_id: "user-2", display_name: "Cole Martin" },
    ],
  }),
  useCreateTask: () => ({ mutate: create_, isPending: false }),
  useUpdateTask: () => ({ mutate: update, isPending: false }),
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: vi.fn() }),
  useTaskPhotoUrl: () => ({ data: undefined }),
}));

vi.mock("@/lib/chapter-branding", () => ({
  useChapterBranding: () => ({ accent: "#DDB844" }),
}));

vi.mock("@/lib/haptics", () => ({ successHaptic: vi.fn() }));

import { NewTaskSheet } from "./new-task-sheet";

const NOW = new Date(2026, 8, 27, 12, 0, 0);

const TASK: TaskEditTarget = {
  id: "task-1",
  title: "Sweep the porch",
  assigneeId: "user-1",
  dueDay: "2026-09-29",
  dueAt: null,
  pointReward: 5,
  storedStatus: "IN_PROGRESS",
  referencePhotos: [],
  proofKind: "none",
};

function render(task: TaskEditTarget = TASK, onSaved = vi.fn()) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewTaskSheet now={NOW} editing={task} onSaved={onSaved} />
      </FrappThemeProvider>,
    );
  });
  return tree;
}

const byLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.find((node) => node.props.accessibilityLabel === label);
const saveButton = (tree: ReactTestRenderer) =>
  tree.root.find(
    (node) => node.props.label === "Save" && typeof node.type === "function",
  );

beforeEach(() => {
  update.mockClear();
  create_.mockClear();
  updateOutcome = "ok";
});

describe("Edit task (#4296)", () => {
  it("opens on the task, titled Edit task, with no subtask field", () => {
    const tree = render();
    const text = screenText(tree);
    expect(text).toContain("Edit task");
    expect(byLabel(tree, "Task title").props.value).toBe("Sweep the porch");
    expect(byLabel(tree, "Point reward").props.value).toBe("5");
    expect(
      tree.root.findAll(
        (node) => node.props.accessibilityLabel === "Add a subtask",
      ),
    ).toHaveLength(0);
  });

  it("saves only what changed", () => {
    const onSaved = vi.fn();
    const tree = render(TASK, onSaved);
    act(() =>
      byLabel(tree, "Task title").props.onChangeText("Sweep and mop the porch"),
    );
    act(() => saveButton(tree).props.onPress());

    expect(update).toHaveBeenCalledWith(
      { id: "task-1", body: { title: "Sweep and mop the porch" } },
      expect.anything(),
    );
    expect(create_).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it("sends nothing when nothing changed", () => {
    const tree = render();
    act(() => saveButton(tree).props.onPress());
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps an overdue task's date and time when only the title changes", () => {
    const overdue: TaskEditTarget = {
      ...TASK,
      dueDay: "2026-09-20",
      dueAt: new Date(2026, 8, 20, 17, 0).toISOString(),
    };
    const tree = render(overdue);
    act(() => byLabel(tree, "Task title").props.onChangeText("Late porch"));
    expect(saveButton(tree).props.disabled).toBe(false);
    act(() => saveButton(tree).props.onPress());

    expect(update).toHaveBeenCalledWith(
      { id: "task-1", body: { title: "Late porch" } },
      expect.anything(),
    );
  });

  it("keeps the changes and says so when the save fails", () => {
    updateOutcome = "fail";
    const tree = render();
    act(() => byLabel(tree, "Task title").props.onChangeText("Porch"));
    act(() => saveButton(tree).props.onPress());

    expect(screenText(tree)).toContain(
      "That didn't save. Your changes are still here. Try again.",
    );
    expect(byLabel(tree, "Task title").props.value).toBe("Porch");
  });
});

describe("Edit task photos and proof (#4635)", () => {
  const segment = (tree: ReactTestRenderer, label: string) =>
    tree.root.find(
      (node) =>
        node.props.accessibilityRole === "radio" &&
        node.props.accessibilityLabel === label &&
        typeof node.props.onPress === "function",
    );

  it("opens on the task's proof kind and sends a change to it", () => {
    const tree = render({ ...TASK, proofKind: "link" });
    expect(segment(tree, "Link").props.accessibilityState.checked).toBe(true);
    act(() => segment(tree, "Photo").props.onPress());
    act(() => saveButton(tree).props.onPress());
    expect(update).toHaveBeenCalledWith(
      { id: "task-1", body: { proof_kind: "photo" } },
      expect.anything(),
    );
  });

  it("sends the photos as they should stand once one is removed", () => {
    const photos = [
      { id: "a", kind: "reference" as const, storage_path: "p/a.jpg" },
      { id: "b", kind: "reference" as const, storage_path: "p/b.jpg" },
    ];
    const tree = render({ ...TASK, referencePhotos: photos });
    act(() =>
      tree.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Remove photo 1" &&
            typeof node.props.onPress === "function",
        )
        .props.onPress(),
    );
    act(() => saveButton(tree).props.onPress());
    expect(update).toHaveBeenCalledWith(
      { id: "task-1", body: { reference_photo_paths: ["p/b.jpg"] } },
      expect.anything(),
    );
  });
});
