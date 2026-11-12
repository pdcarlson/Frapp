import { describe, expect, it } from "vitest";
import {
  actionStatus,
  canReadCardTask,
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
      }),
    ).toEqual(
      live({
        status: "OVERDUE",
        stored_status: "IN_PROGRESS",
        points_awarded: true,
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
