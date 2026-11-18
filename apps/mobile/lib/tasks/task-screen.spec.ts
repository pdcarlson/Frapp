import { describe, expect, it } from "vitest";
import { toTaskRow, type TaskRowModel } from "./board";
import {
  groupCopies,
  removalAllowed,
  sortCopies,
  taskHistory,
  livePicks,
  markDoneBarLabel,
  removedLine,
  taskMenuKeys,
  taskScreenControls,
} from "./task-screen";
import {
  DEFAULT_DUE_CHOICE,
  duplicateWho,
  taskDuplicateOf,
} from "./create-task";

const NOW = new Date(2026, 10, 18, 12, 0);

function row(overrides: Record<string, unknown> = {}): TaskRowModel {
  return toTaskRow({
    id: "t1",
    title: "Sweep the porch",
    created_by: "officer",
    assignee_id: "me",
    status: "TODO",
    stored_status: "TODO",
    due_date: "2026-11-20",
    point_reward: 5,
    points_awarded: false,
    proof_kind: "none",
    created_at: new Date(2026, 10, 16, 9, 0).toISOString(),
    ...overrides,
  })!;
}

const nameOf = (id: string) => (id === "me" ? "you" : `Name ${id}`);

describe("taskHistory", () => {
  it("lists what happened, oldest first", () => {
    const lines = taskHistory(
      row({
        status: "COMPLETED",
        stored_status: "COMPLETED",
        points_awarded: true,
        completed_at: new Date(2026, 10, 17, 10, 0).toISOString(),
        confirmed_at: new Date(2026, 10, 17, 11, 0).toISOString(),
      }),
      nameOf,
      NOW,
    );
    expect(lines.map((line) => line.title)).toEqual([
      "Assigned by Name officer",
      "Marked done",
      "Confirmed",
    ]);
  });

  it("gives a send-back its reason, and a task that needed no sign-off no Confirmed", () => {
    const sentBack = taskHistory(
      row({
        status: "IN_PROGRESS",
        stored_status: "IN_PROGRESS",
        sent_back_at: new Date(2026, 10, 17, 10, 0).toISOString(),
        sent_back_reason: "Floor is still sticky",
      }),
      nameOf,
      NOW,
    );
    expect(sentBack.at(-1)!.title).toBe("Sent back");
    expect(sentBack.at(-1)!.meta).toContain("Floor is still sticky");

    const at = new Date(2026, 10, 17, 10, 0).toISOString();
    const auto = taskHistory(
      row({
        status: "COMPLETED",
        stored_status: "COMPLETED",
        point_reward: null,
        points_awarded: true,
        completed_at: at,
        confirmed_at: at,
      }),
      nameOf,
      NOW,
    );
    expect(auto.map((line) => line.key)).toEqual(["assigned", "done"]);
  });
});

describe("taskScreenControls", () => {
  it("gives a member Mark done on their own task, and nothing an officer has", () => {
    expect(
      taskScreenControls({
        row: row(),
        viewerId: "me",
        canManage: false,
        toggleRefused: false,
      }),
    ).toEqual({
      markDone: true,
      // Their own To do: chat's card offered Start, and so do these (#5492).
      start: true,
      edit: false,
      removePeople: false,
      reopen: false,
      release: false,
      delete: false,
      deleteForEveryone: false,
      reassign: false,
      duplicate: false,
    });
  });

  it("gives Start to the assignee of a To do only: not once started, not an officer, not while refused", () => {
    const start = (
      overrides: Record<string, unknown>,
      viewerId: string,
      canManage = false,
      toggleRefused = false,
    ) =>
      taskScreenControls({
        row: row(overrides),
        viewerId,
        canManage,
        toggleRefused,
      }).start;
    expect(start({}, "me")).toBe(true);
    // Overdue still reads its stored To do.
    expect(start({ status: "OVERDUE" }, "me")).toBe(true);
    expect(
      start({ status: "IN_PROGRESS", stored_status: "IN_PROGRESS" }, "me"),
    ).toBe(false);
    // The API's move is the assignee's, whatever the officer holds.
    expect(start({}, "officer", true)).toBe(false);
    expect(start({}, "me", false, true)).toBe(false);
  });

  it("gives no Mark done to someone who neither has the task nor manages tasks, or while refused", () => {
    expect(
      taskScreenControls({
        row: row(),
        viewerId: "other",
        canManage: false,
        toggleRefused: false,
      }).markDone,
    ).toBe(false);
    expect(
      taskScreenControls({
        row: row(),
        viewerId: "me",
        canManage: false,
        toggleRefused: true,
      }).markDone,
    ).toBe(false);
  });

  it("refuses Edit once confirmed, and keeps Mark not done the assignee's", () => {
    const waiting = row({
      status: "COMPLETED",
      stored_status: "COMPLETED",
    });
    expect(
      taskScreenControls({
        row: waiting,
        viewerId: "officer",
        canManage: true,
        toggleRefused: false,
      }).reopen,
    ).toBe(false);
    expect(
      taskScreenControls({
        row: waiting,
        viewerId: "me",
        canManage: false,
        toggleRefused: false,
      }).reopen,
    ).toBe(true);
    const confirmed = taskScreenControls({
      row: row({
        status: "COMPLETED",
        stored_status: "COMPLETED",
        points_awarded: true,
      }),
      viewerId: "officer",
      canManage: true,
      toggleRefused: false,
    });
    expect(confirmed.edit).toBe(false);
    expect(confirmed.delete).toBe(true);
  });

  it("offers Remove people and Delete for everyone only on a group's copy", () => {
    const controls = taskScreenControls({
      row: row({ group_id: "g1" }),
      viewerId: "officer",
      canManage: true,
      toggleRefused: false,
    });
    expect(controls.removePeople).toBe(true);
    expect(controls.deleteForEveryone).toBe(true);
  });
});

describe("taskMenuKeys (#5492)", () => {
  const keysFor = (
    overrides: Record<string, unknown>,
    viewerId: string,
    canManage: boolean,
    scope?: "copy" | "group",
  ) =>
    taskMenuKeys(
      taskScreenControls({
        row: row(overrides),
        viewerId,
        canManage,
        toggleRefused: false,
      }),
      scope,
    );

  it("gives a member only Mark done and Start on their own To do", () => {
    expect(keysFor({}, "me", false)).toEqual(["markDone", "start"]);
  });

  it("gives a member nothing on a task that isn't theirs", () => {
    expect(keysFor({}, "other", false)).toEqual([]);
  });

  it("gives an officer on a member's task everything but Remove people, Delete last", () => {
    expect(keysFor({}, "officer", true)).toEqual([
      "markDone",
      "edit",
      "reassign",
      "duplicate",
      "delete",
    ]);
  });

  it("gives an officer on a group's copy Remove people and Delete for everyone, and no Reassign", () => {
    expect(keysFor({ group_id: "g1" }, "officer", true)).toEqual([
      "markDone",
      "edit",
      "removePeople",
      "duplicate",
      "delete",
      "deleteForEveryone",
    ]);
  });

  it("gives a Calendar row standing for every copy only the group's actions", () => {
    expect(keysFor({ group_id: "g1" }, "officer", true, "group")).toEqual([
      "removePeople",
      "duplicate",
      "deleteForEveryone",
    ]);
  });

  it("leaves a confirmed task with no Mark done, Edit or Reassign", () => {
    const confirmed = {
      status: "COMPLETED",
      stored_status: "COMPLETED",
      points_awarded: true,
    };
    expect(keysFor(confirmed, "officer", true)).toEqual([
      "duplicate",
      "delete",
    ]);
    expect(keysFor(confirmed, "me", false)).toEqual([]);
  });

  it("gives the assignee Mark not done on their unconfirmed completion", () => {
    expect(
      keysFor({ status: "COMPLETED", stored_status: "COMPLETED" }, "me", false),
    ).toEqual(["reopen"]);
  });
});

describe("taskDuplicateOf (#5492)", () => {
  it("copies the words, points, proof, steps and who, as a new task", () => {
    const prefill = taskDuplicateOf(
      row({
        description: "Mop too.",
        proof_kind: "photo",
        subtasks: [
          { id: "s1", title: "Sweep", done: true },
          { id: "s2", title: "Mop", done: false },
        ],
      }),
      [],
      NOW,
    );
    expect(prefill).toEqual({
      title: "Sweep the porch",
      description: "Mop too.",
      who: { kind: "person", userId: "me" },
      pointsInput: "5",
      proofKind: "photo",
      subtasks: ["Sweep", "Mop"],
      due: { kind: "date", date: "2026-11-20" },
      dueTime: null,
    });
  });

  it("falls back to Today for a day that has gone", () => {
    expect(
      taskDuplicateOf(row({ due_date: "2026-11-01" }), [], NOW).due,
    ).toEqual(DEFAULT_DUE_CHOICE);
  });

  it("keeps today but drops a time already passed, so New task opens ready to create", () => {
    // NOW is noon on Nov 18; due at 9 that morning, and at 6 that evening.
    const at = (hour: number) => new Date(2026, 10, 18, hour, 0).toISOString();
    const passed = taskDuplicateOf(
      row({ due_date: "2026-11-18", due_at: at(9) }),
      [],
      NOW,
    );
    expect(passed.due).toEqual({ kind: "date", date: "2026-11-18" });
    expect(passed.dueTime).toBeNull();
    const ahead = taskDuplicateOf(
      row({ due_date: "2026-11-18", due_at: at(18) }),
      [],
      NOW,
    );
    expect(ahead.dueTime).toBe("18:00");
  });

  it("sends a group's copy to the group again", () => {
    const everyone = row({
      group_id: "g1",
      group: { audience: "everyone", total: 3, done: 0, confirmed: 0 },
    });
    expect(duplicateWho(everyone, [])).toEqual({
      kind: "each",
      target: { kind: "chapter" },
    });
    const role = row({
      group_id: "g1",
      group: { audience: "role", target_id: "r1", total: 3 },
    });
    expect(duplicateWho(role, [])).toEqual({
      kind: "each",
      target: { kind: "role", id: "r1" },
    });
    const people = row({
      group_id: "g1",
      group: { audience: "people", total: 2 },
    });
    expect(
      duplicateWho(people, [
        row({ id: "a", assignee_id: "u1", group_id: "g1" }),
        row({ id: "b", assignee_id: "u2", group_id: "g1" }),
      ]),
    ).toEqual({
      kind: "each",
      target: { kind: "people", userIds: ["u1", "u2"] },
    });
  });
});

describe("Who has it", () => {
  const data = [
    { ...rawCopy("a"), status: "COMPLETED", points_awarded: true },
    { ...rawCopy("b"), status: "OVERDUE" },
    rawCopy("c"),
    { ...rawCopy("d"), status: "COMPLETED" },
    { ...rawCopy("x"), group_id: "other" },
  ];

  function rawCopy(assignee: string): Record<string, unknown> {
    return {
      id: `copy-${assignee}`,
      title: "Form",
      assignee_id: assignee,
      status: "TODO",
      group_id: "g1",
    };
  }

  it("reads the group's copies off the list, what's left first", () => {
    const copies = sortCopies(groupCopies(data, "g1"), (id) => id);
    expect(copies.map((copy) => copy.assigneeId)).toEqual(["b", "c", "d", "a"]);
    expect(groupCopies(data, null)).toEqual([]);
  });

  it("allows a removal of some copies, never none or every one", () => {
    const copies = groupCopies(data, "g1");
    expect(removalAllowed(new Set(), copies)).toEqual({
      ok: false,
      everyone: false,
      count: 0,
    });
    expect(removalAllowed(new Set(["b", "c"]), copies).ok).toBe(true);
    // "a" is confirmed, so it can't be among the picks: the rest isn't everyone.
    expect(removalAllowed(new Set(["a", "b", "c", "d"]), copies)).toEqual({
      ok: true,
      everyone: false,
      count: 3,
    });
    const open = copies.filter((copy) => copy.assigneeId !== "a");
    expect(removalAllowed(new Set(["b", "c", "d"]), open)).toEqual({
      ok: false,
      everyone: true,
      count: 3,
    });
  });

  it("counts only picks still among the removable copies, so a stale one can't read as everyone", () => {
    const copies = groupCopies(data, "g1");
    // "x" left on a refetch, "a" is confirmed.
    expect([...livePicks(new Set(["b", "x", "a"]), copies)]).toEqual(["b"]);
    const two = copies.filter((copy) => ["b", "c"].includes(copy.assigneeId!));
    expect(removalAllowed(new Set(["b", "gone", "also-gone"]), two)).toEqual({
      ok: true,
      everyone: false,
      count: 1,
    });
  });
});

describe("removedLine", () => {
  it("says nothing changed when every pick had already left", () => {
    expect(removedLine(0)).toBe("They were already off this task.");
    expect(removedLine(1)).toBe("Took 1 person out of this task.");
    expect(removedLine(2)).toBe("Took 2 people out of this task.");
  });
});

describe("Mark done in the bar", () => {
  it("offers no Mark done on a status this build can't move", () => {
    expect(
      taskScreenControls({
        row: row({ status: "ARCHIVED", stored_status: "ARCHIVED" }),
        viewerId: "me",
        canManage: true,
        toggleRefused: false,
      }).markDone,
    ).toBe(false);
  });

  it("gives an officer who isn't the assignee Mark done", () => {
    expect(
      taskScreenControls({
        row: row(),
        viewerId: "officer",
        canManage: true,
        toggleRefused: false,
      }).markDone,
    ).toBe(true);
  });

  it("shortens the verb beside two or more rounds, and says the proof in its hint", () => {
    expect(markDoneBarLabel("photo", 1)).toEqual({
      label: "Mark done with a photo",
      hint: undefined,
    });
    expect(markDoneBarLabel("photo", 3)).toEqual({
      label: "Mark done",
      hint: "Mark done with a photo.",
    });
    expect(markDoneBarLabel("none", 3)).toEqual({
      label: "Mark done",
      hint: undefined,
    });
  });
});
