import { describe, expect, it, vi } from "vitest";
import { Alert } from "react-native";
import { toTaskRow, type TaskRowModel } from "./board";
import {
  confirmBarLabel,
  confirmTaskDelete,
  seriesDeleteTakesCopy,
  taskDeleteTarget,
  groupCopies,
  removalAllowed,
  sortCopies,
  taskHistory,
  livePicks,
  markDoneBarLabel,
  removedLine,
  taskBarLayout,
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
      confirm: false,
      confirmInMenu: false,
      sendBack: false,
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

describe("Confirm and Send back (#5513)", () => {
  /** A member's completion, waiting on an officer: points, no proof. */
  const WAITING = {
    status: "COMPLETED",
    stored_status: "COMPLETED",
    completed_at: "2026-11-18T09:00:00.000Z",
  };
  const controlsFor = (
    overrides: Record<string, unknown>,
    viewerId: string | null = "officer",
    canManage = true,
    toggleRefused = false,
  ) =>
    taskScreenControls({
      row: row({ ...WAITING, ...overrides }),
      viewerId,
      canManage,
      toggleRefused,
    });

  it("gives an officer both on someone else's completion, and no Mark done", () => {
    const controls = controlsFor({});
    expect(controls.confirm).toBe(true);
    expect(controls.sendBack).toBe(true);
    expect(controls.confirmInMenu).toBe(true);
    expect(controls.markDone).toBe(false);
    // A proof task: the screen shows the proof, a row's menu can't.
    const proof = controlsFor({ proof_kind: "photo", point_reward: null });
    expect(proof.confirm).toBe(true);
    expect(proof.confirmInMenu).toBe(false);
  });

  it("gives no Confirm on the viewer's own completion (the API refuses a self-confirm), and Mark not done in Send back's place", () => {
    const own = controlsFor({ assignee_id: "officer" });
    expect(own.confirm).toBe(false);
    expect(own.sendBack).toBe(false);
    expect(own.reopen).toBe(true);
  });

  it("gives Send back alone, as chat's card does, on a completion that needed no sign-off", () => {
    // Signed off as it was marked: nothing was paid, so it can go back.
    const auto = controlsFor({
      point_reward: null,
      points_awarded: true,
      confirmed_at: WAITING.completed_at,
    });
    expect(auto.sendBack).toBe(true);
    expect(auto.confirm).toBe(false);
    expect(auto.confirmInMenu).toBe(false);
    // Not paid yet and needing no sign-off: nothing to confirm either.
    const unpaid = controlsFor({ point_reward: null });
    expect(unpaid.sendBack).toBe(true);
    expect(unpaid.confirm).toBe(false);
    expect(taskMenuKeys(auto)).toEqual(["sendBack", "duplicate", "delete"]);
  });

  it("gives neither without tasks:manage, once an officer confirmed it, before it's done, or while refused", () => {
    const none = (controls: ReturnType<typeof controlsFor>) =>
      [controls.confirm, controls.sendBack, controls.confirmInMenu].some(
        Boolean,
      );
    expect(none(controlsFor({}, "officer", false))).toBe(false);
    expect(none(controlsFor({}, null))).toBe(false);
    expect(
      none(
        controlsFor({
          points_awarded: true,
          confirmed_at: "2026-11-18T10:00:00.000Z",
        }),
      ),
    ).toBe(false);
    expect(
      none(
        controlsFor({ status: "IN_PROGRESS", stored_status: "IN_PROGRESS" }),
      ),
    ).toBe(false);
    // Paid without a `confirmed_at`: the ledger's flag alone shuts Confirm.
    expect(controlsFor({ points_awarded: true }).confirm).toBe(false);
    expect(none(controlsFor({}, "officer", true, true))).toBe(false);
  });

  it("puts Confirm then Send back first in a row's menu, Confirm only with no proof to see", () => {
    expect(taskMenuKeys(controlsFor({}))).toEqual([
      "confirm",
      "sendBack",
      "edit",
      "reassign",
      "duplicate",
      "delete",
    ]);
    expect(
      taskMenuKeys(controlsFor({ proof_kind: "link", point_reward: null })),
    ).toEqual(["sendBack", "edit", "reassign", "duplicate", "delete"]);
    // The group's row acts only as a group: no review there.
    expect(taskMenuKeys(controlsFor({ group_id: "g1" }), "group")).toEqual([
      "removePeople",
      "duplicate",
      "deleteForEveryone",
    ]);
  });

  it("names the payout on Confirm beside two rounds, else in its hint", () => {
    expect(confirmBarLabel(10, 2)).toEqual({
      label: "Confirm · +10 pts",
      hint: undefined,
    });
    expect(confirmBarLabel(10, 3)).toEqual({
      label: "Confirm",
      hint: "Awards +10 pts.",
    });
    expect(confirmBarLabel(null, 3)).toEqual({
      label: "Confirm",
      hint: undefined,
    });
  });

  it("lays an officer's usual review out as Confirm with its payout, Send back, and Edit in More", () => {
    const layout = taskBarLayout({
      controls: controlsFor({}),
      removePeople: false,
      otherMoreRows: 1, // Delete
    });
    expect(layout).toEqual({
      sendBackRound: true,
      sendBackInMore: false,
      editRound: false,
      editInMore: true,
      moreShown: true,
      rounds: 2,
    });
    expect(confirmBarLabel(10, layout.rounds).label).toBe("Confirm · +10 pts");
  });

  it("keeps Send back a round until the bar holds three others, then leads More with it", () => {
    // A group's copy: Remove people and More beside Send back; three rounds.
    const group = taskBarLayout({
      controls: controlsFor({ group_id: "g1" }),
      removePeople: true,
      otherMoreRows: 2,
    });
    expect(group.sendBackRound).toBe(true);
    expect(group.rounds).toBe(3);
    // No Confirm (no sign-off needed, not paid yet), so Edit stays a round:
    // Edit, Remove people and More leave Send back no room.
    const crowded = taskBarLayout({
      controls: controlsFor({ group_id: "g1", point_reward: null }),
      removePeople: true,
      otherMoreRows: 2,
    });
    expect(crowded).toMatchObject({
      sendBackRound: false,
      sendBackInMore: true,
      editRound: true,
      rounds: 3,
    });
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

  it("gives an officer on a group's copy Remove people, Delete for everyone, and Reassign for that copy (#5514)", () => {
    expect(keysFor({ group_id: "g1" }, "officer", true)).toEqual([
      "markDone",
      "edit",
      // Hands over this one copy: the instance edit takes `assignee_id`.
      "reassign",
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

describe("Delete on a repeating task (#5119)", () => {
  const series = {
    recurrence_rule: "FREQ=WEEKLY;BYDAY=MO;TZID=America/New_York",
    next_due_date: "2026-11-30",
    ended: false,
  };
  type Button = { text: string; onPress?: () => void };
  const buttonsOf = () =>
    vi.mocked(Alert.alert).mock.calls.at(-1)![2] as Button[];

  it("asks This task only or All upcoming tasks, and hands back the scope", async () => {
    vi.mocked(Alert.alert).mockClear();
    const picked: string[] = [];
    confirmTaskDelete(row({ series }), false, (scope) => picked.push(scope));
    expect(vi.mocked(Alert.alert).mock.calls.at(-1)![0]).toBe(
      "Delete a repeating task",
    );
    buttonsOf().find((b) => b.text === "All upcoming tasks")!.onPress!();
    await Promise.resolve();
    confirmTaskDelete(row({ series }), false, (scope) => picked.push(scope));
    buttonsOf().find((b) => b.text === "This task only")!.onPress!();
    await Promise.resolve();
    expect(picked).toEqual(["series", "instance"]);
  });

  it("asks the plain question for a task that doesn't repeat, or a stopped series", () => {
    for (const task of [row(), row({ series: { ...series, ended: true } })]) {
      vi.mocked(Alert.alert).mockClear();
      const picked: string[] = [];
      confirmTaskDelete(task, false, (scope) => picked.push(scope));
      expect(vi.mocked(Alert.alert).mock.calls.at(-1)![0]).toBe(
        'Delete "Sweep the porch"?',
      );
      buttonsOf().find((b) => b.text === "Delete task")!.onPress!();
      expect(picked).toEqual(["instance"]);
    }
  });

  it("sends each answer as the delete it means", () => {
    expect(taskDeleteTarget("t1", "instance")).toBe("t1");
    expect(taskDeleteTarget("t1", "series")).toEqual({
      id: "t1",
      scope: "series",
    });
    expect(taskDeleteTarget("t1", "group")).toEqual({
      id: "t1",
      scope: "group",
    });
  });

  it("knows a stopped repeat takes only an untouched copy still to come", () => {
    expect(seriesDeleteTakesCopy(row({ series }))).toBe(true);
    expect(
      seriesDeleteTakesCopy(
        row({ series, status: "IN_PROGRESS", stored_status: "IN_PROGRESS" }),
      ),
    ).toBe(false);
    expect(seriesDeleteTakesCopy(row({ series, status: "OVERDUE" }))).toBe(
      false,
    );
    expect(
      seriesDeleteTakesCopy(
        row({
          series,
          subtasks: [
            { id: "s1", title: "Mop", done_at: "2026-11-18T12:00:00Z" },
          ],
        }),
      ),
    ).toBe(false);
  });
});
