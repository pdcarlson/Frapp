import { ASSIGNMENT_TYPES, DOCUMENT_VARIANTS } from "@repo/validation";
import { fuzzyMatch, type FuzzyResult } from "@/lib/search/fuzzy-match";

/**
 * The `/backwork` library's search, filters and ordering, kept free of React
 * so they can be tested on plain rows.
 *
 * All of it runs on the client: `GET /v1/backwork` returns the chapter's whole
 * library in one response, so once it has loaded, a filter or a keystroke
 * re-ranks what is already in memory instead of asking the server again.
 */

export type BackworkResource = {
  id: string;
  title: string | null;
  department_id: string | null;
  course_number: string | null;
  professor_id: string | null;
  year: number | null;
  semester: string | null;
  assignment_type: string | null;
  assignment_number: number | null;
  document_variant: string | null;
  tags: string[] | null;
  is_redacted: boolean;
  created_at: string;
};

export type BackworkDepartment = { id: string; code: string; name: string | null };
export type BackworkProfessor = { id: string; name: string };

/** A row with its department and professor resolved, as the list draws it. */
export type LibraryRow = {
  resource: BackworkResource;
  department: BackworkDepartment | null;
  professor: BackworkProfessor | null;
  /** "COGS 2120", "COGS", "2120", or null. */
  course: string | null;
  /** "Fall 2026", "Fall", "2026", or null. */
  term: string | null;
  title: string;
};

export type LibraryFilters = {
  course: string | null;
  professorId: string | null;
  term: string | null;
  type: string | null;
  variant: string | null;
};

export const NO_FILTERS: LibraryFilters = {
  course: null,
  professorId: null,
  term: null,
  type: null,
  variant: null,
};

/** Shorthand people type for words the library spells out. */
export const BACKWORK_SEARCH_ALIASES: Readonly<Record<string, string>> = {
  hw: "homework",
  hwk: "homework",
  mt: "midterm",
  mid: "midterm",
  ans: "answer",
  sg: "study",
  proj: "project",
  quizz: "quiz",
};

/** Academic order inside one year: a January term comes first. */
const TERM_ORDER: Record<string, number> = {
  Winter: 0,
  Spring: 1,
  Summer: 2,
  Fall: 3,
};

function joinNonEmpty(parts: readonly (string | number | null | undefined)[]): string | null {
  const kept = parts.filter(
    (part): part is string | number => part !== null && part !== undefined && part !== "",
  );
  return kept.length ? kept.join(" ") : null;
}

export function toLibraryRows(
  resources: readonly BackworkResource[],
  departments: readonly BackworkDepartment[],
  professors: readonly BackworkProfessor[],
): LibraryRow[] {
  const departmentById = new Map(departments.map((d) => [d.id, d]));
  const professorById = new Map(professors.map((p) => [p.id, p]));
  return resources.map((resource) => {
    const department = resource.department_id
      ? (departmentById.get(resource.department_id) ?? null)
      : null;
    const professor = resource.professor_id
      ? (professorById.get(resource.professor_id) ?? null)
      : null;
    const course = joinNonEmpty([department?.code, resource.course_number]);
    const fallbackTitle = joinNonEmpty([
      resource.assignment_type ?? "Resource",
      resource.assignment_number,
      course ? `· ${course}` : null,
    ]);
    return {
      resource,
      department,
      professor,
      course,
      term: joinNonEmpty([resource.semester, resource.year]),
      title: resource.title?.trim() || fallbackTitle || "Untitled",
    };
  });
}

/** Everything a member might type to find a row. */
export function searchText(row: LibraryRow): string {
  const { resource, department, professor } = row;
  return [
    row.title,
    department?.code,
    department?.name,
    resource.course_number,
    // "cogs2120" as one word too, for people who type it without the space.
    department?.code && resource.course_number
      ? `${department.code}${resource.course_number}`
      : null,
    professor?.name,
    resource.semester,
    resource.year,
    resource.assignment_type,
    resource.assignment_number,
    resource.document_variant,
    resource.is_redacted ? "redacted" : null,
    ...(resource.tags ?? []),
  ]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ");
}

/** Newest term first; undated rows last; then newest upload. */
export function compareByTerm(a: LibraryRow, b: LibraryRow): number {
  const yearA = a.resource.year ?? -Infinity;
  const yearB = b.resource.year ?? -Infinity;
  if (yearA !== yearB) return yearB - yearA;
  const termA = TERM_ORDER[a.resource.semester ?? ""] ?? -1;
  const termB = TERM_ORDER[b.resource.semester ?? ""] ?? -1;
  if (termA !== termB) return termB - termA;
  return b.resource.created_at.localeCompare(a.resource.created_at);
}

function passesFilters(row: LibraryRow, filters: LibraryFilters): boolean {
  if (filters.course !== null && row.course !== filters.course) return false;
  if (filters.professorId !== null && row.resource.professor_id !== filters.professorId) {
    return false;
  }
  if (filters.term !== null && row.term !== filters.term) return false;
  if (filters.type !== null && row.resource.assignment_type !== filters.type) return false;
  if (filters.variant !== null && row.resource.document_variant !== filters.variant) {
    return false;
  }
  return true;
}

/**
 * Filters, then searches. With a query, best match first (ties newest term
 * first); without one, newest term first.
 */
export function queryLibrary(
  rows: readonly LibraryRow[],
  query: string,
  filters: LibraryFilters,
): FuzzyResult<LibraryRow>[] {
  const ordered = rows.filter((row) => passesFilters(row, filters)).sort(compareByTerm);
  return fuzzyMatch(ordered, query, searchText, BACKWORK_SEARCH_ALIASES);
}

export function hasActiveFilters(filters: LibraryFilters): boolean {
  return Object.values(filters).some((value) => value !== null);
}

export type FilterOption = { value: string; label: string };

/**
 * The choices each filter offers: only values some row actually has, so no
 * choice leads to an empty list.
 */
export function filterOptions(rows: readonly LibraryRow[]): {
  course: FilterOption[];
  professor: FilterOption[];
  term: FilterOption[];
  type: FilterOption[];
  variant: FilterOption[];
} {
  const courses = new Map<string, string>();
  const professors = new Map<string, string>();
  const terms = new Map<string, LibraryRow>();
  const types = new Set<string>();
  const variants = new Set<string>();
  for (const row of rows) {
    if (row.course) {
      courses.set(
        row.course,
        row.department?.name ? `${row.course} · ${row.department.name}` : row.course,
      );
    }
    if (row.professor) professors.set(row.professor.id, row.professor.name);
    if (row.term && !terms.has(row.term)) terms.set(row.term, row);
    if (row.resource.assignment_type) types.add(row.resource.assignment_type);
    if (row.resource.document_variant) variants.add(row.resource.document_variant);
  }
  const byLabel = (a: FilterOption, b: FilterOption) => a.label.localeCompare(b.label);
  return {
    course: [...courses].map(([value, label]) => ({ value, label })).sort(byLabel),
    professor: [...professors].map(([value, label]) => ({ value, label })).sort(byLabel),
    term: [...terms.values()]
      .sort(compareByTerm)
      .map((row) => ({ value: row.term!, label: row.term! })),
    // The enums' own order (Exam before Quiz, Student Copy first), not A to Z.
    type: inEnumOrder(types, ASSIGNMENT_TYPES),
    variant: inEnumOrder(variants, DOCUMENT_VARIANTS),
  };
}

function inEnumOrder(found: ReadonlySet<string>, order: readonly string[]): FilterOption[] {
  const rank = (value: string) => {
    const index = order.indexOf(value);
    return index === -1 ? order.length : index;
  };
  return [...found]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((value) => ({ value, label: value }));
}
