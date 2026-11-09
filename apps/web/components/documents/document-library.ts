import { fuzzyMatchWords, normalizeWords } from "@/lib/search/fuzzy-match";
import type { ChapterDocument } from "@/components/documents/document-types";

/**
 * The `/documents` list's search, filters and order (#3852), kept free of
 * React so they can be tested on plain rows.
 *
 * All of it runs on the client, as `/backwork`'s does (`backwork-library.ts`):
 * `GET /v1/documents` returns the chapter's whole library in one response, so
 * a keystroke or a filter re-ranks what is already in memory instead of asking
 * the server again, and it works offline over what is loaded. A chapter files
 * far fewer documents than PostgREST's 1,000-row `max_rows`, the cap that bit
 * backwork (#3525); past it the page says it is showing only part.
 */

/** PostgREST's `max_rows`; a response this long is treated as truncated. */
export const DOCUMENT_LIST_CAP = 1000;

export type DocumentSort = "name" | "newest" | "oldest" | "uploader";

export const SORT_OPTIONS: readonly { value: DocumentSort; label: string }[] = [
  { value: "name", label: "Name A–Z" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "uploader", label: "Uploader A–Z" },
];

export type DateFilter =
  | { preset: "semester" }
  | { preset: "30d" }
  | { preset: "custom"; from: string | null; to: string | null };

export type DocumentFilters = {
  /** `uploaded_by`, or null for anyone. */
  uploader: string | null;
  date: DateFilter | null;
};

export const NO_DOCUMENT_FILTERS: DocumentFilters = { uploader: null, date: null };

/** A document with its uploader's name resolved and its words normalised once. */
export type LibraryDocument = {
  doc: ChapterDocument;
  uploader: string | null;
  words: readonly string[];
};

export function toLibraryDocuments(
  documents: readonly ChapterDocument[],
  uploaderName: (userId: string) => string | null,
): LibraryDocument[] {
  return documents.map((doc) => {
    const uploader = doc.uploaded_by ? uploaderName(doc.uploaded_by) : null;
    return { doc, uploader, words: normalizeWords(searchText(doc, uploader)) };
  });
}

/** Everything a member might type to find a document. */
export function searchText(doc: ChapterDocument, uploader: string | null): string {
  return [doc.title, doc.description, uploader, doc.folder, doc.document_type]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ");
}

/**
 * The academic term `now` falls in, as a `[start, end)` pair of local
 * calendar days: spring is January to May, summer June and July, fall August
 * to December. A chapter's calendar varies by school; these are the common
 * US boundaries, and a custom range covers anything else.
 */
export function currentSemester(now: Date): { start: Date; end: Date } {
  const year = now.getFullYear();
  const month = now.getMonth();
  const [from, to] = month < 5 ? [0, 5] : month < 7 ? [5, 7] : [7, 12];
  return { start: new Date(year, from, 1), end: new Date(year, to, 1) };
}

/** `YYYY-MM-DD` from a date input, as the start of that local day. */
function dayStart(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whether `createdAt` falls inside the filter, read in the viewer's timezone. */
export function inDateFilter(createdAt: string, filter: DateFilter, now: Date): boolean {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return false;
  if (filter.preset === "30d") {
    return now.getTime() - at.getTime() <= 30 * 24 * 60 * 60 * 1000;
  }
  if (filter.preset === "semester") {
    const { start, end } = currentSemester(now);
    return at >= start && at < end;
  }
  const from = filter.from ? dayStart(filter.from) : null;
  const toStart = filter.to ? dayStart(filter.to) : null;
  // Inclusive of the whole `to` day.
  const until = toStart
    ? new Date(toStart.getFullYear(), toStart.getMonth(), toStart.getDate() + 1)
    : null;
  return (!from || at >= from) && (!until || at < until);
}

/** A short label for the date chip once a filter is on. */
export function dateFilterLabel(filter: DateFilter): string {
  if (filter.preset === "semester") return "This semester";
  if (filter.preset === "30d") return "Last 30 days";
  const { from, to } = filter;
  if (from && to) return `${from} to ${to}`;
  if (from) return `Since ${from}`;
  if (to) return `Until ${to}`;
  return "Custom range";
}

const byTitle = (a: LibraryDocument, b: LibraryDocument) =>
  (a.doc.title || "").localeCompare(b.doc.title || "");

const COMPARE: Record<DocumentSort, (a: LibraryDocument, b: LibraryDocument) => number> = {
  name: byTitle,
  newest: (a, b) => b.doc.created_at.localeCompare(a.doc.created_at) || byTitle(a, b),
  oldest: (a, b) => a.doc.created_at.localeCompare(b.doc.created_at) || byTitle(a, b),
  // Unknown uploaders last, then by name, then newest first within one person.
  uploader: (a, b) =>
    (a.uploader === null ? 1 : 0) - (b.uploader === null ? 1 : 0) ||
    (a.uploader ?? "").localeCompare(b.uploader ?? "") ||
    b.doc.created_at.localeCompare(a.doc.created_at),
};

/**
 * Filters, searches, then orders. The chosen sort orders the results whether
 * or not there is a query: the member picked it, so a match's rank doesn't
 * override it. Search forgives typos the way backwork's does.
 */
export function queryDocuments(
  rows: readonly LibraryDocument[],
  query: string,
  filters: DocumentFilters,
  sort: DocumentSort,
  now: Date,
): LibraryDocument[] {
  const filtered = rows.filter(
    (row) =>
      (filters.uploader === null || row.doc.uploaded_by === filters.uploader) &&
      (filters.date === null || inDateFilter(row.doc.created_at, filters.date, now)),
  );
  const matched = query.trim()
    ? fuzzyMatchWords(filtered, query, (row) => row.words).map((result) => result.item)
    : filtered;
  return [...matched].sort(COMPARE[sort]);
}

/** The Uploaded by chip's choices: only people who have uploaded something. */
export function uploaderOptions(
  rows: readonly LibraryDocument[],
): { value: string; label: string }[] {
  const people = new Map<string, string>();
  for (const row of rows) {
    if (row.doc.uploaded_by && row.uploader && !people.has(row.doc.uploaded_by)) {
      people.set(row.doc.uploaded_by, row.uploader);
    }
  }
  return [...people]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label));
}
