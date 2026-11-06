import { ASSIGNMENT_TYPES, DOCUMENT_VARIANTS } from "@repo/validation";
import {
  fuzzyMatchWords,
  normalizeWords,
  type FuzzyResult,
} from "@/lib/search/fuzzy-match";

/**
 * The `/backwork` library's search, filters and ordering, kept free of React
 * so they can be tested on plain rows.
 *
 * All of it runs on the client: `GET /v1/backwork` returns the chapter's
 * library in one unpaginated response, so once it has loaded, a filter or a
 * keystroke re-ranks what is already in memory instead of asking the server
 * again. That response is capped at `BACKWORK_LIST_CAP` rows, newest first;
 * past it the page says it is showing only the newest files.
 */

/**
 * PostgREST's `max_rows` (`supabase/config.toml`, and Supabase's hosted
 * default). The list query has no `.range()`, so a library longer than this
 * comes back as its newest rows with no signal; a response this long is
 * treated as truncated.
 */
export const BACKWORK_LIST_CAP = 1000;

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
  /** The stored object's key; the zip takes the file's extension from it. */
  storage_path: string;
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
  /** `searchText` normalised once, so a keystroke only scores. */
  words: readonly string[];
};

/**
 * A Course filter value naming a whole department ("every COGS file") rather
 * than one course, so the library still browses by department as
 * `spec/behavior/backwork.md` § Browsing and Search says.
 */
const DEPARTMENT_PREFIX = "dept:";

export function departmentFilterValue(departmentId: string): string {
  return `${DEPARTMENT_PREFIX}${departmentId}`;
}

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
    const row = {
      resource,
      department,
      professor,
      course,
      term: joinNonEmpty([resource.semester, resource.year]),
      title: resource.title?.trim() || fallbackTitle || "Untitled",
      words: [] as readonly string[],
    };
    row.words = normalizeWords(searchText(row));
    return row;
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
  if (filters.course !== null) {
    const matches = filters.course.startsWith(DEPARTMENT_PREFIX)
      ? row.department?.id === filters.course.slice(DEPARTMENT_PREFIX.length)
      : row.course === filters.course;
    if (!matches) return false;
  }
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
  return fuzzyMatchWords(ordered, query, (row) => row.words, BACKWORK_SEARCH_ALIASES);
}

export function hasActiveFilters(filters: LibraryFilters): boolean {
  return Object.values(filters).some((value) => value !== null);
}

export type FilterOption = { value: string; label: string };

type Options = ReturnType<typeof filterOptions>;

/** Which `filterOptions` list each filter draws its choices from. */
export const OPTION_FOR: Record<keyof LibraryFilters, keyof Options> = {
  course: "course",
  professorId: "professor",
  term: "term",
  type: "type",
  variant: "variant",
};

/**
 * The filters with any value no row has any more set back to "any", so a
 * filter naming a professor a merge just deleted cannot empty the list or
 * leave its chip showing a raw id.
 */
export function liveFilters(filters: LibraryFilters, options: Options): LibraryFilters {
  let changed = false;
  const next = { ...filters };
  for (const key of Object.keys(OPTION_FOR) as (keyof LibraryFilters)[]) {
    const value = filters[key];
    if (value !== null && !options[OPTION_FOR[key]].some((o) => o.value === value)) {
      next[key] = null;
      changed = true;
    }
  }
  return changed ? next : filters;
}

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
  const departments = new Map<string, { code: string; courses: Set<string> }>();
  const professors = new Map<string, string>();
  const terms = new Map<string, LibraryRow>();
  const types = new Set<string>();
  const variants = new Set<string>();
  for (const row of rows) {
    if (row.department && row.course) {
      const entry = departments.get(row.department.id) ?? {
        code: row.department.code,
        courses: new Set<string>(),
      };
      entry.courses.add(row.course);
      departments.set(row.department.id, entry);
    }
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
    // Each course, plus "every course" for a department that has more than
    // one, which sorts first among its courses ("COGS · all courses" before
    // "COGS 2120").
    course: [
      ...[...courses].map(([value, label]) => ({ value, label })),
      ...[...departments]
        .filter(([, entry]) => entry.courses.size > 1)
        .map(([id, entry]) => ({
          value: departmentFilterValue(id),
          label: `${entry.code} · all courses`,
        })),
    ].sort(byLabel),
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
