import type { FilterOption } from "@/components/shared/filter-chip";
import { ASSIGNMENT_TYPES, DOCUMENT_VARIANTS } from "@repo/validation";
import {
  fuzzyMatchWords,
  isNumeralWord,
  matchQueryWord,
  normalizeWords,
  withNumeralVariants,
  type FuzzyResult,
} from "@repo/hooks/fuzzy-match";

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
/**
 * What the chapter calls one course (#3848). A file joins it by its
 * department and course number, the number trimmed and lowercased
 * (`course_key`, which the database generates).
 */
export type BackworkCourse = {
  id: string;
  department_id: string;
  course_number: string;
  course_key: string;
  name: string | null;
  nicknames: string[];
};

/** One way to say a course (its name, or one nickname), ready to score. */
export type CoursePhrase = {
  text: string;
  isNickname: boolean;
  /** Normalised words, as written. */
  words: readonly string[];
  /** The words that aren't numbers from 1 to 10 (`isNumeralWord`). */
  textWords: readonly string[];
  /** Each numeral word with its other spelling ("i" → "i", "1"), for exact matching. */
  numerals: readonly { word: string; forms: readonly string[] }[];
};

/** A row with its department and professor resolved, as the list draws it. */
export type LibraryRow = {
  resource: BackworkResource;
  department: BackworkDepartment | null;
  professor: BackworkProfessor | null;
  /** The named course this file belongs to, when someone named it. */
  courseEntry: BackworkCourse | null;
  /** The course's name and nicknames, each scored on its own for ranking. */
  coursePhrases: readonly CoursePhrase[];
  /** "COGS 2120", "COGS", "2120", or null. */
  course: string | null;
  /**
   * What follows the course code: the course's name, or the department's
   * when the course has none ("Calculus I", else "Mathematics").
   */
  courseLabel: string | null;
  /** "Fall 2026", "Fall", "2026", or null. */
  term: string | null;
  title: string;
  /**
   * `searchText` normalised once, so a keystroke only scores: everything but
   * the course's name and nicknames, which `coursePhrases` holds and which
   * match under stricter rules (`queryLibrary`).
   */
  words: readonly string[];
  /** The course's name and nickname words that aren't numbers, de-duplicated. */
  courseWords: readonly string[];
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

function courseKey(departmentId: string, courseNumber: string): string {
  return `${departmentId}:${courseNumber.trim().toLowerCase()}`;
}

function phrasesFor(course: BackworkCourse | null): CoursePhrase[] {
  if (!course) return [];
  const phrase = (text: string, isNickname: boolean): CoursePhrase => {
    const words = normalizeWords(text);
    return {
      text,
      isNickname,
      words,
      textWords: words.filter((word) => !isNumeralWord(word)),
      numerals: words
        .filter(isNumeralWord)
        .map((word) => ({ word, forms: withNumeralVariants([word]) })),
    };
  };
  return [
    ...(course.name ? [phrase(course.name, false)] : []),
    ...course.nicknames.map((nickname) => phrase(nickname, true)),
  ];
}

export function toLibraryRows(
  resources: readonly BackworkResource[],
  departments: readonly BackworkDepartment[],
  professors: readonly BackworkProfessor[],
  courses: readonly BackworkCourse[] = [],
): LibraryRow[] {
  const departmentById = new Map(departments.map((d) => [d.id, d]));
  const professorById = new Map(professors.map((p) => [p.id, p]));
  const courseByKey = new Map(
    courses.map((c) => [courseKey(c.department_id, c.course_number), c]),
  );
  return resources.map((resource) => {
    const department = resource.department_id
      ? (departmentById.get(resource.department_id) ?? null)
      : null;
    const professor = resource.professor_id
      ? (professorById.get(resource.professor_id) ?? null)
      : null;
    const courseEntry =
      department && resource.course_number?.trim()
        ? (courseByKey.get(courseKey(department.id, resource.course_number)) ?? null)
        : null;
    const course = joinNonEmpty([department?.code, resource.course_number?.trim()]);
    const fallbackTitle = joinNonEmpty([
      resource.assignment_type ?? "Resource",
      resource.assignment_number,
      course ? `· ${course}` : null,
    ]);
    const coursePhrases = phrasesFor(courseEntry);
    const row = {
      resource,
      department,
      professor,
      courseEntry,
      coursePhrases,
      course,
      courseLabel: courseEntry?.name ?? department?.name ?? null,
      term: joinNonEmpty([resource.semester, resource.year]),
      title: resource.title?.trim() || fallbackTitle || "Untitled",
      words: [] as readonly string[],
      courseWords: [...new Set(coursePhrases.flatMap((phrase) => phrase.textWords))],
    };
    row.words = normalizeWords(searchText(row, { courseNames: false }));
    return row;
  });
}

/**
 * Everything a member might type to find a row. `courseNames: false` leaves
 * out the course's name and nicknames, which `toLibraryRows` adds itself.
 */
export function searchText(
  row: LibraryRow,
  { courseNames = true }: { courseNames?: boolean } = {},
): string {
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
    ...(courseNames ? [row.courseEntry?.name, ...(row.courseEntry?.nicknames ?? [])] : []),
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
 * Weight per query word a course's name or one nickname matches on its own.
 * Above anything the word-by-word score can reach for the same query, so a
 * file in the course the query names ranks above a file that only shares a
 * word with it: "calc 1" puts Calculus I's files above "Calculus II —
 * Midterm 1", which matches "calc" by its course and "1" by its number.
 */
const COURSE_PHRASE_WEIGHT = 10;
/** A numeral matched through the course's name: as good as an exact word. */
const NUMERAL_SCORE = 3;

export type LibraryResult = FuzzyResult<LibraryRow> & {
  /**
   * The nickname the query matched when it matched the course by a nickname
   * better than by its name, for the row to show "(Orgo)"; otherwise null.
   */
  nickname: string | null;
  /**
   * Normalised words of the course's name and nicknames the query matched,
   * as written ("i" for a query "1"), for highlighting the course line.
   */
  courseHits: string[];
};

type PhraseMatch = {
  phrase: CoursePhrase;
  /** Query words this phrase matched, gated as `courseMatch` says. */
  matched: Set<string>;
  hits: string[];
};

/**
 * Whether a query word counts toward a course's name or nickname only beside
 * another, non-numeric query word on the same phrase: a number from 1 to 10
 * in either spelling ("1", "i"), or any word with a digit in it ("200").
 */
function isGatedCourseWord(word: string): boolean {
  return isNumeralWord(word) || /\d/.test(word);
}

/**
 * How the query matches each of the row's course phrases. A word that is not
 * a number matches a phrase's text words the way search matches any word
 * (prefix, typo). A number counts only when some non-numeric query word
 * matched the same phrase, so a bare number never reaches a file through its
 * course's name or nickname ("200" alone does not find "Stat 200"; "stat 200"
 * does). Then a number from 1 to 10, in either spelling, matches only exactly,
 * in either spelling ("1" finds "I", never "II"), and any other word with a
 * digit matches the phrase's words as search matches a number (never by typo).
 */
function courseMatch(row: LibraryRow, queryWords: readonly string[]): PhraseMatch[] {
  return row.coursePhrases.map((phrase) => {
    const matched = new Set<string>();
    const hits: string[] = [];
    for (const word of queryWords) {
      if (isGatedCourseWord(word)) continue;
      const { hit } = matchQueryWord(word, phrase.textWords, BACKWORK_SEARCH_ALIASES);
      if (hit) {
        matched.add(word);
        hits.push(hit);
      }
    }
    if (matched.size > 0) {
      for (const word of queryWords) {
        if (!isGatedCourseWord(word)) continue;
        if (isNumeralWord(word)) {
          const numeral = phrase.numerals.find((n) => n.forms.includes(word));
          if (numeral) {
            matched.add(word);
            hits.push(numeral.word);
          }
          continue;
        }
        const { hit } = matchQueryWord(word, phrase.textWords, BACKWORK_SEARCH_ALIASES);
        if (hit) {
          matched.add(word);
          hits.push(hit);
        }
      }
    }
    return { phrase, matched, hits };
  });
}

/**
 * Filters, then searches, with `fuzzyMatchWords`'s rules over a row's own
 * words. A query word that matches none of them may still match the row's
 * course (`courseFallback`). With a query, best match first (ties newest term
 * first); without one, newest term first. A file whose course the query
 * names, by its name or a nickname, ranks first (`COURSE_PHRASE_WEIGHT`).
 */
export function queryLibrary(
  rows: readonly LibraryRow[],
  query: string,
  filters: LibraryFilters,
): LibraryResult[] {
  const ordered = rows.filter((row) => passesFilters(row, filters)).sort(compareByTerm);
  const queryWords = normalizeWords(query);
  // Per row, at most once per query: only for a row whose own words failed a
  // query word, or that matched and is being ranked.
  const phraseCache = new Map<LibraryRow, PhraseMatch[]>();
  const phrasesOf = (row: LibraryRow) => {
    let found = phraseCache.get(row);
    if (!found) {
      found = courseMatch(row, queryWords);
      phraseCache.set(row, found);
    }
    return found;
  };
  /**
   * A word's match through the course. A word that isn't a number matches
   * the course's words as search matches any word (prefix, typo). A number
   * (a word with a digit, or a Roman numeral from I to X) counts only beside
   * a non-numeric query word on the same name or nickname (`courseMatch`);
   * a number from 1 to 10, in either spelling, counts only exactly.
   */
  const courseFallback = (row: LibraryRow, word: string) => {
    if (row.coursePhrases.length === 0) return { score: 0, hit: null };
    if (!isGatedCourseWord(word)) {
      return matchQueryWord(word, row.courseWords, BACKWORK_SEARCH_ALIASES);
    }
    const phrase = phrasesOf(row).find((p) => p.matched.has(word));
    if (!phrase) return { score: 0, hit: null };
    if (!isNumeralWord(word)) {
      return matchQueryWord(word, phrase.phrase.textWords, BACKWORK_SEARCH_ALIASES);
    }
    const numeral = phrase.phrase.numerals.find((n) => n.forms.includes(word));
    // No `hit`: the numeral lights up the course line (`courseHits`), never
    // an "I" in the title, tags or professor.
    return numeral ? { score: NUMERAL_SCORE, hit: null } : { score: 0, hit: null };
  };
  const matched = fuzzyMatchWords(
    ordered,
    query,
    (row) => row.words,
    BACKWORK_SEARCH_ALIASES,
    courseFallback,
  );
  if (queryWords.length === 0) {
    return matched.map((result) => ({ ...result, nickname: null, courseHits: [] }));
  }
  return matched
    .map((result, index) => {
      const phrases = result.item.coursePhrases.length ? phrasesOf(result.item) : [];
      let best: PhraseMatch | null = null;
      for (const p of phrases) {
        if (p.matched.size > (best?.matched.size ?? 0)) best = p;
      }
      const nameMatched = phrases.find((p) => !p.phrase.isNickname)?.matched.size ?? 0;
      return {
        index,
        result: {
          ...result,
          score: result.score + (best?.matched.size ?? 0) * COURSE_PHRASE_WEIGHT,
          nickname:
            best?.phrase.isNickname && best.matched.size > nameMatched ? best.phrase.text : null,
          courseHits: phrases.flatMap((p) => p.hits),
        },
      };
    })
    .sort((a, b) => b.result.score - a.result.score || a.index - b.index)
    .map(({ result }) => result);
}

export function hasActiveFilters(filters: LibraryFilters): boolean {
  return Object.values(filters).some((value) => value !== null);
}


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
        row.courseLabel ? `${row.course} · ${row.courseLabel}` : row.course,
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
