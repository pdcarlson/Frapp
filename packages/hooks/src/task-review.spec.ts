import { describe, expect, it } from "vitest";
import type { LiveTask } from "./task-card";
import {
  isAwaitingReview,
  sendBackReasonChips,
  taskHandedInLine,
  taskReview,
  withReasonChip,
} from "./task-review";

// Both instants fall on Nov 4 in UTC and in US zones, so "today" holds wherever this runs.
const NOW = new Date("2026-11-04T12:00:00.000Z");

function submitted(overrides: Partial<LiveTask> = {}): LiveTask {
  return {
    id: "task-1",
    status: "COMPLETED",
    stored_status: "COMPLETED",
    points_awarded: false,
    assignee_id: "user-1",
    subtasks: [],
    due: "2026-11-05",
    point_reward: 10,
    proof_kind: "photo",
    proof_link: null,
    sent_back_at: null,
    sent_back_reason: null,
    completion_note: null,
    completed_at: "2026-11-04T10:00:00.000Z",
    confirmed_at: null,
    photos: [],
    ...overrides,
  };
}

describe("taskReview", () => {
  it("says who-when, on time, and what Confirm pays", () => {
    const review = taskReview(
      submitted({
        completion_note: "  Vacuumed and made the bed ",
        photos: [
          { id: "r", kind: "reference", storage_path: "a" },
          { id: "p", kind: "proof", storage_path: "b" },
        ],
      }),
      NOW,
    );
    expect(review).toMatchObject({
      resubmitted: false,
      timing: "on time",
      confirmLabel: "Confirm · +10 pts",
      sentBackReason: null,
      note: "Vacuumed and made the bed",
    });
    // The clock is the machine's zone; the words around it are the point.
    expect(review.submitted).toMatch(/^Submitted today at \d/);
    expect(review.proofPhotos.map((photo) => photo.id)).toEqual(["p"]);
    expect(review.referencePhotos.map((photo) => photo.id)).toEqual(["r"]);
  });

  it("reads a resubmission with the reason it answers, and a late one", () => {
    const review = taskReview(
      submitted({
        due: "2026-11-03",
        sent_back_at: "2026-11-03T20:00:00.000Z",
        sent_back_reason: "Floor still dirty",
      }),
      NOW,
    );
    expect(review.submitted).toMatch(/^Resubmitted today at \d/);
    expect(review.sentBackReason).toBe("Floor still dirty");
    expect(review.timing).toBe("late");
  });

  it("says nothing of timing without a due date, and Confirm alone with no points", () => {
    const review = taskReview(
      submitted({ due: undefined, point_reward: null }),
    );
    expect(review.timing).toBeNull();
    expect(review.confirmLabel).toBe("Confirm");
  });
});

describe("isAwaitingReview", () => {
  it("is a completion with no sign-off yet", () => {
    expect(isAwaitingReview(submitted())).toBe(true);
    expect(
      isAwaitingReview(submitted({ confirmed_at: "2026-11-04T17:00:00.000Z" })),
    ).toBe(false);
    expect(
      isAwaitingReview(
        submitted({ status: "IN_PROGRESS", stored_status: "IN_PROGRESS" }),
      ),
    ).toBe(false);
  });

  it("goes by the stored status, not an OVERDUE display", () => {
    expect(isAwaitingReview(submitted({ status: "OVERDUE" }))).toBe(true);
  });
});

describe("send-back reasons", () => {
  it("offers reasons that fit the proof asked for", () => {
    expect(sendBackReasonChips("photo")).toContain("Wrong photo");
    expect(sendBackReasonChips("link")).toContain("Link doesn't open");
    expect(sendBackReasonChips("none")).toEqual([
      "Not finished",
      "Needs another look",
    ]);
  });

  it("fills an empty reason and adds to a typed one, once", () => {
    expect(withReasonChip("  ", "Not finished")).toBe("Not finished");
    expect(withReasonChip("Floor is sticky.", "Wrong photo")).toBe(
      "Floor is sticky. Wrong photo",
    );
    expect(withReasonChip("Wrong photo", "wrong photo")).toBe("Wrong photo");
  });
});

describe("taskHandedInLine (#5732)", () => {
  const nameOf = (id: string) =>
    id === "me" ? "you" : id === "moiz" ? "Moiz Steenhuis" : "Paul Carlson";
  const done = {
    status: "COMPLETED",
    stored_status: "COMPLETED",
    completed_at: "2026-11-04T10:05:00.000Z",
    assignee_id: "moiz",
    sent_back_at: null,
  };

  it("says who marked it done and when", () => {
    expect(taskHandedInLine(done, nameOf, NOW)).toMatch(
      /^Moiz Steenhuis marked it done today at /,
    );
  });

  it("names an officer who marked it done for them", () => {
    expect(
      taskHandedInLine({ ...done, completed_by: "paul" }, nameOf, NOW),
    ).toMatch(/^Paul Carlson marked it done/);
  });

  it("reads You for the viewer, and again on a resubmission", () => {
    expect(
      taskHandedInLine(
        { ...done, completed_by: "me", sent_back_at: "2026-11-03T10:00:00Z" },
        nameOf,
        NOW,
      ),
    ).toMatch(/^You marked it done again today at /);
  });

  it("says nothing while the task is open, as after a take-back", () => {
    expect(
      taskHandedInLine(
        {
          ...done,
          status: "OVERDUE",
          stored_status: "IN_PROGRESS",
          completed_at: null,
        },
        nameOf,
        NOW,
      ),
    ).toBeNull();
  });
});
