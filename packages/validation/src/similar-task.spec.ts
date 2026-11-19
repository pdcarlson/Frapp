import { describe, expect, it } from "vitest";
import {
  existingTasks,
  similarTask,
  taskTitleLikeness,
  taskTitleWords,
} from "./similar-task";

describe("similar tasks (#5562)", () => {
  it("reads the words that say which task it is", () => {
    expect([
      ...taskTitleWords("Book the hall for the Formal's dinners"),
    ]).toEqual(["book", "hall", "formal", "dinner"]);
  });

  it("matches the same task worded another way", () => {
    expect(
      taskTitleLikeness("Book the hall for formal", "Formal: book hall"),
    ).toBe(1);
    expect(
      taskTitleLikeness(
        "Email alumni about homecoming",
        "Send homecoming email to alumni",
      ),
    ).toBeGreaterThanOrEqual(0.75);
  });

  it("does not match tasks that only share a word", () => {
    expect(taskTitleLikeness("Book the hall", "Book the DJ")).toBe(0);
    expect(taskTitleLikeness("Order shirts", "Order pizza for rush")).toBe(0);
  });

  it("holds down a short title inside a much longer one", () => {
    expect(
      taskTitleLikeness(
        "Plan rush week",
        "Plan rush week budget, venue, food, shirts, flyers and schedule",
      ),
    ).toBeLessThan(0.75);
  });

  it("picks the closest open task and skips finished ones", () => {
    const tasks = [
      { id: "done", title: "Book the hall for formal", status: "COMPLETED" },
      {
        id: "near",
        title: "Book formal hall, caterer, DJ, photographer and buses",
        status: "TODO",
      },
      { id: "same", title: "Formal hall: book it", status: "IN_PROGRESS" },
      { id: "other", title: "Order shirts", status: "TODO" },
    ];
    expect(similarTask("Book the hall for formal", tasks)?.id).toBe("same");
    expect(similarTask("Call the caterer", tasks)).toBeNull();
    expect(similarTask("Book the hall for formal", [tasks[0]!])).toBeNull();
  });

  it("reads the task list's rows, skipping ones without an id and title", () => {
    expect(
      existingTasks([
        {
          id: "a",
          title: "Order shirts",
          status: "TODO",
          due_date: "2026-11-21",
          due_at: null,
        },
        { id: "b" },
        null,
        "row",
      ]),
    ).toEqual([
      {
        id: "a",
        title: "Order shirts",
        status: "TODO",
        due_date: "2026-11-21",
        due_at: null,
      },
    ]);
    expect(existingTasks(undefined)).toEqual([]);
  });
});
