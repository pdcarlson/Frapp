import { fuzzyMatchWords, normalizeWords } from "./fuzzy-match";

/**
 * The Documents library's search, filters and order (#3852), kept free of
 * React so they can be tested on plain rows. Web's `/documents` and mobile's
 * Documents screen both run it (#3938), so the two apps find, narrow and order
 * a chapter's files the same way.
 *
 * All of it runs on the client, as web `/backwork`'s does (`backwork-library.ts`):
 * `GET /v1/documents` returns the chapter's whole library in one response, so
 * a keystroke or a filter re-ranks what is already in memory instead of asking
 * the server again, and it works offline over what is loaded. A chapter files
 * far fewer documents than PostgREST's 1,000-row `max_rows`, the cap that bit
 * backwork (#3525); past it the page says it is showing only part.
 */

/**
 * PostgREST's `max_rows` (`supabase/config.toml`): an unpaginated list read
 * returns at most this many rows. Web's backwork list meets the same cap
 * (`BACKWORK_LIST_CAP` is this constant).
 */
export const POSTGREST_MAX_ROWS = 1000;

/** A documents response this long is treated as truncated. */
export const DOCUMENT_LIST_CAP = POSTGREST_MAX_ROWS;

/** The capped-list status line, both apps (`writing.md` § Chapter Documents). */
export const DOCUMENT_CAP_NOTICE = `Showing the newest ${DOCUMENT_LIST_CAP.toLocaleString(
  "en-US",
)} documents. Search and filters look only at these for now.`;

/** The delete confirm, both apps: title, body and confirm label. */
export function deleteDocumentTitle(title: string): string {
  return `Delete ${title}?`;
}
export const DELETE_DOCUMENT_BODY =
  "This removes the file from chapter storage immediately and cannot be undone.";
export const DELETE_DOCUMENT_LABEL = "Delete document";

/**
 * The fields of a `GET /v1/documents` row the library reads. Structural, so
 * web's `ChapterDocument` and mobile's narrowed rows both fit.
 */
export type LibrarySourceDocument = {
  id: string;
  title: string;
  description?: string | null;
  folder?: string | null;
  document_type?: string | null;
  uploaded_by: string | null;
  created_at: string;
  /** The declared MIME type; null on rows filed before 2026-08-31. */
  content_type?: string | null;
  /** The storage key, whose extension stands in when `content_type` is null. */
  storage_path?: string | null;
};

/**
 * A file format group, for the File type filter and for search (#3938, Shawn's
 * addition; Google Drive's Type filter).
 */
export type FileKind = "pdf" | "word" | "slides" | "spreadsheet" | "image" | "other";

/** The groups in the order the filter offers them. */
export const FILE_KIND_OPTIONS: readonly { value: FileKind; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "word", label: "Word" },
  { value: "slides", label: "Slides" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "image", label: "Image" },
  { value: "other", label: "Other" },
];

/**
 * The words a member types to mean a group. They match a query word exactly
 * or as its start ("spread", "power"), never as a near miss: "word" is one
 * letter from "work", and "sheet" from "sheep".
 */
const FILE_KIND_WORDS: Record<FileKind, readonly string[]> = {
  pdf: ["pdf"],
  word: ["word", "doc", "docx"],
  slides: ["slides", "slide", "powerpoint", "presentation", "deck"],
  spreadsheet: ["spreadsheet", "excel", "sheet", "sheets", "csv"],
  image: ["image", "photo", "picture"],
  other: [],
};

const EXTENSION_KIND: Record<string, FileKind> = {
  pdf: "pdf",
  doc: "word",
  docx: "word",
  odt: "word",
  rtf: "word",
  ppt: "slides",
  pptx: "slides",
  key: "slides",
  odp: "slides",
  xls: "spreadsheet",
  xlsx: "spreadsheet",
  csv: "spreadsheet",
  ods: "spreadsheet",
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  heic: "image",
  heif: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  svg: "image",
};

function kindOfMime(mime: string): FileKind | null {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("image/")) return "image";
  if (
    type === "application/msword" ||
    type.includes("wordprocessingml") ||
    type === "application/vnd.oasis.opendocument.text" ||
    type === "application/rtf" ||
    type === "text/rtf"
  ) {
    return "word";
  }
  if (
    type === "application/vnd.ms-powerpoint" ||
    type.includes("presentationml") ||
    type === "application/vnd.oasis.opendocument.presentation" ||
    type === "application/vnd.apple.keynote" ||
    type === "application/x-iwork-keynote-sffkey"
  ) {
    return "slides";
  }
  if (
    type === "application/vnd.ms-excel" ||
    type.includes("spreadsheetml") ||
    type === "application/vnd.oasis.opendocument.spreadsheet" ||
    type === "text/csv"
  ) {
    return "spreadsheet";
  }
  return null;
}

/**
 * A document's format group: from its declared `content_type`, or, when that
 * is missing or the generic `application/octet-stream`, from the extension of
 * the stored filename. Anything unrecognised is Other.
 */
export function fileKind(doc: Pick<LibrarySourceDocument, "content_type" | "storage_path">): FileKind {
  const mime = doc.content_type?.trim();
  if (mime && mime.toLowerCase() !== "application/octet-stream") {
    const kind = kindOfMime(mime);
    if (kind) return kind;
  }
  const name = doc.storage_path?.split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
  return EXTENSION_KIND[ext] ?? "other";
}

/** One choice in the Uploaded by filter. */
export type UploaderOption = { value: string; label: string };

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
  /** A format group, or null for any. */
  kind: FileKind | null;
};

export const NO_DOCUMENT_FILTERS: DocumentFilters = {
  uploader: null,
  date: null,
  kind: null,
};

/** A document with its uploader's name resolved and its words normalised once. */
export type LibraryDocument<D extends LibrarySourceDocument = LibrarySourceDocument> = {
  doc: D;
  uploader: string | null;
  words: readonly string[];
  /** The same text lowercased, for the substring match the title search had. */
  text: string;
  kind: FileKind;
};

export function toLibraryDocuments<D extends LibrarySourceDocument>(
  documents: readonly D[],
  uploaderName: (userId: string) => string | null,
): LibraryDocument<D>[] {
  return documents.map((doc) => {
    const uploader = doc.uploaded_by ? uploaderName(doc.uploaded_by) : null;
    const text = searchText(doc, uploader);
    return {
      doc,
      uploader,
      words: normalizeWords(text),
      text: text.toLowerCase(),
      kind: fileKind(doc),
    };
  });
}

/**
 * "Uploaded Sep 26 by Ryan Castellano", dropping whichever half is unknown:
 * the lead of each app's row meta line.
 */
export function uploadedLine(day: string | null, uploader: string | null): string | null {
  if (!day && !uploader) return null;
  return ["Uploaded", day, uploader ? `by ${uploader}` : null]
    .filter(Boolean)
    .join(" ");
}

/** Everything a member might type to find a document. */
export function searchText(doc: LibrarySourceDocument, uploader: string | null): string {
  return [doc.title, doc.description, uploader, doc.folder, doc.document_type]
    .filter((part) => part !== null && part !== undefined && part !== "")
    .join(" ");
}

/**
 * Where "this semester" starts: after the end of the most recently created
 * archive's `end_date` day. That is the window `spec/behavior/semester-rollover.md`
 * defines, picked the way the API picks it (`findLatestByChapter`, newest
 * `created_at`) and read the way `resolveWindowSince('semester')` reads it
 * (end of that day in UTC, exclusive). Null when the chapter has never rolled
 * over, so "this semester" is everything.
 */
export function semesterSince(
  archives: readonly { end_date: string; created_at?: string }[],
): Date | null {
  let latest: { end_date: string; created_at?: string } | null = null;
  for (const archive of archives) {
    if (!archive.end_date) continue;
    if (latest === null || (archive.created_at ?? "") > (latest.created_at ?? "")) {
      latest = archive;
    }
  }
  return latest ? new Date(`${latest.end_date.slice(0, 10)}T23:59:59.999Z`) : null;
}

/**
 * What a date filter is read against. `semesterSince` is `undefined` while
 * the archives are loading or failed to load: the semester is unknown, which
 * is not the same as a chapter that never rolled over (`null`).
 */
export type DateContext = { now: Date; semesterSince: Date | null | undefined };

/** `YYYY-MM-DD` from a date input, as the start of that local day. */
function dayStart(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

/** Whether `createdAt` falls inside the filter, read in the viewer's timezone. */
export function inDateFilter(
  createdAt: string,
  filter: DateFilter,
  { now, semesterSince: since }: DateContext,
): boolean {
  const at = new Date(createdAt);
  if (Number.isNaN(at.getTime())) return false;
  if (filter.preset === "30d") {
    return now.getTime() - at.getTime() <= 30 * 24 * 60 * 60 * 1000;
  }
  // Unknown (`undefined`) never reaches here: `queryDocuments` drops the filter.
  if (filter.preset === "semester") return since == null || at > since;
  const from = filter.from ? dayStart(filter.from) : null;
  const toStart = filter.to ? dayStart(filter.to) : null;
  // Inclusive of the whole `to` day.
  const until = toStart
    ? new Date(toStart.getFullYear(), toStart.getMonth(), toStart.getDate() + 1)
    : null;
  return (!from || at >= from) && (!until || at < until);
}

/**
 * Whether a date filter narrows anything. "Custom range" with neither date set
 * is a filter in waiting: it matches everything, so the chip stays untinted
 * and the page doesn't read it as filtering.
 */
export function isActiveDateFilter(
  filter: DateFilter | null,
  semesterKnown = true,
): filter is DateFilter {
  if (filter === null) return false;
  if (filter.preset === "semester") return semesterKnown;
  return filter.preset !== "custom" || filter.from !== null || filter.to !== null;
}

/** Whether a search or a filter is narrowing the list. */
export function isFiltering(
  query: string,
  filters: DocumentFilters,
  semesterKnown: boolean,
): boolean {
  return (
    query.trim() !== "" ||
    filters.uploader !== null ||
    filters.kind !== null ||
    isActiveDateFilter(filters.date, semesterKnown)
  );
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
export function queryDocuments<D extends LibrarySourceDocument>(
  rows: readonly LibraryDocument<D>[],
  query: string,
  filters: DocumentFilters,
  sort: DocumentSort,
  dates: DateContext,
): LibraryDocument<D>[] {
  const date = isActiveDateFilter(filters.date, dates.semesterSince !== undefined)
    ? filters.date
    : null;
  const filtered = rows.filter(
    (row) =>
      (filters.uploader === null || row.doc.uploaded_by === filters.uploader) &&
      (filters.kind === null || row.kind === filters.kind) &&
      (date === null || inDateFilter(row.doc.created_at, date, dates)),
  );
  const needle = query.trim().toLowerCase();
  if (!needle) return [...filtered].sort(COMPARE[sort]);
  // Words, prefixes and near misses (backwork's matcher), plus any plain
  // substring, which the server's title search matched and members rely on:
  // "laws" in "bylaws", "2026" in "FY2026", or a query that is only "_".
  // A query of punctuation alone has no words, and the fuzzy matcher returns
  // every row for that; only the substring match then applies.
  const fuzzy = new Set(
    normalizeWords(needle).length > 0
      ? fuzzyMatchWords(
          filtered,
          needle,
          (row) => row.words,
          {},
          (row, word) => matchKindWord(row.kind, word),
        ).map((result) => result.item)
      : [],
  );
  return filtered
    .filter((row) => fuzzy.has(row) || row.text.includes(needle))
    .sort(COMPARE[sort]);
}

/**
 * A query word against the document's format words ("pdf", "slides",
 * "excel"): exact, or as the start of one from three letters, scored as the
 * fuzzy matcher scores an exact word and a prefix. No near misses.
 */
function matchKindWord(kind: FileKind, word: string): { score: number; hit: null } {
  let score = 0;
  for (const kindWord of FILE_KIND_WORDS[kind]) {
    if (kindWord === word) return { score: 3, hit: null };
    if (word.length >= 3 && kindWord.startsWith(word)) score = 2.5;
  }
  return { score, hit: null };
}

/**
 * The File type filter's choices: only the groups in `kinds` (the library's,
 * plus any kept pick), in the fixed order.
 */
export function kindOptions(
  kinds: Iterable<FileKind>,
): { value: FileKind; label: string }[] {
  const present = new Set(kinds);
  return FILE_KIND_OPTIONS.filter((option) => present.has(option.value));
}

/** The Uploaded by chip's choices: only people who have uploaded something. */
export function uploaderOptions(rows: readonly LibraryDocument[]): UploaderOption[] {
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
