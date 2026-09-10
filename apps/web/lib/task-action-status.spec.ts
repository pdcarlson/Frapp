import { describe, expect, it } from "vitest";
import { actionStatus } from "./task-action-status";

/**
 * The four branches of the #1051 stored-vs-rendered distinction. Both
 * `tasks-board.tsx` and the chat `task-card.tsx` used to each own a copy;
 * this is the lock that they now share one.
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
