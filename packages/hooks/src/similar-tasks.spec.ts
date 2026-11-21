import { describe, expect, it } from "vitest";
import { existingTaskLine, readExistingTasks } from "./similar-tasks";

describe("existing tasks a suggestion may duplicate (#5562)", () => {
  it("reads the task list's rows, skipping ones without an id, title or known status", () => {
    expect(
      readExistingTasks([
        {
          id: "a",
          title: "Order shirts",
          status: "TODO",
          due_date: "2026-11-21",
          due_at: null,
          points_awarded: false,
          sent_back_at: null,
        },
        { id: "b", title: "No status" },
        { id: "c", title: "Odd status", status: "LATER" },
        null,
        "row",
      ]),
    ).toEqual([
      {
        id: "a",
        title: "Order shirts",
        status: "TODO",
        due: "2026-11-21",
        points_awarded: false,
        sent_back_at: null,
      },
    ]);
    expect(readExistingTasks(undefined)).toEqual([]);
  });

  it("says where it stands as its own row does, sent back included", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    const [task] = readExistingTasks([
      {
        id: "a",
        title: "Book the hall",
        status: "IN_PROGRESS",
        due_date: "2026-11-25",
        sent_back_at: "2026-11-18T10:00:00Z",
      },
    ]);
    expect(existingTaskLine(task!, now)).toMatch(/^Needs changes · Due /);
    expect(
      existingTaskLine({ ...task!, sent_back_at: null, due: null }, now),
    ).toBe("In progress");
  });
});
