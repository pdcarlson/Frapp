import { describe, expect, it } from "vitest";
import { selectTaskRows } from "./board";

function at(year: number, month: number, day: number, hour = 12): Date {
  return new Date(year, month - 1, day, hour, 0, 0, 0);
}

const NOW = at(2026, 8, 17);
const ME = "viewer-1";

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: "t1",
    title: "Submit ride-share list",
    assignee_id: ME,
    status: "TODO",
    stored_status: "TODO",
    due_date: "2026-08-18",
    completed_at: null,
    point_reward: 5,
    points_awarded: false,
    ...overrides,
  };
}

const titles = (rows: { title: string }[]) => rows.map((row) => row.title);

describe("selectTaskRows — identity", () => {
  it("returns an empty board before the viewer id resolves", () => {
    // Not "no tasks" — /v1/users/me has not answered. The screen renders this
    // as still-loading, or every cold start flashes an empty state.
    expect(selectTaskRows([task()], null, NOW)).toEqual({
      dueThisWeek: [],
      later: [],
      total: 0,
    });
  });

  it("keeps only the viewer's rows", () => {
    // A tasks:manage holder is served the whole chapter set by the API.
    const board = selectTaskRows(
      [
        task({ id: "a", title: "Mine" }),
        task({ id: "b", title: "Theirs", assignee_id: "someone-else" }),
      ],
      ME,
      NOW,
    );
    expect(board.total).toBe(1);
    expect(titles(board.dueThisWeek)).toEqual(["Mine"]);
  });
});

describe("selectTaskRows — narrowing", () => {
  it("survives a payload that is not a list", () => {
    for (const value of [null, undefined, {}, "rows", 7]) {
      expect(selectTaskRows(value, ME, NOW).total).toBe(0);
    }
  });

  it("drops rows that cannot be drawn honestly", () => {
    const board = selectTaskRows(
      [
        task({ id: "keep" }),
        task({ id: undefined, title: "No id" }),
        task({ id: "no-title", title: "" }),
      ],
      ME,
      NOW,
    );
    expect(board.total).toBe(1);
  });

  it("reads overdue off the row rather than recomputing it", () => {
    // The server derives OVERDUE in UTC; a local recomputation would disagree
    // with it every evening west of Greenwich.
    const board = selectTaskRows(
      [task({ status: "OVERDUE", stored_status: "TODO", due_date: "2026-08-15" })],
      ME,
      NOW,
    );
    expect(board.dueThisWeek[0]?.isOverdue).toBe(true);
    expect(board.dueThisWeek[0]?.storedStatus).toBe("TODO");
  });
});

describe("selectTaskRows — grouping", () => {
  it("puts today through six days out in DUE THIS WEEK", () => {
    const board = selectTaskRows(
      [
        task({ id: "a", title: "Today", due_date: "2026-08-17" }),
        task({ id: "b", title: "Tomorrow", due_date: "2026-08-18" }),
        task({ id: "c", title: "Six", due_date: "2026-08-23" }),
      ],
      ME,
      NOW,
    );
    expect(titles(board.dueThisWeek)).toEqual(["Today", "Tomorrow", "Six"]);
    expect(board.later).toEqual([]);
  });

  it("puts seven days out and beyond in LATER", () => {
    const board = selectTaskRows(
      [
        task({ id: "a", title: "Seven", due_date: "2026-08-24" }),
        task({ id: "b", title: "Far", due_date: "2026-09-30" }),
      ],
      ME,
      NOW,
    );
    expect(board.dueThisWeek).toEqual([]);
    expect(titles(board.later)).toEqual(["Seven", "Far"]);
  });

  it("leads with the most overdue row, above anything still ahead", () => {
    const board = selectTaskRows(
      [
        task({ id: "a", title: "Today", due_date: "2026-08-17" }),
        task({ id: "b", title: "Late", due_date: "2026-08-16", status: "OVERDUE" }),
        task({ id: "c", title: "Latest", due_date: "2026-07-20", status: "OVERDUE" }),
      ],
      ME,
      NOW,
    );
    expect(titles(board.dueThisWeek)).toEqual(["Latest", "Late", "Today"]);
  });

  it("keeps an undateable row in LATER rather than dropping it", () => {
    const board = selectTaskRows(
      [
        task({ id: "a", title: "Dated", due_date: "2026-09-01" }),
        task({ id: "b", title: "Blank", due_date: "" }),
        task({ id: "c", title: "Garbage", due_date: "not-a-date" }),
      ],
      ME,
      NOW,
    );
    // Hiding a task the member owes is worse than an odd-looking row.
    expect(titles(board.later)).toEqual(["Dated", "Blank", "Garbage"]);
  });

  it("orders same-day rows stably by title", () => {
    const board = selectTaskRows(
      [
        task({ id: "a", title: "Beta", due_date: "2026-08-18" }),
        task({ id: "b", title: "Alpha", due_date: "2026-08-18" }),
      ],
      ME,
      NOW,
    );
    expect(titles(board.dueThisWeek)).toEqual(["Alpha", "Beta"]);
  });
});

describe("selectTaskRows — completed rows", () => {
  const done = (overrides: Record<string, unknown>) =>
    task({
      status: "COMPLETED",
      stored_status: "COMPLETED",
      points_awarded: true,
      ...overrides,
    });

  it("keeps a recently finished task and sorts it below open work", () => {
    const board = selectTaskRows(
      [
        done({
          id: "a",
          title: "Paid dues",
          due_date: "2026-08-14",
          completed_at: at(2026, 8, 15).toISOString(),
        }),
        task({ id: "b", title: "Open", due_date: "2026-08-18" }),
      ],
      ME,
      NOW,
    );
    expect(titles(board.dueThisWeek)).toEqual(["Open", "Paid dues"]);
    expect(board.dueThisWeek[1]?.isDone).toBe(true);
  });

  it("retires a task finished more than a week ago", () => {
    const board = selectTaskRows(
      [
        done({
          id: "a",
          title: "Ancient",
          due_date: "2026-08-01",
          completed_at: at(2026, 8, 2).toISOString(),
        }),
      ],
      ME,
      NOW,
    );
    expect(board.total).toBe(0);
  });

  it("keeps a long-overdue task that was only just completed", () => {
    // Retention is measured from completion, not the deadline. Keying it on the
    // due date drops the row in the same render as the tap that closed it — the
    // checkbox never fills and the row vanishes, reading as a delete.
    const board = selectTaskRows(
      [
        done({
          id: "a",
          title: "Finally done",
          due_date: "2026-08-01",
          completed_at: NOW.toISOString(),
        }),
      ],
      ME,
      NOW,
    );
    expect(board.total).toBe(1);
  });

  it("keeps a finished task whose completion time cannot be read", () => {
    // Retiring on a timestamp this module never saw is the worse failure.
    const board = selectTaskRows(
      [done({ id: "a", title: "Undated", due_date: "2026-07-01", completed_at: null })],
      ME,
      NOW,
    );
    expect(board.total).toBe(1);
  });

  it("keeps a completed task that is still within the window", () => {
    const board = selectTaskRows(
      [
        done({
          id: "a",
          title: "Edge",
          due_date: "2026-08-10",
          completed_at: at(2026, 8, 12).toISOString(),
        }),
      ],
      ME,
      NOW,
    );
    expect(board.total).toBe(1);
  });
});
