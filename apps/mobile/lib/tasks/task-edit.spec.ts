import { describe, expect, it } from "vitest";
import type { LiveTaskPhoto } from "@repo/hooks";
import { toTaskRow, type TaskRowModel } from "./board";
import {
  assigneeSave,
  descriptionSave,
  dueDraftOf,
  dueSave,
  photosSave,
  pointsSave,
  proofSave,
  reassignRestarts,
  scopedEdit,
  TASK_EDIT_COPY,
  taskEditable,
  titleSave,
} from "./task-edit";

/**
 * The task screen's in-place edit (#5514): what each field sends on
 * `PATCH /v1/tasks/:id`, only when it changed, and `scope: "group"` on a
 * group task's copy, as web's task panel saves.
 */

const NOW = new Date(2026, 8, 29, 12, 0);

const photo = (id: string, kind = "reference"): LiveTaskPhoto => ({
  id,
  kind: kind as LiveTaskPhoto["kind"],
  storage_path: `chapters/c/tasks/${id}/p.jpg`,
});

function row(overrides: Record<string, unknown> = {}): TaskRowModel {
  return toTaskRow({
    id: "t1",
    title: "Sweep",
    description: "Front and back.",
    created_by: "officer",
    assignee_id: "u1",
    status: "TODO",
    stored_status: "TODO",
    due_date: "2026-09-30",
    due_at: null,
    point_reward: 5,
    points_awarded: false,
    confirmed_at: null,
    proof_kind: "none",
    photos: [],
    ...overrides,
  })!;
}

describe("the title", () => {
  it("sends the trimmed title, and nothing for the same or an emptied one", () => {
    expect(titleSave(row(), "  Mop  ")).toEqual({
      kind: "save",
      body: { title: "Mop" },
    });
    expect(titleSave(row(), "Sweep ")).toEqual({ kind: "none" });
    // Emptied, the field goes back to the task's, as web's panel puts it.
    expect(titleSave(row(), "   ")).toEqual({ kind: "none" });
  });

  it("says a title over the limit is too long", () => {
    expect(titleSave(row(), "a".repeat(256))).toEqual({
      kind: "problem",
      message: TASK_EDIT_COPY.titleTooLong,
    });
  });
});

describe("the notes", () => {
  it("sends changed notes, and clears them with null once emptied", () => {
    expect(descriptionSave(row(), "Front only.")).toEqual({
      kind: "save",
      body: { description: "Front only." },
    });
    expect(descriptionSave(row(), "  ")).toEqual({
      kind: "save",
      body: { description: null },
    });
    expect(descriptionSave(row(), "Front and back. ")).toEqual({
      kind: "none",
    });
    expect(descriptionSave(row({ description: null }), "")).toEqual({
      kind: "none",
    });
  });
});

describe("the points", () => {
  it("sends new points, null once emptied, and refuses what isn't a whole number", () => {
    expect(pointsSave(row(), "10")).toEqual({
      kind: "save",
      body: { point_reward: 10 },
    });
    expect(pointsSave(row(), "")).toEqual({
      kind: "save",
      body: { point_reward: null },
    });
    expect(pointsSave(row(), "5")).toEqual({ kind: "none" });
    expect(pointsSave(row({ point_reward: null }), "0")).toEqual({
      kind: "none",
    });
    expect(pointsSave(row(), "-4")).toEqual({
      kind: "problem",
      message: TASK_EDIT_COPY.points,
    });
  });
});

describe("the due", () => {
  it("opens a timed task on its local day and time", () => {
    const at = new Date(2026, 8, 29, 17, 30).toISOString();
    expect(dueDraftOf(row({ due_date: "2026-09-29", due_at: at }))).toEqual({
      date: "2026-09-29",
      time: "17:30",
    });
    expect(dueDraftOf(row())).toEqual({ date: "2026-09-30", time: null });
  });

  it("sends the day and time as a pair, only when they changed", () => {
    expect(dueSave(row(), { date: "2026-09-30", time: null }, NOW)).toEqual({
      kind: "none",
    });
    expect(dueSave(row(), { date: "2026-10-02", time: null }, NOW)).toEqual({
      kind: "save",
      body: { due_date: "2026-10-02", due_at: null },
    });
    const at = new Date(2026, 8, 30, 17, 0).toISOString();
    expect(dueSave(row(), { date: "2026-09-30", time: "17:00" }, NOW)).toEqual({
      kind: "save",
      body: { due_date: "2026-09-30", due_at: at },
    });
  });

  it("takes the time off with due_at null", () => {
    const at = new Date(2026, 8, 30, 17, 0).toISOString();
    expect(
      dueSave(row({ due_at: at }), { date: "2026-09-30", time: null }, NOW),
    ).toEqual({
      kind: "save",
      body: { due_date: "2026-09-30", due_at: null },
    });
  });

  it("refuses a newly picked time already gone today, never the task's own", () => {
    expect(dueSave(row(), { date: "2026-09-29", time: "09:00" }, NOW)).toEqual({
      kind: "problem",
      message: TASK_EDIT_COPY.timePassed,
    });
    // An overdue task keeps its own due while its title changes.
    const passed = new Date(2026, 8, 29, 9, 0).toISOString();
    expect(
      dueSave(
        row({ due_date: "2026-09-29", due_at: passed }),
        { date: "2026-09-29", time: "09:00" },
        NOW,
      ),
    ).toEqual({ kind: "none" });
  });
});

describe("proof, photos and who", () => {
  it("sends a changed proof kind", () => {
    expect(proofSave(row(), "photo")).toEqual({
      kind: "save",
      body: { proof_kind: "photo" },
    });
    expect(proofSave(row(), "none")).toEqual({ kind: "none" });
  });

  it("sends the reference photos as the whole set, only when it changed", () => {
    const held = row({ photos: [photo("a"), photo("b"), photo("c", "proof")] });
    const paths = [photo("a").storage_path, photo("b").storage_path];
    expect(photosSave(held, paths)).toEqual({ kind: "none" });
    expect(photosSave(held, [photo("b").storage_path])).toEqual({
      kind: "save",
      body: { reference_photo_paths: [photo("b").storage_path] },
    });
    expect(photosSave(held, [])).toEqual({
      kind: "save",
      body: { reference_photo_paths: [] },
    });
  });

  it("hands one task to someone else, never a group's copy", () => {
    expect(assigneeSave(row(), "u2")).toEqual({
      kind: "save",
      body: { assignee_id: "u2" },
    });
    expect(assigneeSave(row(), "u1")).toEqual({ kind: "none" });
    expect(assigneeSave(row({ group_id: "g1" }), "u2")).toEqual({
      kind: "none",
    });
  });

  it("asks before a new assignee starts a task under way over", () => {
    expect(reassignRestarts(row())).toBe(false);
    expect(
      reassignRestarts(
        row({ status: "IN_PROGRESS", stored_status: "IN_PROGRESS" }),
      ),
    ).toBe(true);
  });
});

describe("who may edit, and how far it reaches", () => {
  it("edits every copy not yet confirmed on a group task's copy", () => {
    expect(scopedEdit(row({ group_id: "g1" }), { title: "Mop" })).toEqual({
      title: "Mop",
      scope: "group",
    });
    expect(scopedEdit(row(), { title: "Mop" })).toEqual({ title: "Mop" });
  });

  it("is a tasks:manage holder's, until the task is confirmed", () => {
    expect(taskEditable(row(), true)).toBe(true);
    expect(taskEditable(row(), false)).toBe(false);
    expect(taskEditable(row({ points_awarded: true }), true)).toBe(false);
    expect(
      taskEditable(row({ confirmed_at: "2026-09-29T10:00:00.000Z" }), true),
    ).toBe(false);
    // The fields need a day and an assignee.
    expect(taskEditable(row({ due_date: null }), true)).toBe(false);
    expect(taskEditable(row({ assignee_id: null }), true)).toBe(false);
  });
});
