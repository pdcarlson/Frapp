import { describe, expect, it } from "vitest";
import { taskLinkChoices, type TaskLinkSource } from "./task-link-choices";

const NOW = new Date("2026-11-20T12:00:00");
const names: Record<string, string> = { u1: "Moiz Khan", u2: "Paul Carlson" };
const nameOf = (id: string) => names[id] ?? "Member";

function task(over: Partial<TaskLinkSource>): TaskLinkSource {
  return {
    id: over.title ?? "t",
    title: "Task",
    status: "TODO",
    due_date: "2026-11-21",
    assignee_id: "u1",
    ...over,
  };
}

describe("taskLinkChoices (#5772)", () => {
  it("puts open tasks first by due, then finished ones newest first", () => {
    const rows = taskLinkChoices(
      [
        task({
          title: "Done long ago",
          status: "COMPLETED",
          completed_at: "2026-11-01T00:00:00Z",
          points_awarded: true,
        }),
        task({ title: "Later", due_date: "2026-11-25" }),
        task({
          title: "Done lately",
          status: "COMPLETED",
          completed_at: "2026-11-19T00:00:00Z",
          points_awarded: true,
        }),
        task({ title: "Tomorrow", due_date: "2026-11-21" }),
      ],
      "",
      nameOf,
      NOW,
    );
    expect(rows.map((row) => row.title)).toEqual([
      "Tomorrow",
      "Later",
      "Done lately",
      "Done long ago",
    ]);
  });

  it("says whose it is and when it is due", () => {
    const [row] = taskLinkChoices(
      [task({ title: "Fix the door", assignee_id: "u2" })],
      "",
      nameOf,
      NOW,
    );
    expect(row).toEqual({
      id: "Fix the door",
      title: "Fix the door",
      detail: "Paul Carlson · Due tomorrow",
      done: false,
    });
  });

  it("labels a finished task as the board does, Done when it needed no sign-off", () => {
    const [row] = taskLinkChoices(
      [
        task({
          title: "Sweep",
          status: "COMPLETED",
          points_awarded: true,
          point_reward: null,
          proof_kind: "none",
          completed_at: "2026-11-19T10:00:00Z",
        }),
      ],
      "",
      nameOf,
      NOW,
    );
    expect(row?.detail).toBe("Moiz Khan · Done");
  });

  it("matches every typed word in the title, in any case or order", () => {
    const rows = taskLinkChoices(
      [
        task({ title: "Clean the kitchen" }),
        task({ title: "Kitchen inventory" }),
      ],
      "KITCHEN clean",
      nameOf,
      NOW,
    );
    expect(rows.map((row) => row.title)).toEqual(["Clean the kitchen"]);
  });
});
