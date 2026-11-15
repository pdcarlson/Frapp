/** @vitest-environment jsdom */
import React from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import * as ImagePicker from "expo-image-picker";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FrappThemeProvider } from "@/lib/theme";
import { drawnText, screenText } from "@/test/screen-text";
import type { TaskEditTarget } from "@/lib/tasks/create-task";

/**
 * The New task sheet as an edit (#4296): opened on a task, it saves only what
 * changed through `PATCH /v1/tasks/:id`, keeps an overdue task's own date,
 * and says before Save when a new assignee starts the task over.
 */

const mintPhoto = vi.hoisted(() => vi.fn());
let updateOutcome: "ok" | "fail" | "pending" = "ok";
const update = vi.fn(
  (
    _vars: unknown,
    options: { onSuccess: () => void; onError: (error: unknown) => void },
  ) => {
    if (updateOutcome === "ok") options.onSuccess();
    else if (updateOutcome === "fail")
      options.onError({ statusCode: 500, message: "down" });
  },
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
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: mintPhoto }),
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

function render(
  task: TaskEditTarget = TASK,
  onSaved = vi.fn(),
  keptDraft?: string,
) {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <FrappThemeProvider>
        <NewTaskSheet
          now={NOW}
          editing={task}
          onSaved={onSaved}
          keptDraft={keptDraft}
        />
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

  it("uploads a photo added on the edit and sends it after the kept ones", async () => {
    vi.mocked(
      ImagePicker.requestMediaLibraryPermissionsAsync,
    ).mockResolvedValueOnce({ granted: true, canAskAgain: true } as never);
    vi.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: "file:///porch.png",
          fileName: "porch.png",
          mimeType: "image/png",
          width: 10,
          height: 10,
          fileSize: 100,
        },
      ],
    } as never);
    mintPhoto.mockResolvedValueOnce({
      upload_url: "https://signed",
      storage_path: "p/new.png",
    });
    const tree = render({
      ...TASK,
      referencePhotos: [
        { id: "a", kind: "reference", storage_path: "p/a.jpg" },
      ],
    });
    await act(async () => {
      tree.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Add photos" &&
            typeof node.props.onPress === "function",
        )
        .props.onPress();
    });
    await act(async () => saveButton(tree).props.onPress());
    expect(mintPhoto).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      {
        id: "task-1",
        body: { reference_photo_paths: ["p/a.jpg", "p/new.png"] },
      },
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

describe("Edit task kept past its screen (#4872)", () => {
  const KEPT = "task-edit:task-1";
  /** The sheet opened from the Tasks screen, which keeps its edit. */
  const open = (task: TaskEditTarget = TASK) => render(task, vi.fn(), KEPT);
  const title = (tree: ReactTestRenderer) =>
    byLabel(tree, "Task title").props.value;
  const leave = (tree: ReactTestRenderer) => act(() => tree.unmount());
  const pressCancel = (tree: ReactTestRenderer) =>
    act(() =>
      tree.root
        .find(
          (node) =>
            node.type === ("Pressable" as never) &&
            drawnText(node) === "Cancel",
        )
        .props.onPress(),
    );

  it("opens the same task's Edit on what was typed", () => {
    const first = open();
    act(() =>
      byLabel(first, "Task title").props.onChangeText("Porch and hall"),
    );
    leave(first);

    const second = open();
    expect(title(second)).toBe("Porch and hall");
    leave(second);
  });

  it("keeps nothing for an edit opened and left untouched", () => {
    leave(open());
    expect(title(open({ ...TASK, title: "Renamed on web" }))).toBe(
      "Renamed on web",
    );
  });

  it("keeps another task's edit apart", () => {
    const first = open();
    act(() =>
      byLabel(first, "Task title").props.onChangeText("Porch and hall"),
    );
    leave(first);
    const other = render(
      { ...TASK, id: "task-2" },
      vi.fn(),
      "task-edit:task-2",
    );
    expect(title(other)).toBe("Sweep the porch");
  });

  it("shows someone else's change to a field this member didn't edit", () => {
    const first = open();
    act(() =>
      byLabel(first, "Task title").props.onChangeText("Porch and hall"),
    );
    leave(first);

    // Points moved on web in the meantime; the title is still this member's.
    const second = open({ ...TASK, title: "Sweep it", pointReward: 9 });
    expect(title(second)).toBe("Porch and hall");
    expect(byLabel(second, "Point reward").props.value).toBe("9");
    act(() => saveButton(second).props.onPress());
    expect(update).toHaveBeenCalledWith(
      { id: "task-1", body: { title: "Porch and hall" } },
      expect.anything(),
    );
  });

  it("keeps a removed photo removed, and one added elsewhere since", () => {
    const a = { id: "a", kind: "reference" as const, storage_path: "p/a.jpg" };
    const b = { id: "b", kind: "reference" as const, storage_path: "p/b.jpg" };
    const c = { id: "c", kind: "reference" as const, storage_path: "p/c.jpg" };
    const first = open({ ...TASK, referencePhotos: [a, b] });
    act(() =>
      first.root
        .find(
          (node) =>
            node.props.accessibilityLabel === "Remove photo 1" &&
            typeof node.props.onPress === "function",
        )
        .props.onPress(),
    );
    leave(first);

    const second = open({ ...TASK, referencePhotos: [a, b, c] });
    act(() => saveButton(second).props.onPress());
    expect(update).toHaveBeenCalledWith(
      { id: "task-1", body: { reference_photo_paths: ["p/b.jpg", "p/c.jpg"] } },
      expect.anything(),
    );
  });

  it("gives the edit up on Cancel", () => {
    const first = open();
    act(() =>
      byLabel(first, "Task title").props.onChangeText("Porch and hall"),
    );
    pressCancel(first);
    leave(first);
    expect(title(open())).toBe("Sweep the porch");
  });

  it("gives the edit up once it saves", () => {
    const first = open();
    act(() =>
      byLabel(first, "Task title").props.onChangeText("Porch and hall"),
    );
    act(() => saveButton(first).props.onPress());
    expect(update).toHaveBeenCalledTimes(1);
    leave(first);
    expect(title(open())).toBe("Sweep the porch");
  });

  it("keeps what is typed after a save lands in a visit still open", () => {
    // A visit reopened mid-save stays open when the save lands; the save's
    // hold is over, so what the member types next is kept again.
    const first = open();
    act(() =>
      byLabel(first, "Task title").props.onChangeText("Porch and hall"),
    );
    act(() => saveButton(first).props.onPress());
    act(() => byLabel(first, "Task title").props.onChangeText("Porch, hall"));
    leave(first);
    expect(title(open())).toBe("Porch, hall");
  });

  it("gives the edit up on a Save with nothing changed", () => {
    const first = open();
    act(() =>
      byLabel(first, "Task title").props.onChangeText("Porch and hall"),
    );
    act(() =>
      byLabel(first, "Task title").props.onChangeText("Sweep the porch"),
    );
    act(() => saveButton(first).props.onPress());
    leave(first);
    expect(title(open({ ...TASK, title: "Renamed on web" }))).toBe(
      "Renamed on web",
    );
  });

  it("holds the edit out while its save is in flight", () => {
    updateOutcome = "pending";
    const first = open();
    act(() =>
      byLabel(first, "Task title").props.onChangeText("Porch and hall"),
    );
    act(() => saveButton(first).props.onPress());
    leave(first);
    // Reopened mid-save: the same edit isn't offered to send again.
    expect(title(open())).toBe("Sweep the porch");
  });

  it("keeps the edit when its save fails", () => {
    updateOutcome = "fail";
    const first = open();
    act(() =>
      byLabel(first, "Task title").props.onChangeText("Porch and hall"),
    );
    act(() => saveButton(first).props.onPress());
    leave(first);
    expect(title(open())).toBe("Porch and hall");
  });
});
