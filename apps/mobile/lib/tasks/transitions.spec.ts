import { describe, expect, it } from "vitest";
import { checkboxSequence, isOpenTask, nextTapSequence } from "./transitions";

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
    expect(nextTapSequence("IN_PROGRESS", "IN_PROGRESS")).toEqual([
      "COMPLETED",
    ]);
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

  it("walks a stored OVERDUE as TODO, as every task surface does", () => {
    // The server accepts OVERDUE → IN_PROGRESS; `actionStatus` in @repo/hooks
    // maps it, and the chat task cards offer Start on the same row.
    expect(nextTapSequence("OVERDUE", "OVERDUE")).toEqual([
      "IN_PROGRESS",
      "COMPLETED",
    ]);
  });

  it("falls back to the display status when it is itself a stored value", () => {
    // A pre-#1051 API ships a bare `status`.
    expect(nextTapSequence(null, "TODO")).toEqual(["IN_PROGRESS", "COMPLETED"]);
  });

  it("goes inert when only OVERDUE is known", () => {
    // Neither transition is recoverable, and guessing 400s half the time.
    expect(nextTapSequence(null, "OVERDUE")).toEqual([]);
  });

  it("never throws on an unrecognised status", () => {
    expect(nextTapSequence("ARCHIVED", null)).toEqual([]);
    // An unknown stored value is not read as missing.
    expect(nextTapSequence("ARCHIVED", "TODO")).toEqual([]);
    expect(nextTapSequence(null, null)).toEqual([]);
    expect(nextTapSequence("", "")).toEqual([]);
  });
});

describe("checkboxSequence", () => {
  const at = (storedStatus: string, pointsAwarded = false) => ({
    storedStatus,
    displayStatus: storedStatus,
    pointsAwarded,
  });

  it("walks an open task to done, as the tap ladder does", () => {
    expect(checkboxSequence(at("TODO"))).toEqual(["IN_PROGRESS", "COMPLETED"]);
    expect(checkboxSequence(at("IN_PROGRESS"))).toEqual(["COMPLETED"]);
  });

  it("unchecks the member's own completion until an officer confirms it", () => {
    expect(checkboxSequence(at("COMPLETED"))).toEqual(["IN_PROGRESS"]);
    expect(checkboxSequence(at("COMPLETED", true))).toEqual([]);
  });
});

describe("checkboxSequence — Done without sign-off (#4635)", () => {
  const done = {
    storedStatus: "COMPLETED",
    displayStatus: "COMPLETED",
    pointsAwarded: true,
  };

  it("still unchecks a Done that needed no sign-off: nothing was paid", () => {
    expect(
      checkboxSequence({ ...done, pointReward: null, proofKind: "none" }),
    ).toEqual(["IN_PROGRESS"]);
  });

  it("leaves a confirmed task with points or proof alone", () => {
    expect(
      checkboxSequence({ ...done, pointReward: 5, proofKind: "none" }),
    ).toEqual([]);
    expect(
      checkboxSequence({ ...done, pointReward: null, proofKind: "photo" }),
    ).toEqual([]);
    // Without the fields, the safe side: as needing sign-off.
    expect(checkboxSequence(done)).toEqual([]);
  });
});
