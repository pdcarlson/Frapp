import { describe, expect, it } from "vitest";
import type { TaskInput } from "@repo/chat-core/dispatch";
import { taskEditFrom, type EditableTask } from "./task-edit-form";

// 5 PM on the task's day, in this machine's zone, as the form would send it.
const FIVE_PM = new Date(2026, 10, 14, 17, 0).toISOString();

const task: EditableTask = {
  id: "t1",
  title: "Sweep",
  description: null,
  assignee_id: "u1",
  due_date: "2026-11-14",
  due_at: FIVE_PM,
  point_reward: null,
  status: "TODO",
};

const input = (overrides: Partial<TaskInput> = {}): TaskInput => ({
  title: "Sweep",
  assignee_id: "u1",
  due_date: "2026-11-14",
  due_at: FIVE_PM,
  ...overrides,
});

describe("taskEditFrom's due time (#4512)", () => {
  it("sends nothing when the time is unchanged", () => {
    expect(taskEditFrom(task, input())).toEqual({});
  });

  it("takes the time off with due_at null", () => {
    expect(taskEditFrom(task, input({ due_at: undefined }))).toEqual({
      due_date: "2026-11-14",
      due_at: null,
    });
  });

  it("sends a changed time with its day", () => {
    const nine = new Date(2026, 10, 14, 9, 30).toISOString();
    expect(taskEditFrom(task, input({ due_at: nine }))).toEqual({
      due_date: "2026-11-14",
      due_at: nine,
    });
  });

  it("gives an untimed task a time", () => {
    expect(taskEditFrom({ ...task, due_at: null }, input())).toEqual({
      due_date: "2026-11-14",
      due_at: FIVE_PM,
    });
  });
});

describe("taskEditFrom's photos and proof kind (#4635)", () => {
  const A = "chapters/c/tasks/a/mess.jpg";
  const B = "chapters/c/tasks/b/mop.jpg";
  const withPhotos: EditableTask = {
    ...task,
    photos: [
      { id: "pa", kind: "reference", storage_path: A },
      { id: "pb", kind: "reference", storage_path: B },
      { id: "pp", kind: "proof", storage_path: "chapters/c/tasks/p/done.jpg" },
    ],
    proof_kind: "none",
  };

  it("sends nothing when the photos and the proof kind stand", () => {
    expect(
      taskEditFrom(
        withPhotos,
        input({ reference_photo_paths: [A, B], proof_kind: "none" }),
      ),
    ).toEqual({});
  });

  it("sends the whole set when one is removed, added or moved", () => {
    expect(
      taskEditFrom(withPhotos, input({ reference_photo_paths: [B] })),
    ).toEqual({ reference_photo_paths: [B] });
    expect(
      taskEditFrom(
        withPhotos,
        input({ reference_photo_paths: [A, B, "chapters/c/tasks/n/new.jpg"] }),
      ),
    ).toEqual({ reference_photo_paths: [A, B, "chapters/c/tasks/n/new.jpg"] });
    expect(
      taskEditFrom(withPhotos, input({ reference_photo_paths: [B, A] })),
    ).toEqual({ reference_photo_paths: [B, A] });
  });

  it("sends the proof kind only when it changed", () => {
    expect(taskEditFrom(withPhotos, input({ proof_kind: "link" }))).toEqual({
      proof_kind: "link",
    });
  });
});
