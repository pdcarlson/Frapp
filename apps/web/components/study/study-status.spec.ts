import { describe, expect, it } from "vitest";
import {
  studySessionStatusLabel,
  type StudySessionStatus,
} from "@/components/study/study-status";

describe("studySessionStatusLabel", () => {
  it.each([
    ["ACTIVE", "Active"],
    ["COMPLETED", "Completed"],
    ["EXPIRED", "Expired"],
    ["PAUSED_EXPIRED", "Expired while paused"],
    ["LOCATION_INVALID", "Outside zone"],
  ] as const)("labels %s as %j", (status, label) => {
    expect(studySessionStatusLabel(status)).toBe(label);
  });

  it("never prints an enum token: an unknown status reads as words", () => {
    expect(studySessionStatusLabel("SOMETHING_NEW" as StudySessionStatus)).toBe(
      "Something new",
    );
  });
});
