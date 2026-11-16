import { describe, expect, it } from "vitest";
import {
  backworkCourseCode,
  backworkFileTitle,
  backworkTerm,
} from "./backwork";

const file = {
  title: null,
  assignment_type: "Midterm",
  assignment_number: 2,
};

describe("how a backwork file is named (#5209)", () => {
  it("keeps the title it was uploaded with", () => {
    expect(
      backworkFileTitle({ ...file, title: " Exam review " }, "CSCI 1200"),
    ).toBe("Exam review");
  });

  it("falls back to type, number and course, then to Untitled", () => {
    expect(backworkFileTitle(file, "CSCI 1200")).toBe("Midterm 2 · CSCI 1200");
    expect(
      backworkFileTitle(
        { title: null, assignment_type: null, assignment_number: null },
        null,
      ),
    ).toBe("Resource");
  });

  it("writes the course and the term from whichever parts are there", () => {
    expect(backworkCourseCode("CSCI", " 1200 ")).toBe("CSCI 1200");
    expect(backworkCourseCode(null, "1200")).toBe("1200");
    expect(backworkCourseCode(undefined, null)).toBeNull();
    expect(backworkTerm({ semester: "Fall", year: 2025 })).toBe("Fall 2025");
    expect(backworkTerm({ semester: null, year: null })).toBeNull();
  });
});
