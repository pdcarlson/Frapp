import { describe, expect, it } from "vitest";
import {
  actionStatus,
  canEditCardTask,
  canReadCardTask,
  readEditableCardTask,
  isTaskStatus,
  readLiveTask,
  taskDueLine,
  taskCardControls,
  taskStatusLabel,
  canReopenOwnTask,
  viewerIsCardAssignee,
  type LiveTask,
} from "./task-card";
import { countCheckedIn } from "./use-attendance";

function live(overrides: Partial<LiveTask> = {}): LiveTask {
  return {
    id: "task-1",
    status: "TODO",
    stored_status: "TODO",
    points_awarded: false,
    assignee_id: undefined,
    subtasks: [],
    due: undefined,
    // Points, so a completion waits on an officer unless a test says not.
    point_reward: 5,
    proof_kind: "none",
    proof_link: null,
    sent_back_at: null,
    sent_back_reason: null,
    completion_note: null,
    photos: [],
    ...overrides,
  };
}

/**
 * The four branches of the #1051 stored-vs-rendered distinction. The web board,
 * the web chat card and the mobile chat card share this one copy.
 */
describe("actionStatus", () => {
  it("offers nothing when stored_status is missing and the rendered status is OVERDUE", () => {
    expect(actionStatus({ status: "OVERDUE" })).toBeUndefined();
  });

  it("treats any other rendered status as stored when stored_status is missing", () => {
    expect(actionStatus({ status: "TODO" })).toBe("TODO");
    expect(actionStatus({ status: "IN_PROGRESS" })).toBe("IN_PROGRESS");
    expect(actionStatus({ status: "COMPLETED" })).toBe("COMPLETED");
  });

  it("maps a persisted OVERDUE row to TODO (the Start move)", () => {
    expect(actionStatus({ status: "OVERDUE", stored_status: "OVERDUE" })).toBe(
      "TODO",
    );
  });

  it("returns the persisted status when it is anything other than OVERDUE", () => {
    expect(actionStatus({ status: "OVERDUE", stored_status: "TODO" })).toBe(
      "TODO",
    );
    expect(
      actionStatus({ status: "OVERDUE", stored_status: "IN_PROGRESS" }),
    ).toBe("IN_PROGRESS");
    expect(
      actionStatus({ status: "COMPLETED", stored_status: "COMPLETED" }),
    ).toBe("COMPLETED");
  });
});

describe("isTaskStatus", () => {
  it("knows the four statuses and nothing else, inherited keys included", () => {
    for (const status of ["TODO", "IN_PROGRESS", "COMPLETED", "OVERDUE"]) {
      expect(isTaskStatus(status)).toBe(true);
    }
    for (const other of [
      "ARCHIVED",
      "todo",
      "",
      "toString",
      "constructor",
      null,
      3,
    ]) {
      expect(isTaskStatus(other)).toBe(false);
    }
  });
});

describe("readLiveTask", () => {
  it("reads what a card needs from GET /v1/tasks/{id}", () => {
    expect(
      readLiveTask({
        id: "task-1",
        title: "Fix the door",
        status: "OVERDUE",
        stored_status: "IN_PROGRESS",
        points_awarded: true,
        point_reward: 5,
        proof_kind: "link",
        proof_link: "https://docs.google.com/x",
        sent_back_at: "2026-11-13T10:00:00.000Z",
        sent_back_reason: "Floor is still sticky",
        completion_note: "",
        photos: [
          { id: "p1", kind: "proof", storage_path: "chapters/c/tasks/1/a.jpg" },
        ],
      }),
    ).toEqual(
      live({
        status: "OVERDUE",
        stored_status: "IN_PROGRESS",
        points_awarded: true,
        proof_kind: "link",
        proof_link: "https://docs.google.com/x",
        sent_back_at: "2026-11-13T10:00:00.000Z",
        sent_back_reason: "Floor is still sticky",
        photos: [
          { id: "p1", kind: "proof", storage_path: "chapters/c/tasks/1/a.jpg" },
        ],
      }),
    );
  });

  it("is null for no data, no id or a status it doesn't know", () => {
    expect(readLiveTask(undefined)).toBe(null);
    expect(readLiveTask({ status: "TODO" })).toBe(null);
    expect(readLiveTask({ id: "task-1", status: "DONE" })).toBe(null);
  });

  it("leaves an unknown stored_status undefined rather than guessing", () => {
    expect(
      readLiveTask({ id: "task-1", status: "OVERDUE", stored_status: 3 })
        ?.stored_status,
    ).toBeUndefined();
  });
});

describe("taskStatusLabel", () => {
  it("names each status, and a confirmed completion as Confirmed", () => {
    expect(taskStatusLabel(live())).toBe("To do");
    expect(taskStatusLabel(live({ status: "OVERDUE" }))).toBe("Overdue");
    expect(taskStatusLabel(live({ status: "COMPLETED" }))).toBe(
      "Waiting on an officer",
    );
    expect(
      taskStatusLabel(live({ status: "COMPLETED", points_awarded: true })),
    ).toBe("Confirmed");
  });

  it("reads Done for a completion that needed no sign-off (#4635)", () => {
    const done = live({
      status: "COMPLETED",
      points_awarded: true,
      point_reward: null,
    });
    expect(taskStatusLabel(done)).toBe("Done");
    // Proof makes it the officer's to confirm.
    expect(taskStatusLabel({ ...done, proof_kind: "photo" })).toBe("Confirmed");
    // A caller that doesn't pass the proof kind can't tell, so Confirmed.
    expect(taskStatusLabel({ status: "COMPLETED", points_awarded: true })).toBe(
      "Confirmed",
    );
  });

  it("reads Needs changes for a sent-back task until it is marked done (#4635)", () => {
    const sentBack = live({
      status: "IN_PROGRESS",
      stored_status: "IN_PROGRESS",
      sent_back_at: "2026-11-13T10:00:00.000Z",
    });
    expect(taskStatusLabel(sentBack)).toBe("Needs changes");
    expect(taskStatusLabel({ ...sentBack, status: "OVERDUE" })).toBe(
      "Needs changes",
    );
    expect(
      taskStatusLabel({
        ...sentBack,
        status: "COMPLETED",
        stored_status: "COMPLETED",
      }),
    ).toBe("Waiting on an officer");
  });
});

describe("canReopenOwnTask (#4635)", () => {
  it("lets the assignee take back a Done that needed no sign-off", () => {
    expect(
      canReopenOwnTask({
        stored: "COMPLETED",
        pointsAwarded: true,
        isAssignee: true,
        needsSignOff: false,
      }),
    ).toBe(true);
    expect(
      canReopenOwnTask({
        stored: "COMPLETED",
        pointsAwarded: true,
        isAssignee: true,
      }),
    ).toBe(false);
  });
});

describe("canReopenOwnTask", () => {
  it("is the assignee's own unconfirmed completion, and nothing else", () => {
    const base = {
      stored: "COMPLETED" as const,
      pointsAwarded: false,
      isAssignee: true,
    };
    expect(canReopenOwnTask(base)).toBe(true);
    expect(canReopenOwnTask({ ...base, pointsAwarded: true })).toBe(false);
    expect(canReopenOwnTask({ ...base, isAssignee: false })).toBe(false);
    expect(canReopenOwnTask({ ...base, stored: "IN_PROGRESS" })).toBe(false);
    expect(canReopenOwnTask({ ...base, stored: undefined })).toBe(false);
  });
});

describe("canReadCardTask", () => {
  it("is the assignee or a tasks:manage holder, the two GET /v1/tasks/{id} answers", () => {
    expect(canReadCardTask({ isAssignee: true, canManage: false })).toBe(true);
    expect(canReadCardTask({ isAssignee: false, canManage: true })).toBe(true);
    expect(canReadCardTask({ isAssignee: false, canManage: false })).toBe(
      false,
    );
  });
});

describe("taskCardControls (#4635)", () => {
  it("offers only Send back on a completion that needed no sign-off", () => {
    for (const points_awarded of [false, true]) {
      expect(
        taskCardControls({
          live: live({
            status: "COMPLETED",
            stored_status: "COMPLETED",
            point_reward: null,
            points_awarded,
          }),
          isAssignee: false,
          canManage: true,
        }),
      ).toEqual(["reject"]);
    }
  });
});

describe("taskCardControls", () => {
  const assignee = { isAssignee: true, canManage: false };
  const admin = { isAssignee: false, canManage: true };
  const assigneeAdmin = { isAssignee: true, canManage: true };
  const bystander = { isAssignee: false, canManage: false };

  it("offers nothing until the live task is read, whatever the snapshot says (#2065)", () => {
    expect(taskCardControls({ live: null, ...assignee })).toEqual([]);
    expect(taskCardControls({ live: null, ...assigneeAdmin })).toEqual([]);
  });

  it("walks the assignee through Start and Mark done off the stored status", () => {
    expect(taskCardControls({ live: live(), ...assignee })).toEqual(["start"]);
    expect(
      taskCardControls({
        live: live({ status: "IN_PROGRESS", stored_status: "IN_PROGRESS" }),
        ...assignee,
      }),
    ).toEqual(["complete"]);
    // Overdue renders the same for both; the stored status decides (#1051).
    expect(
      taskCardControls({
        live: live({ status: "OVERDUE", stored_status: "IN_PROGRESS" }),
        ...assignee,
      }),
    ).toEqual(["complete"]);
    expect(
      taskCardControls({
        live: live({ status: "OVERDUE", stored_status: undefined }),
        ...assignee,
      }),
    ).toEqual([]);
  });

  it("offers a tasks:manage holder Confirm and Reject on a completion", () => {
    const completed = live({ status: "COMPLETED", stored_status: "COMPLETED" });
    expect(taskCardControls({ live: completed, ...admin })).toEqual([
      "confirm",
      "reject",
    ]);
    expect(taskCardControls({ live: completed, ...assignee })).toEqual([]);
    expect(taskCardControls({ live: completed, ...bystander })).toEqual([]);
  });

  it("never offers Confirm on the admin's own task, which the server refuses (#1056)", () => {
    expect(
      taskCardControls({
        live: live({ status: "COMPLETED", stored_status: "COMPLETED" }),
        ...assigneeAdmin,
      }),
    ).toEqual(["reject"]);
  });

  it("leaves only the Confirmed indicator once points are awarded", () => {
    const confirmed = live({
      status: "COMPLETED",
      stored_status: "COMPLETED",
      points_awarded: true,
    });
    expect(taskCardControls({ live: confirmed, ...admin })).toEqual([
      "confirmed",
    ]);
    expect(taskCardControls({ live: confirmed, ...assigneeAdmin })).toEqual([
      "confirmed",
    ]);
  });

  it("gives an admin who isn't the assignee nothing before completion", () => {
    expect(taskCardControls({ live: live(), ...admin })).toEqual([]);
  });
});

describe("countCheckedIn", () => {
  it("counts PRESENT and LATE rows only", () => {
    expect(
      countCheckedIn([
        { status: "PRESENT" },
        { status: "LATE" },
        { status: "ABSENT" },
        { status: "EXCUSED" },
        null,
      ]),
    ).toBe(2);
  });

  it("is null for anything that isn't a roster, so no count is drawn", () => {
    expect(countCheckedIn(undefined)).toBe(null);
    expect(countCheckedIn({ status: "PRESENT" })).toBe(null);
    expect(countCheckedIn([])).toBe(0);
  });
});

describe("viewerIsCardAssignee (#4296)", () => {
  it("follows the live task's assignee once it is read", () => {
    expect(
      viewerIsCardAssignee("u-old", "u-old", live({ assignee_id: "u-new" })),
    ).toBe(false);
    expect(
      viewerIsCardAssignee("u-new", "u-old", live({ assignee_id: "u-new" })),
    ).toBe(true);
  });

  it("reads the snapshot until then, and never matches a missing viewer", () => {
    expect(viewerIsCardAssignee("u-old", "u-old", null)).toBe(true);
    expect(viewerIsCardAssignee("", "", null)).toBe(false);
    expect(viewerIsCardAssignee(null, undefined, live())).toBe(false);
  });
});

describe("readLiveTask's due (#4135)", () => {
  it("takes due_at over due_date, and neither when blank", () => {
    const base = { id: "task-1", status: "TODO" };
    expect(readLiveTask({ ...base, due_date: "2026-11-20" })?.due).toBe(
      "2026-11-20",
    );
    expect(
      readLiveTask({
        ...base,
        due_date: "2026-11-20",
        due_at: "2026-11-20T22:00:00.000Z",
      })?.due,
    ).toBe("2026-11-20T22:00:00.000Z");
    expect(readLiveTask({ ...base, due_date: "", due_at: null })?.due).toBe(
      undefined,
    );
  });
});

describe("taskDueLine (#4133, #4135)", () => {
  const NOW = new Date(2026, 10, 12, 12);

  it("counts down while open and is red only once overdue", () => {
    expect(taskDueLine("2026-11-12", "TODO", NOW)).toEqual({
      text: "Due today",
      overdue: false,
    });
    expect(taskDueLine("2026-11-13", "IN_PROGRESS", NOW)).toEqual({
      text: "Due tomorrow",
      overdue: false,
    });
    expect(taskDueLine("2026-11-10", "TODO", NOW)).toEqual({
      text: "Overdue by 2 days",
      overdue: true,
    });
  });

  it("is red when the server already says OVERDUE", () => {
    expect(taskDueLine("2026-11-12", "OVERDUE", NOW)?.overdue).toBe(true);
  });

  it("never charges a finished task with lateness", () => {
    expect(taskDueLine("2026-11-10", "COMPLETED", NOW)).toEqual({
      text: "Due Nov 10",
      overdue: false,
    });
    expect(taskDueLine("2026-11-13", "COMPLETED", NOW)?.text).toBe(
      "Due tomorrow",
    );
  });

  it("gives the plain date when the status is unknown, and null for no date", () => {
    expect(taskDueLine("2026-11-10", null, NOW)).toEqual({
      text: "Due Nov 10",
      overdue: false,
    });
    expect(taskDueLine(null, "TODO", NOW)).toBeNull();
    expect(taskDueLine("banana", "TODO", NOW)).toBeNull();
  });
});

describe("canEditCardTask (#4512)", () => {
  it("offers Edit to a tasks:manage holder until the task is confirmed", () => {
    expect(canEditCardTask({ live: live(), canManage: true })).toBe(true);
    expect(
      canEditCardTask({
        live: live({ status: "COMPLETED", stored_status: "COMPLETED" }),
        canManage: true,
      }),
    ).toBe(true);
    expect(
      canEditCardTask({
        live: live({ points_awarded: true }),
        canManage: true,
      }),
    ).toBe(false);
  });

  it("offers nothing to anyone else, or before the task is read", () => {
    expect(canEditCardTask({ live: live(), canManage: false })).toBe(false);
    expect(canEditCardTask({ live: null, canManage: true })).toBe(false);
  });
});

describe("readEditableCardTask", () => {
  const raw = {
    id: "task-1",
    title: "Sweep",
    description: null,
    assignee_id: "u1",
    due_date: "2026-11-14",
    due_at: "2026-11-14T22:00:00.000Z",
    point_reward: 5,
    status: "TODO",
    stored_status: "TODO",
    subtasks: [],
  };

  it("reads what the edit form opens on", () => {
    expect(readEditableCardTask(raw)).toEqual({
      id: "task-1",
      title: "Sweep",
      description: null,
      assignee_id: "u1",
      due_date: "2026-11-14",
      due_at: "2026-11-14T22:00:00.000Z",
      point_reward: 5,
      status: "TODO",
      stored_status: "TODO",
      subtasks: [],
      reference_photos: [],
      proof_kind: "none",
    });
  });

  it("carries the task's reference photos and its proof kind (#4635)", () => {
    expect(
      readEditableCardTask({
        ...raw,
        proof_kind: "link",
        photos: [
          {
            id: "p1",
            kind: "reference",
            storage_path: "chapters/c/tasks/1/a.jpg",
          },
          { id: "p2", kind: "proof", storage_path: "chapters/c/tasks/2/b.jpg" },
          { id: "p3", kind: "bogus", storage_path: "x" },
        ],
      }),
    ).toMatchObject({
      reference_photos: [
        {
          id: "p1",
          kind: "reference",
          storage_path: "chapters/c/tasks/1/a.jpg",
        },
      ],
      proof_kind: "link",
    });
  });

  it("is null without a field the form needs", () => {
    expect(readEditableCardTask(undefined)).toBeNull();
    expect(readEditableCardTask({ ...raw, assignee_id: null })).toBeNull();
    expect(readEditableCardTask({ ...raw, due_date: "" })).toBeNull();
  });
});
