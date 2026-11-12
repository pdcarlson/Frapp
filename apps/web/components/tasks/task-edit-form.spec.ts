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

describe("taskEditFrom's photo (#4565)", () => {
  const withPhoto: EditableTask = {
    ...task,
    reference_photo_path: "chapters/c/tasks/p/mess.jpg",
    photo_required: false,
  };

  it("keeps the photo and the switch when neither changed", () => {
    expect(taskEditFrom(withPhoto, input({ photo_required: false }))).toEqual(
      {},
    );
  });

  it("sends a new photo's path, or null to remove it", () => {
    expect(
      taskEditFrom(
        withPhoto,
        input({ reference_photo_path: "chapters/c/tasks/q/new.jpg" }),
      ),
    ).toEqual({ reference_photo_path: "chapters/c/tasks/q/new.jpg" });
    expect(
      taskEditFrom(withPhoto, input({ reference_photo_path: null })),
    ).toEqual({ reference_photo_path: null });
  });

  it("sends Photo required only when it changed", () => {
    expect(taskEditFrom(withPhoto, input({ photo_required: true }))).toEqual({
      photo_required: true,
    });
  });
});
