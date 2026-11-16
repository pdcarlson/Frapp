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

/**
 * A Student Copy carries a student's name, and only the browser can black it
 * out, so one uploaded as-is can't be filed as a Student Copy (spec/behavior/
 * backwork.md § PDF Redaction). The API refuses it; the forms say so first.
 */
export function isUnredactedStudentCopy(
  documentVariant: string | null | undefined,
  isRedacted: boolean,
): boolean {
  return documentVariant === "Student Copy" && !isRedacted;
}
