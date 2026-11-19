/** @vitest-environment jsdom */
import React, { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Alert } from "react-native";
import {
  dropAllKeptDrafts,
  readKeptDraft,
  writeKeptDraft,
} from "@repo/hooks/kept-drafts";
import type { LiveTaskPhoto } from "@repo/hooks";
import { toTaskRow, type TaskRowModel } from "./board";
import { taskRepeatDraftFromRule } from "@repo/validation";
import { TASK_EDIT_COPY } from "./task-edit";
import { useTaskEdit, type TaskEditing } from "./use-task-edit";

/**
 * The task screen's edit (#5514) as the hook runs it: each field's saves in
 * order, measured against the save before them, every save Done waits on,
 * each field's refusal its own, and what doesn't save as the screen goes
 * kept for the next edit (`task-edit:<id>`, #4872).
 */

type Body = Record<string, unknown>;
const updateTask = vi.fn<(input: { id: string; body: Body }) => Promise<void>>(
  async () => undefined,
);
const photos = vi.hoisted(() => ({
  pick: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("@repo/hooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@repo/hooks")>()),
  useUpdateTask: () => ({ mutateAsync: updateTask }),
  useRequestTaskPhotoUploadUrl: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/lib/tasks/task-photos", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/tasks/task-photos")>()),
  pickTaskPhotos: photos.pick,
  uploadTaskPhotos: photos.upload,
}));

/** The kept-drafts key an edit of `t1` is kept under, signed out. */
const KEPT = "anon\u0000none\u0000draft:task-edit:t1";

const photo = (id: string, kind = "reference"): LiveTaskPhoto => ({
  id,
  kind: kind as LiveTaskPhoto["kind"],
  storage_path: `chapters/c/tasks/t1/${id}.jpg`,
});

function row(overrides: Record<string, unknown> = {}): TaskRowModel {
  return toTaskRow({
    id: "t1",
    title: "Sweep",
    description: null,
    assignee_id: "u1",
    status: "TODO",
    stored_status: "TODO",
    due_date: "2099-09-30",
    due_at: null,
    point_reward: 5,
    points_awarded: false,
    confirmed_at: null,
    proof_kind: "none",
    photos: [],
    ...overrides,
  })!;
}

/** A save that lands, or fails, when the spec says so. */
function held() {
  let land!: () => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    land = resolve;
    fail = reject;
  });
  return { promise, land, fail };
}

/** The hook's return, handed out through an effect. */
const hook = { edit: null as TaskEditing | null };
function Harness({ task }: { task: TaskRowModel }) {
  const edit = useTaskEdit(task);
  React.useEffect(() => {
    hook.edit = edit;
  });
  return null;
}

function mount(task: TaskRowModel = row()): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Harness task={task} />);
  });
  return tree;
}

const REFUSED = {
  statusCode: 400,
  error: "Bad Request",
  message: "This task was confirmed, so it can't change.",
};

beforeEach(() => {
  vi.clearAllMocks();
  updateTask.mockImplementation(async () => undefined);
  dropAllKeptDrafts();
});

afterEach(() => {
  dropAllKeptDrafts();
});

describe("one field's saves", () => {
  it("send in order, each after the one before, and a change back still sends", async () => {
    const first = held();
    updateTask.mockImplementationOnce(() => first.promise);
    const tree = mount();
    act(() => hook.edit!.type("title", "Mop"));
    let a!: Promise<boolean>;
    act(() => {
      a = hook.edit!.commit("title");
    });
    // Back to what the task says: measured against "Mop" on its way, so it
    // is a change, and it waits for "Mop" to land first.
    act(() => hook.edit!.type("title", "Sweep"));
    let b!: Promise<boolean>;
    act(() => {
      b = hook.edit!.commit("title");
    });
    expect(updateTask).toHaveBeenCalledTimes(1);
    expect(updateTask).toHaveBeenLastCalledWith({
      id: "t1",
      body: { title: "Mop" },
    });
    await act(async () => {
      first.land();
      await a;
      await b;
    });
    expect(updateTask).toHaveBeenCalledTimes(2);
    expect(updateTask).toHaveBeenLastCalledWith({
      id: "t1",
      body: { title: "Sweep" },
    });
    act(() => tree.unmount());
  });

  it("send once when the same draft is committed twice (a blur, then Done)", async () => {
    const first = held();
    updateTask.mockImplementationOnce(() => first.promise);
    const tree = mount();
    act(() => hook.edit!.type("points", "10"));
    let blur!: Promise<boolean>;
    let done!: Promise<boolean>;
    act(() => {
      blur = hook.edit!.commit("points");
      done = hook.edit!.commitAll();
    });
    let settled = false;
    void done.then(() => {
      settled = true;
    });
    await act(async () => undefined);
    // Done waits on the save on its way.
    expect(settled).toBe(false);
    await act(async () => {
      first.land();
      await blur;
    });
    await expect(done).resolves.toBe(true);
    expect(updateTask).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });
});

describe("refusals", () => {
  it("keep each field's own: a later field's save doesn't clear an earlier one's", async () => {
    const tree = mount();
    act(() => hook.edit!.type("points", "-4"));
    await act(async () => {
      await hook.edit!.commit("points");
    });
    expect(hook.edit!.failure).toBe(TASK_EDIT_COPY.points);
    // The title saves after it: the points' problem still stands.
    act(() => hook.edit!.type("title", "Mop"));
    await act(async () => {
      await hook.edit!.commit("title");
    });
    expect(hook.edit!.failure).toBe(TASK_EDIT_COPY.points);
    let ok!: boolean;
    await act(async () => {
      ok = await hook.edit!.commitAll();
    });
    expect(ok).toBe(false);
    expect(updateTask).toHaveBeenCalledWith({
      id: "t1",
      body: { title: "Mop" },
    });
    expect(hook.edit!.failure).toBe(TASK_EDIT_COPY.points);
    act(() => tree.unmount());
  });
});

describe("proof, photos and who", () => {
  it("sends a proof change, which Done waits on and reports", async () => {
    const save = held();
    updateTask.mockImplementationOnce(() => save.promise);
    const tree = mount();
    act(() => hook.edit!.setProof("photo"));
    expect(updateTask).toHaveBeenCalledWith({
      id: "t1",
      body: { proof_kind: "photo" },
    });
    let done!: Promise<boolean>;
    act(() => {
      done = hook.edit!.commitAll();
    });
    await act(async () => {
      save.fail(REFUSED);
      await done.catch(() => undefined);
    });
    await expect(done).resolves.toBe(false);
    expect(hook.edit!.failure).toBe(REFUSED.message);
    act(() => tree.unmount());
  });

  it("removes exactly the one photo, keeping the rest in order", () => {
    const tree = mount(
      row({
        photos: [photo("a"), photo("b"), photo("c"), photo("p", "proof")],
      }),
    );
    act(() => hook.edit!.removePhoto("b"));
    expect(updateTask).toHaveBeenCalledWith({
      id: "t1",
      body: {
        reference_photo_paths: [
          photo("a").storage_path,
          photo("c").storage_path,
        ],
      },
    });
    act(() => tree.unmount());
  });

  it("adds picked photos after the task's own, once they are up, and Done waits on it", async () => {
    photos.pick.mockResolvedValue({
      status: "picked",
      images: [{ uri: "file://new.jpg" }],
      refused: null,
    });
    const up = held();
    photos.upload.mockImplementationOnce(() =>
      up.promise.then(() => ({
        status: "uploaded",
        photos: [],
        paths: ["chapters/c/tasks/t1/new.jpg"],
      })),
    );
    const tree = mount(row({ photos: [photo("a"), photo("b")] }));
    let adding!: Promise<void>;
    await act(async () => {
      adding = hook.edit!.addPhotos();
      await Promise.resolve();
    });
    let done!: Promise<boolean>;
    act(() => {
      done = hook.edit!.commitAll();
    });
    expect(updateTask).not.toHaveBeenCalled();
    await act(async () => {
      up.land();
      await adding;
    });
    expect(updateTask).toHaveBeenCalledWith({
      id: "t1",
      body: {
        reference_photo_paths: [
          photo("a").storage_path,
          photo("b").storage_path,
          "chapters/c/tasks/t1/new.jpg",
        ],
      },
    });
    await expect(done).resolves.toBe(true);
    act(() => tree.unmount());
  });

  it("says an upload's refusal", async () => {
    photos.pick.mockResolvedValue({
      status: "picked",
      images: [{ uri: "file://new.jpg" }],
      refused: null,
    });
    photos.upload.mockResolvedValueOnce({
      status: "refused",
      photos: [],
      reason: "Tasks are turned off for this chapter.",
      final: true,
    });
    const tree = mount();
    await act(async () => {
      await hook.edit!.addPhotos();
    });
    expect(updateTask).not.toHaveBeenCalled();
    expect(hook.edit!.failure).toBe("Tasks are turned off for this chapter.");
    act(() => tree.unmount());
  });

  it("hands one copy of a group task over with no scope, while its title edits the group", async () => {
    const tree = mount(row({ group_id: "g1" }));
    act(() => hook.edit!.reassign("u2", (id) => id));
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenLastCalledWith({
      id: "t1",
      body: { assignee_id: "u2" },
    });
    act(() => hook.edit!.type("title", "Mop"));
    await act(async () => {
      await hook.edit!.commit("title");
    });
    expect(updateTask).toHaveBeenLastCalledWith({
      id: "t1",
      body: { title: "Mop", scope: "group" },
    });
    act(() => tree.unmount());
  });
});

describe("a copy of a repeating task (#5119)", () => {
  const RULE = "FREQ=WEEKLY;BYDAY=WE;TZID=America/New_York";
  const live = () =>
    row({
      series_id: "s1",
      series: {
        recurrence_rule: RULE,
        next_due_date: "2099-10-07",
        ended: false,
      },
    });
  /** The scope alert's buttons, from its last showing. */
  const answer = (label: string) => {
    const call = vi.mocked(Alert.alert).mock.calls.at(-1)!;
    const buttons = call[2] as { text: string; onPress?: () => void }[];
    buttons.find((button) => button.text === label)!.onPress!();
  };

  it("asks first, and All upcoming tasks sends the series scope", async () => {
    const tree = mount(live());
    act(() => hook.edit!.type("title", "Mop"));
    let saved!: Promise<boolean>;
    act(() => {
      saved = hook.edit!.commit("title");
    });
    expect(updateTask).not.toHaveBeenCalled();
    expect(vi.mocked(Alert.alert).mock.calls.at(-1)?.[0]).toBe(
      "This is a repeating task",
    );
    await act(async () => {
      answer("All upcoming tasks");
      await saved;
    });
    expect(updateTask).toHaveBeenLastCalledWith({
      id: "t1",
      body: { title: "Mop", scope: "series" },
    });
    act(() => tree.unmount());
  });

  it("This task only sends no scope; Cancel sends nothing and keeps the draft", async () => {
    const tree = mount(live());
    act(() => hook.edit!.type("points", "3"));
    let saved!: Promise<boolean>;
    act(() => {
      saved = hook.edit!.commit("points");
    });
    await act(async () => {
      answer("Cancel");
      expect(await saved).toBe(false);
    });
    expect(updateTask).not.toHaveBeenCalled();
    expect(hook.edit!.drafts.points).toBe("3");
    expect(hook.edit!.failure).toBeNull();
    act(() => {
      saved = hook.edit!.commit("points");
    });
    await act(async () => {
      answer("This task only");
      await saved;
    });
    expect(updateTask).toHaveBeenLastCalledWith({
      id: "t1",
      body: { point_reward: 3 },
    });
    act(() => tree.unmount());
  });

  it("asks once for the fields Done saves together", async () => {
    const tree = mount(live());
    act(() => {
      hook.edit!.type("title", "Mop");
      hook.edit!.type("points", "3");
    });
    let saved!: Promise<boolean>;
    act(() => {
      saved = hook.edit!.commitAll();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    await act(async () => {
      answer("All upcoming tasks");
      expect(await saved).toBe(true);
    });
    expect(updateTask).toHaveBeenCalledWith({
      id: "t1",
      body: { title: "Mop", scope: "series" },
    });
    expect(updateTask).toHaveBeenCalledWith({
      id: "t1",
      body: { point_reward: 3, scope: "series" },
    });
    act(() => tree.unmount());
  });

  it("saves the Repeat after the other fields Done saves with it", async () => {
    const tree = mount(live());
    act(() => {
      hook.edit!.type("title", "Mop");
      hook.edit!.pickRepeat({
        ...taskRepeatDraftFromRule(RULE),
        preset: "NONE",
        pristine: false,
      });
    });
    let saved!: Promise<boolean>;
    act(() => {
      saved = hook.edit!.commitAll();
    });
    await act(async () => {
      await Promise.resolve();
    });
    // Stopping the repeat waits on the title's question.
    expect(updateTask).not.toHaveBeenCalled();
    await act(async () => {
      answer("All upcoming tasks");
      expect(await saved).toBe(true);
    });
    expect(updateTask.mock.calls.map(([call]) => call.body)).toEqual([
      { title: "Mop", scope: "series" },
      { recurrence_rule: null, scope: "series" },
    ]);
    act(() => tree.unmount());
  });

  it("saves what is left as the screen goes to this copy, without asking", async () => {
    const tree = mount(live());
    act(() => hook.edit!.type("title", "Mop"));
    await act(async () => {
      tree.unmount();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenLastCalledWith({
      id: "t1",
      body: { title: "Mop" },
    });
  });

  it("saves a Repeat change to the series without asking", async () => {
    const tree = mount(live());
    const stored = hook.edit!.drafts.repeat;
    expect(stored).toBeNull();
    act(() =>
      hook.edit!.pickRepeat({
        ...taskRepeatDraftFromRule(RULE),
        preset: "NONE",
        pristine: false,
      }),
    );
    await act(async () => {
      await hook.edit!.commit("repeat");
    });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(updateTask).toHaveBeenLastCalledWith({
      id: "t1",
      body: { recurrence_rule: null, scope: "series" },
    });
    act(() => tree.unmount());
  });
});

describe("leaving the screen", () => {
  it("saves a draft still typed as the screen goes", async () => {
    const tree = mount();
    act(() => hook.edit!.type("title", "Mop"));
    await act(async () => {
      tree.unmount();
      await Promise.resolve();
    });
    expect(updateTask).toHaveBeenCalledWith({
      id: "t1",
      body: { title: "Mop" },
    });
    expect(readKeptDraft(KEPT)).toBeUndefined();
  });

  it("keeps one that doesn't save for the task's next edit, which opens on it", async () => {
    updateTask.mockRejectedValueOnce(new TypeError("Network request failed"));
    const tree = mount();
    act(() => {
      hook.edit!.type("title", "Mop");
      hook.edit!.type("points", "abc");
    });
    await act(async () => {
      tree.unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(readKeptDraft(KEPT)).toEqual({ title: "Mop", points: "abc" });

    const next = mount();
    act(() => hook.edit!.begin());
    expect(hook.edit!.drafts).toMatchObject({ title: "Mop", points: "abc" });
    // Taken: the next visit after this one opens on the task.
    expect(readKeptDraft(KEPT)).toBeUndefined();
    act(() => next.unmount());
  });

  it("opens on the task when nothing was kept", () => {
    writeKeptDraft(KEPT, undefined);
    const tree = mount();
    act(() => hook.edit!.begin());
    expect(hook.edit!.drafts).toEqual({
      title: null,
      description: null,
      points: null,
      due: null,
      repeat: null,
    });
    act(() => tree.unmount());
  });
});
