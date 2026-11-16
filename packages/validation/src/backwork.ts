// ── Backwork ─────────────────────────────────────────────────────────────────

export const SEMESTERS = ["Spring", "Summer", "Fall", "Winter"] as const;
export const ASSIGNMENT_TYPES = [
  "Exam",
  "Midterm",
  "Final Exam",
  "Quiz",
  "Homework",
  "Lab",
  "Project",
  "Study Guide",
  "Notes",
  "Other",
] as const;
export const DOCUMENT_VARIANTS = [
  "Student Copy",
  "Blank Copy",
  "Answer Key",
] as const;

function joinNonEmpty(
  parts: readonly (string | number | null | undefined)[],
): string | null {
  const kept = parts.filter(
    (part): part is string | number =>
      part !== null && part !== undefined && part !== "",
  );
  return kept.length ? kept.join(" ") : null;
}

/** "CSCI 1200", "CSCI", "1200", or null: how a file's course is written. */
export function backworkCourseCode(
  departmentCode: string | null | undefined,
  courseNumber: string | null | undefined,
): string | null {
  return joinNonEmpty([departmentCode, courseNumber?.trim()]);
}

/** "Fall 2026", "Fall", "2026", or null. */
export function backworkTerm(file: {
  semester: string | null;
  year: number | null;
}): string | null {
  return joinNonEmpty([file.semester, file.year]);
}

/**
 * What a backwork file is called wherever it is listed: the title it was
 * uploaded with, else its type and number and course ("Midterm 2 · CSCI
 * 1200"), else "Untitled". The `/backwork` library rows and Frapp AI's file
 * sources (#5209) both name files with this, so a file reads the same in both.
 */
export function backworkFileTitle(
  file: {
    title: string | null;
    assignment_type: string | null;
    assignment_number: number | null;
  },
  courseCode: string | null,
): string {
  const fallback = joinNonEmpty([
    file.assignment_type ?? "Resource",
    file.assignment_number,
    courseCode ? `· ${courseCode}` : null,
  ]);
  return file.title?.trim() || fallback || "Untitled";
}
