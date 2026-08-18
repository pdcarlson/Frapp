import { describe, expect, it } from "vitest";
import { isOpenTask, nextTapSequence } from "./transitions";

describe("isOpenTask", () => {
  it("keeps every status except COMPLETED", () => {
    expect(isOpenTask("TODO")).toBe(true);
    expect(isOpenTask("IN_PROGRESS")).toBe(true);
    expect(isOpenTask("OVERDUE")).toBe(true);
    expect(isOpenTask(null)).toBe(true);
  });

  it("excludes COMPLETED — the rule selectNextTask applies", () => {
    expect(isOpenTask("COMPLETED")).toBe(false);
  });
});

describe("nextTapSequence", () => {
  it("walks a fresh task through both server transitions", () => {
    // The server has no TODO -> COMPLETED edge, so one tap is two PATCHes.
    expect(nextTapSequence("TODO", "TODO")).toEqual([
      "IN_PROGRESS",
      "COMPLETED",
    ]);
  });

  it("completes a started task in one write", () => {
    expect(nextTapSequence("IN_PROGRESS", "IN_PROGRESS")).toEqual(["COMPLETED"]);
  });

  it("offers nothing on a completed task", () => {
    expect(nextTapSequence("COMPLETED", "COMPLETED")).toEqual([]);
  });

  it("reads the stored status, not the derived OVERDUE", () => {
    // Both rows render OVERDUE; only stored_status says which write is legal.
    expect(nextTapSequence("TODO", "OVERDUE")).toEqual([
      "IN_PROGRESS",
      "COMPLETED",
    ]);
    expect(nextTapSequence("IN_PROGRESS", "OVERDUE")).toEqual(["COMPLETED"]);
  });

  it("falls back to the display status when it is itself a stored value", () => {
    // The chat `kind:"task"` card ships a bare `status`.
    expect(nextTapSequence(null, "TODO")).toEqual(["IN_PROGRESS", "COMPLETED"]);
  });

  it("goes inert when only OVERDUE is known", () => {
    // Neither transition is recoverable, and guessing 400s half the time.
    expect(nextTapSequence(null, "OVERDUE")).toEqual([]);
  });

  it("never throws on an unrecognised status", () => {
    expect(nextTapSequence("ARCHIVED", null)).toEqual([]);
    expect(nextTapSequence(null, null)).toEqual([]);
    expect(nextTapSequence("", "")).toEqual([]);
  });
});
