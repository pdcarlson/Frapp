import {
  ASSIGNMENT_TYPES,
  DOCUMENT_VARIANTS,
  MAX_BACKWORK_DRAFT_BATCH,
  SEMESTERS,
  YEAR_MAX,
  isUnredactedStudentCopy,
} from "@repo/validation";
import type { BackworkDraft, BackworkDraftFields } from "@repo/hooks";
import { BACKWORK_YEAR_MIN } from "./finish";

/**
 * The review table's columns (#5208): what a person checks on every
 * document before it is published. Tags and the course name stay as they were
 * typed in the upload form; the table edits the fields a batch gets wrong.
 */
export type DraftColumn =
  | "title"
  | "department_code"
  | "course_number"
  | "professor_name"
  | "assignment_type"
  | "assignment_number"
  | "semester"
  | "year"
  | "document_variant";

type ColumnSpec = {
  key: DraftColumn;
  label: string;
  kind: "text" | "int" | "choice";
  choices?: readonly string[];
  /** Smallest and largest whole number the API takes, for `int` columns. */
  min?: number;
  max?: number;
  /** Longest text the API takes, for `text` columns. */
  maxLength?: number;
};

export const DRAFT_COLUMNS: readonly ColumnSpec[] = [
  { key: "title", label: "Title", kind: "text", maxLength: 255 },
  { key: "department_code", label: "Department", kind: "text", maxLength: 20 },
  { key: "course_number", label: "Course", kind: "text", maxLength: 20 },
  { key: "professor_name", label: "Professor", kind: "text", maxLength: 255 },
  { key: "assignment_type", label: "Type", kind: "choice", choices: ASSIGNMENT_TYPES },
  // The API takes up to int4; no assignment is numbered past a few hundred.
  { key: "assignment_number", label: "Number", kind: "int", min: 1, max: 9_999 },
  { key: "semester", label: "Semester", kind: "choice", choices: SEMESTERS },
  { key: "year", label: "Year", kind: "int", min: BACKWORK_YEAR_MIN, max: YEAR_MAX },
  { key: "document_variant", label: "Copy", kind: "choice", choices: DOCUMENT_VARIANTS },
];

export function columnSpec(key: DraftColumn): ColumnSpec {
  const spec = DRAFT_COLUMNS.find((column) => column.key === key);
  if (!spec) throw new Error(`Unknown draft column ${key}`);
  return spec;
}

/** A cell's text: what the draft holds, or blank. */
export function cellText(draft: BackworkDraft, key: DraftColumn): string {
  const value = draft.draft_fields?.[key];
  return value === null || value === undefined ? "" : String(value);
}

/**
 * The patch a cell's text makes: the parsed value, or `null` to clear it.
 * `undefined` when the text isn't a value the column takes (a year before
 * 1900, a type not on the list), so the edit is dropped rather than sent.
 */
export function cellPatch(
  key: DraftColumn,
  raw: string,
): BackworkDraftFields | undefined {
  const spec = columnSpec(key);
  const text = raw.trim();
  if (text === "") return { [key]: null };
  if (spec.kind === "int") {
    if (!/^\d+$/.test(text)) return undefined;
    const value = Number(text);
    if (!Number.isSafeInteger(value) || value < (spec.min ?? 0)) return undefined;
    if (spec.max !== undefined && value > spec.max) return undefined;
    return { [key]: value };
  }
  if (spec.kind === "choice") {
    return spec.choices?.includes(text) ? { [key]: text } : undefined;
  }
  if (spec.maxLength !== undefined && text.length > spec.maxLength) return undefined;
  return { [key]: text };
}

/**
 * Why a draft can't be published as it stands, or null. Mirrors the API's
 * rule (`fileRefusal` in `backwork.service.ts`) so the table says it before
 * the press: a Student Copy has to have been flattened.
 */
export function publishBlocker(draft: BackworkDraft): string | null {
  if (isUnredactedStudentCopy(draft.draft_fields?.document_variant, draft.is_redacted)) {
    return "Uploaded as-is, so it can't be a Student Copy.";
  }
  return null;
}

/** A title a person can find the row by, before one is typed. */
export function draftLabel(draft: BackworkDraft): string {
  const title = draft.draft_fields?.title?.trim();
  if (title) return title;
  const name = draft.storage_path.split("/").pop() ?? "";
  return name || "Untitled";
}

/** Splits ids into calls the API takes (`MAX_BACKWORK_DRAFT_BATCH` each). */
export function chunkIds(ids: readonly string[]): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_BACKWORK_DRAFT_BATCH) {
    chunks.push(ids.slice(i, i + MAX_BACKWORK_DRAFT_BATCH));
  }
  return chunks;
}
