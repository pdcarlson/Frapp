import { describe, expect, it } from "vitest";
import { pickRepeatPreset, TASK_SERIES_SCOPE_COPY } from "@repo/validation";
import type { LiveTask, LiveTaskPhoto } from "@repo/hooks";
import { toTaskRow, type TaskRowModel } from "./board";
import {
  assigneeSave,
  descriptionSave,
  dueDraftOf,
  dueSave,
  editFactsOfLive,
  editFactsOfRow,
  photosSave,
  pointsSave,
  proofSave,
  reassignRestarts,
  repeatDraftOf,
  repeatEditable,
  repeatSave,
  rowAfter,
  scopedEdit,
  seriesScopeOf,
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
    const stored = [photo("a").storage_path, photo("b").storage_path];
    expect(photosSave(stored, [...stored])).toEqual({ kind: "none" });
    expect(photosSave(stored, [photo("b").storage_path])).toEqual({
      kind: "save",
      body: { reference_photo_paths: [photo("b").storage_path] },
    });
    expect(photosSave(stored, [])).toEqual({
      kind: "save",
      body: { reference_photo_paths: [] },
    });
  });

  it("hands a task, or one copy of a group's, to someone else", () => {
    expect(assigneeSave(row(), "u2")).toEqual({
      kind: "save",
      body: { assignee_id: "u2" },
    });
    expect(assigneeSave(row(), "u1")).toEqual({ kind: "none" });
    expect(assigneeSave(row({ group_id: "g1" }), "u2")).toEqual({
      kind: "save",
      body: { assignee_id: "u2" },
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

describe("a change measured against the save before it", () => {
  it("reads the task as each field's save will leave it", () => {
    const after = rowAfter(row(), {
      title: "Mop",
      description: null,
      point_reward: 10,
      due_date: "2026-10-02",
      due_at: null,
      proof_kind: "photo",
    });
    expect(after).toMatchObject({
      title: "Mop",
      description: null,
      pointReward: 10,
      dueDay: "2026-10-02",
      dueAt: null,
      proofKind: "photo",
    });
    // A change back to what the task said before still sends.
    expect(titleSave(after, "Sweep")).toEqual({
      kind: "save",
      body: { title: "Sweep" },
    });
    // What a body doesn't name stays as read.
    expect(rowAfter(row(), { title: "Mop" }).description).toBe(
      "Front and back.",
    );
  });
});

describe("who may edit, and how far it reaches", () => {
  it("edits every copy not yet confirmed on a group task's copy, but hands over only this copy", () => {
    const copy = row({ group_id: "g1" });
    expect(scopedEdit(copy, { title: "Mop" })).toEqual({
      title: "Mop",
      scope: "group",
    });
    // A group edit refuses `assignee_id`; the instance edit takes it.
    expect(scopedEdit(copy, { assignee_id: "u2" })).toEqual({
      assignee_id: "u2",
    });
    expect(scopedEdit(row(), { title: "Mop" })).toEqual({ title: "Mop" });
  });

  it("is a tasks:manage holder's, until the task is confirmed", () => {
    const can = (overrides: Record<string, unknown>, manage = true) =>
      taskEditable(editFactsOfRow(row(overrides)), manage);
    expect(can({})).toBe(true);
    expect(can({}, false)).toBe(false);
    expect(can({ points_awarded: true })).toBe(false);
    expect(can({ confirmed_at: "2026-09-29T10:00:00.000Z" })).toBe(false);
    // The fields need a day and an assignee.
    expect(can({ due_date: null })).toBe(false);
    expect(can({ assignee_id: null })).toBe(false);
  });

  it("reads a chat card's live task by the same rule", () => {
    const live = {
      points_awarded: false,
      confirmed_at: null,
      assignee_id: "u1" as string | undefined,
      due: "2026-09-30" as string | undefined,
    } as LiveTask;
    expect(taskEditable(editFactsOfLive(live), true)).toBe(true);
    // Up for grabs: no assignee yet, so nothing for the screen to edit.
    expect(
      taskEditable(editFactsOfLive({ ...live, assignee_id: undefined }), true),
    ).toBe(false);
    // Signed off as it was marked, with no points paid.
    expect(
      taskEditable(
        editFactsOfLive({ ...live, confirmed_at: "2026-09-29T10:00:00Z" }),
        true,
      ),
    ).toBe(false);
    expect(
      taskEditable(editFactsOfLive({ ...live, due: undefined }), true),
    ).toBe(false);
  });
});

describe("a copy of a repeating task (#5119)", () => {
  const RULE = "FREQ=WEEKLY;BYDAY=WE;TZID=America/New_York";
  const live = (overrides: Record<string, unknown> = {}) =>
    row({
      series_id: "s1",
      series: {
        recurrence_rule: RULE,
        next_due_date: "2026-10-07",
        ended: false,
      },
      ...overrides,
    });

  it("reads its series off the task", () => {
    expect(live().series).toEqual({
      recurrence_rule: RULE,
      next_due_date: "2026-10-07",
      ended: false,
    });
    expect(row().series).toBeNull();
  });

  it("asks on the copy still to come, as web's panel does", () => {
    expect(seriesScopeOf(live(), { title: "Mop" })).toEqual({ kind: "ask" });
    expect(seriesScopeOf(live(), { point_reward: 3 })).toEqual({
      kind: "ask",
    });
  });

  it("saves one copy without asking where All upcoming tasks can't apply", () => {
    // Not a copy of a live series.
    expect(seriesScopeOf(row(), { title: "Mop" })).toEqual({
      kind: "instance",
    });
    const ended = live({
      series: {
        recurrence_rule: RULE,
        next_due_date: "2026-10-07",
        ended: true,
      },
    });
    expect(seriesScopeOf(ended, { title: "Mop" })).toEqual({
      kind: "instance",
    });
    // Overdue or done: All upcoming tasks wouldn't change this copy.
    expect(
      seriesScopeOf(live({ status: "OVERDUE" }), { title: "Mop" }),
    ).toEqual({ kind: "instance" });
    expect(
      seriesScopeOf(live({ status: "COMPLETED", stored_status: "COMPLETED" }), {
        title: "Mop",
      }),
    ).toEqual({ kind: "instance" });
    // A move to another day moves this copy; the schedule stays.
    expect(
      seriesScopeOf(live(), { due_date: "2026-10-01", due_at: null }),
    ).toEqual({ kind: "instance" });
    // Photos go on the copy they were added to.
    expect(
      seriesScopeOf(live(), { reference_photo_paths: ["chapters/c/p.jpg"] }),
    ).toEqual({ kind: "instance" });
  });

  it("asks for a new time on the same day", () => {
    expect(
      seriesScopeOf(live(), {
        due_date: "2026-09-30",
        due_at: new Date(2026, 8, 30, 21, 0).toISOString(),
      }),
    ).toEqual({ kind: "ask" });
  });

  it("saves a Repeat change to the series, from the copy still to come only", () => {
    expect(seriesScopeOf(live(), { recurrence_rule: null })).toEqual({
      kind: "series",
    });
    expect(
      seriesScopeOf(live({ status: "OVERDUE" }), { recurrence_rule: null }),
    ).toEqual({
      kind: "refuse",
      message: TASK_SERIES_SCOPE_COPY.repeatFromNext,
    });
    expect(repeatEditable(live())).toBe(true);
    expect(repeatEditable(live({ status: "OVERDUE" }))).toBe(false);
    expect(repeatEditable(row())).toBe(false);
  });

  it("sends the Repeat only when it changed", () => {
    const task = live();
    const stored = repeatDraftOf(task)!;
    expect(stored.preset).toBe("WEEKLY");
    expect(repeatSave(task, stored)).toEqual({ kind: "none" });
    // Doesn't repeat stops it.
    expect(repeatSave(task, pickRepeatPreset(stored, "NONE"))).toEqual({
      kind: "save",
      body: { recurrence_rule: null },
    });
    const daily = repeatSave(task, pickRepeatPreset(stored, "DAILY"));
    expect(daily.kind).toBe("save");
    expect(daily.kind === "save" && daily.body.recurrence_rule).toMatch(
      /^FREQ=DAILY;/,
    );
    // A task that doesn't repeat has no Repeat to save.
    expect(repeatSave(row(), stored)).toEqual({ kind: "none" });
  });

  it("measures the next change against a stopped series", () => {
    const after = rowAfter(live(), { recurrence_rule: null });
    expect(after.series?.ended).toBe(true);
  });
});
