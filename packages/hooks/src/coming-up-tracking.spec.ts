import { describe, expect, it } from "vitest";
import { readComingUpEvents, readComingUpTasks } from "./coming-up-tracking";

describe("Coming up's reads", () => {
  it("keeps the event rows a date can match, and skips the rest", () => {
    expect(
      readComingUpEvents([
        { id: "e1", name: "Formal", start_time: "2026-12-06T19:00:00Z", x: 1 },
        { id: "e2", name: "No time" },
        null,
      ]),
    ).toEqual([
      { id: "e1", name: "Formal", start_time: "2026-12-06T19:00:00Z" },
    ]);
    expect(readComingUpEvents(undefined)).toEqual([]);
  });

  it("keeps a task's day, owner and group, and skips a row without them", () => {
    expect(
      readComingUpTasks([
        {
          id: "t1",
          title: "Pay dues",
          due_date: "2026-12-04",
          assignee_id: "u1",
          group_id: "g1",
        },
        { id: "t2", title: "No owner", due_date: "2026-12-04" },
      ]),
    ).toEqual([
      {
        id: "t1",
        title: "Pay dues",
        due_date: "2026-12-04",
        assignee_id: "u1",
        group_id: "g1",
      },
    ]);
  });
});
