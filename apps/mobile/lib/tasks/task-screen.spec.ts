import { describe, expect, it } from "vitest";
import { toTaskRow, type TaskRowModel } from "./board";
import {
  groupCopies,
  removalAllowed,
  sortCopies,
  taskHistory,
  taskLink,
  taskScreenControls,
} from "./task-screen";

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
      "Marked done by you",
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
      edit: false,
      removePeople: false,
      reopen: false,
      release: false,
      delete: false,
      deleteForEveryone: false,
    });
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
    });
    expect(removalAllowed(new Set(["b", "c"]), copies).ok).toBe(true);
    expect(removalAllowed(new Set(["a", "b", "c", "d"]), copies)).toEqual({
      ok: false,
      everyone: true,
    });
  });
});

describe("taskLink", () => {
  it("is the app link that opens the task screen", () => {
    expect(taskLink("t 1")).toBe("frapp://task-details?id=t%201");
  });
});
