import { describe, expect, it } from "vitest";
import type { OpenTask } from "@repo/hooks";
import {
  claimedLine,
  claimedTaskId,
  claimLost,
  openTaskLine,
  openTaskWho,
  selectOpenTasks,
} from "./open-tasks";

/** Up for grabs on the Tasks screen (the Tasks overhaul § 3), apart from it. */
const NOW = new Date(2026, 10, 18, 9, 0); // Wednesday, November 18

const posting = (over: Partial<OpenTask> = {}): OpenTask =>
  ({
    id: "open-1",
    title: "Drive the van",
    due_date: "2026-11-20",
    due_at: null,
    point_reward: 10,
    scope: "chapter",
    scope_id: null,
    scope_name: null,
    scope_user_ids: null,
    status: "open",
    viewer_can_claim: true,
    ...over,
  }) as OpenTask;

describe("selectOpenTasks", () => {
  it("keeps open postings, less any a claim just lost", () => {
    const rows = [
      posting(),
      posting({ id: "open-2", status: "claimed" }),
      posting({ id: "open-3" }),
    ];
    expect(selectOpenTasks(rows).map((row) => row.id)).toEqual([
      "open-1",
      "open-3",
    ]);
    expect(
      selectOpenTasks(rows, new Set(["open-1"])).map((row) => row.id),
    ).toEqual(["open-3"]);
    expect(selectOpenTasks(undefined)).toEqual([]);
  });
});

describe("openTaskLine", () => {
  it("says points, the group it's narrowed to, and the due", () => {
    expect(
      openTaskLine(
        posting({ scope: "group", scope_id: "g-1", scope_name: "Philanthropy" }),
        NOW,
      ),
    ).toBe("10 points · Philanthropy · Due Friday");
  });

  it("names no set for the chapter or for people picked by name", () => {
    expect(openTaskLine(posting(), NOW)).toBe("10 points · Due Friday");
    expect(
      openTaskLine(posting({ scope: "people", point_reward: null }), NOW),
    ).toBe("Due Friday");
  });
});

describe("openTaskWho", () => {
  it("names who may claim it, by first name for people", () => {
    const nameOf = (id: string) =>
      ({ a: "Sam Lee", b: "Alex Kim" })[id] ?? "Member";
    expect(openTaskWho(posting(), nameOf)).toMatch(/chapter/i);
    expect(
      openTaskWho(
        posting({ scope: "people", scope_user_ids: ["a", "b"] }),
        nameOf,
      ),
    ).toMatch(/Sam.*Alex/);
  });
});

describe("a claim", () => {
  it("says it's yours, and when it's due", () => {
    expect(claimedLine(posting(), NOW)).toBe("It's yours. Due Friday.");
  });

  it("reads a lost race and the new task", () => {
    expect(claimLost({ statusCode: 409 })).toBe(true);
    expect(claimLost({ statusCode: 500 })).toBe(false);
    expect(claimedTaskId({ id: "task-1" })).toBe("task-1");
    expect(claimedTaskId(null)).toBeNull();
    expect(claimedTaskId({ id: 4 })).toBeNull();
  });
});
