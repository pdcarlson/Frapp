import { describe, expect, it } from "vitest";
import { similarTask, taskTitleLikeness, taskTitleWords } from "./similar-task";

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
    ).toBeGreaterThanOrEqual(0.8);
  });

  it("does not match tasks that only share a word", () => {
    expect(taskTitleLikeness("Book the hall", "Book the DJ")).toBe(0);
    expect(taskTitleLikeness("Order shirts", "Order pizza for rush")).toBe(0);
    // The word that says which one is the one that differs.
    expect(
      taskTitleLikeness(
        "Book hall for spring formal",
        "Book hall for fall formal",
      ),
    ).toBeLessThan(0.8);
    expect(
      taskTitleLikeness("Order shirts round 1", "Order shirts round 2"),
    ).toBeLessThan(0.8);
    expect(
      taskTitleLikeness(
        "Clean the house before formal",
        "Clean the house after formal",
      ),
    ).toBeLessThan(0.8);
    // "about" says nothing about which task it is.
    expect(
      taskTitleLikeness(
        "Email alumni about homecoming",
        "Email alumni about formal",
      ),
    ).toBeLessThan(0.8);
  });

  it("holds down a short title inside a much longer one", () => {
    expect(
      taskTitleLikeness(
        "Plan rush week",
        "Plan rush week budget, venue, food, shirts, flyers and schedule",
      ),
    ).toBeLessThan(0.8);
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
});
