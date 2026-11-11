import { describe, expect, it } from "vitest";
import {
  tierByMarks,
  NO_DOCUMENT_FILTERS,
  isActiveDateFilter,
  semesterSince,
  dateFilterLabel,
  inDateFilter,
  queryDocuments,
  toLibraryDocuments,
  uploaderOptions,
  fileKind,
  isFiltering,
  kindOptions,
} from "./document-library";

type ChapterDocument = {
  id: string;
  chapter_id: string;
  title: string;
  description: string | null;
  folder: string | null;
  storage_path: string;
  uploaded_by: string;
  created_at: string;
  content_type: string | null;
  byte_size: number | null;
  document_type: string | null;
  effective_date: string | null;
};

function doc(id: string, title: string, uploaded_by: string, created_at: string, extra: Partial<ChapterDocument> = {}): ChapterDocument {
  return {
    id,
    chapter_id: "c",
    title,
    description: null,
    folder: null,
    storage_path: `c/documents/${id}/f.pdf`,
    uploaded_by,
    created_at,
    content_type: "application/pdf",
    byte_size: null,
    document_type: null,
    effective_date: null,
    ...extra,
  };
}

const NAMES: Record<string, string> = { u1: "Ryan Castellano", u2: "Devin Okafor" };
const ROWS = toLibraryDocuments(
  [
    doc("a", "Recruitment Handbook", "u1", "2026-09-25T12:00:00Z", { folder: "Recruitment" }),
    doc("b", "FY2026 Operating Budget", "u2", "2026-09-10T12:00:00Z", {
      folder: "Finance",
      description: "Approved by exec and the house corporation.",
    }),
    doc("c", "Chapter Bylaws", "u-gone", "2026-07-12T12:00:00Z"),
  ],
  (id) => NAMES[id] ?? null,
);
const NOW = new Date(2026, 10, 9, 12);
// The chapter's last rollover archived a semester ending Jul 31.
const DATES = { now: NOW, semesterSince: semesterSince([{ end_date: "2026-07-31" }]) };
const titles = (rows: { doc: ChapterDocument }[]) => rows.map((r) => r.doc.title);

describe("queryDocuments", () => {
  it("searches title, description, uploader and folder, forgiving a typo", () => {
    expect(titles(queryDocuments(ROWS, "castelano", NO_DOCUMENT_FILTERS, "name", DATES))).toEqual([
      "Recruitment Handbook",
    ]);
    expect(titles(queryDocuments(ROWS, "house corp", NO_DOCUMENT_FILTERS, "name", DATES))).toEqual([
      "FY2026 Operating Budget",
    ]);
    expect(titles(queryDocuments(ROWS, "finance", NO_DOCUMENT_FILTERS, "name", DATES))).toEqual([
      "FY2026 Operating Budget",
    ]);
  });

  it("still finds any substring, as the title search did", () => {
    expect(titles(queryDocuments(ROWS, "laws", NO_DOCUMENT_FILTERS, "name", DATES))).toEqual([
      "Chapter Bylaws",
    ]);
    expect(titles(queryDocuments(ROWS, "2026", NO_DOCUMENT_FILTERS, "name", DATES))).toEqual([
      "FY2026 Operating Budget",
    ]);
  });

  it("orders by the chosen sort, with or without a query", () => {
    expect(titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "name", DATES))).toEqual([
      "Chapter Bylaws",
      "FY2026 Operating Budget",
      "Recruitment Handbook",
    ]);
    expect(titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "newest", DATES))[0]).toBe(
      "Recruitment Handbook",
    );
    expect(titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "oldest", DATES))[0]).toBe(
      "Chapter Bylaws",
    );
    // A person the roster can't name sorts last.
    expect(titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "uploader", DATES))).toEqual([
      "FY2026 Operating Budget",
      "Recruitment Handbook",
      "Chapter Bylaws",
    ]);
  });

  it("filters by uploader and by date", () => {
    expect(
      titles(queryDocuments(ROWS, "", { uploader: "u2", date: null, kind: null }, "name", DATES)),
    ).toEqual(["FY2026 Operating Budget"]);
    expect(
      titles(queryDocuments(ROWS, "", { uploader: null, date: { preset: "semester" }, kind: null }, "name", DATES)),
    ).toEqual(["FY2026 Operating Budget", "Recruitment Handbook"]);
    expect(
      titles(queryDocuments(ROWS, "", { uploader: null, date: { preset: "30d" }, kind: null }, "name", DATES)),
    ).toEqual([]);
  });
});

describe("date filters", () => {
  it("starts this semester after the latest archive's end day, as the API does", () => {
    expect(
      semesterSince([
        { end_date: "2026-01-15", created_at: "2026-01-16T00:00:00Z" },
        { end_date: "2026-07-31", created_at: "2026-08-01T00:00:00Z" },
      ]),
    ).toEqual(new Date("2026-07-31T23:59:59.999Z"));
    // The newest archive wins even with an earlier end date, as the API's
    // findLatestByChapter picks it (a correction filed after the fact).
    expect(
      semesterSince([
        { end_date: "2027-12-31", created_at: "2026-10-01T00:00:00Z" },
        { end_date: "2026-05-15", created_at: "2026-11-01T00:00:00Z" },
      ]),
    ).toEqual(new Date("2026-05-15T23:59:59.999Z"));
    // Never rolled over: this semester is everything.
    expect(semesterSince([])).toBeNull();
    const noArchive = { now: NOW, semesterSince: null };
    expect(inDateFilter("2020-01-01T00:00:00Z", { preset: "semester" }, noArchive)).toBe(true);
  });

  it("reads the rollover day's end in UTC wherever the viewer is, as the API does", () => {
    // The viewer's timezone is the point of this test, not a build input.
    /* eslint-disable turbo/no-undeclared-env-vars */
    const tz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const since = semesterSince([{ end_date: "2026-07-31", created_at: "2026-08-01T00:00:00Z" }]);
      const window = { now: NOW, semesterSince: since };
      // 9pm Jul 31 in New York is already Aug 1 in UTC: inside the semester.
      expect(inDateFilter("2026-08-01T01:00:00Z", { preset: "semester" }, window)).toBe(true);
      expect(inDateFilter("2026-07-31T23:00:00Z", { preset: "semester" }, window)).toBe(false);
    } finally {
      // Assigning undefined would store the string "undefined".
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
    /* eslint-enable turbo/no-undeclared-env-vars */
  });

  it("keeps the last 30 days and drops what's older", () => {
    const thirty = { preset: "30d" as const };
    expect(inDateFilter(new Date(2026, 9, 20).toISOString(), thirty, DATES)).toBe(true);
    expect(inDateFilter(new Date(2026, 9, 1).toISOString(), thirty, DATES)).toBe(false);
  });

  it("includes the whole of a custom range's last day, and leaves an open end open", () => {
    const sept = { preset: "custom" as const, from: "2026-09-01", to: "2026-09-25" };
    expect(inDateFilter(new Date(2026, 8, 25, 23, 59).toISOString(), sept, DATES)).toBe(true);
    expect(inDateFilter(new Date(2026, 8, 26, 0, 1).toISOString(), sept, DATES)).toBe(false);
    expect(inDateFilter("2020-01-01T00:00:00Z", { preset: "custom", from: null, to: "2026-01-01" }, DATES)).toBe(true);
    expect(dateFilterLabel(sept)).toBe("2026-09-01 to 2026-09-25");
  });

  it("applies no semester filter while the archives are unknown", () => {
    const rows = queryDocuments(
      ROWS,
      "",
      { uploader: null, date: { preset: "semester" }, kind: null },
      "name",
      { now: NOW, semesterSince: undefined },
    );
    expect(rows).toHaveLength(3);
    expect(isActiveDateFilter({ preset: "semester" }, false)).toBe(false);
  });

  it("treats a custom range with no dates as no filter yet", () => {
    expect(isActiveDateFilter({ preset: "custom", from: null, to: null })).toBe(false);
    expect(isActiveDateFilter({ preset: "custom", from: "2026-09-01", to: null })).toBe(true);
    expect(isActiveDateFilter(null)).toBe(false);
  });
});

describe("uploaderOptions", () => {
  it("offers only people the roster can name, A to Z", () => {
    expect(uploaderOptions(ROWS)).toEqual([
      { value: "u2", label: "Devin Okafor" },
      { value: "u1", label: "Ryan Castellano" },
    ]);
  });
});

describe("file type (#3938)", () => {
  const typed = (
    id: string,
    title: string,
    content_type: string | null,
    storage_path = `chapters/c/documents/${id}/file`,
  ) => ({
    id,
    title,
    uploaded_by: "u1",
    created_at: "2026-09-01T00:00:00Z",
    content_type,
    storage_path,
  });

  it.each([
    ["application/pdf", "pdf"],
    ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "word"],
    ["application/msword", "word"],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "slides"],
    ["application/vnd.ms-excel", "spreadsheet"],
    ["text/csv; charset=utf-8", "spreadsheet"],
    ["image/heic", "image"],
    ["text/plain", "other"],
  ] as const)("reads %s as %s", (mime, kind) => {
    expect(fileKind({ content_type: mime, storage_path: "x/y/z" })).toBe(kind);
  });

  it("falls back to the stored filename's extension when the type is missing or generic", () => {
    expect(fileKind({ content_type: null, storage_path: "c/d/1/Minutes.DOCX" })).toBe("word");
    expect(
      fileKind({ content_type: "application/octet-stream", storage_path: "c/d/1/deck.key" }),
    ).toBe("slides");
    expect(fileKind({ content_type: null, storage_path: "c/d/1/README" })).toBe("other");
    expect(fileKind({ content_type: null, storage_path: null })).toBe("other");
  });

  const rows = toLibraryDocuments(
    [
      typed("a", "Bylaws", "application/pdf"),
      typed("b", "Rush deck", null, "c/d/b/rush.pptx"),
      typed("c", "Dues", "application/vnd.ms-excel"),
      typed("d", "Workshop notes", "application/msword"),
    ],
    () => null,
  );
  const ids = (query: string, filters = NO_DOCUMENT_FILTERS) =>
    queryDocuments(rows, query, filters, "name", { now: new Date(), semesterSince: null }).map(
      (row) => row.doc.id,
    );

  it("filters by group, and offers only the groups present, in order", () => {
    expect(ids("", { ...NO_DOCUMENT_FILTERS, kind: "slides" })).toEqual(["b"]);
    expect(kindOptions(rows.map((row) => row.kind)).map((o) => o.label)).toEqual([
      "PDF",
      "Word",
      "Slides",
      "Spreadsheet",
    ]);
  });

  it("finds a format by its words, exactly or by their start", () => {
    expect(ids("pdf")).toEqual(["a"]);
    expect(ids("powerpoint")).toEqual(["b"]);
    expect(ids("excel")).toEqual(["c"]);
    expect(ids("spread")).toEqual(["c"]);
    expect(ids("word")).toEqual(["d"]);
    expect(ids("rush slides")).toEqual(["b"]);
  });

  it("never fuzzes a format word: work is not word", () => {
    expect(ids("work")).toEqual(["d"]); // "Workshop", by its title
    expect(ids("sheep")).toEqual([]);
  });

  it("counts a group as a filter", () => {
    expect(isFiltering("", { ...NO_DOCUMENT_FILTERS, kind: "pdf" }, true)).toBe(true);
  });
});

describe("tierByMarks (#3934)", () => {
  const items = ["a", "b", "c", "d", "e"];

  it("splits pinned, then starred, then the rest, each in the order given", () => {
    const tiers = tierByMarks(
      items,
      (x) => x === "d" || x === "b",
      (x) => x === "e",
    );
    expect(tiers).toEqual({
      pinned: ["b", "d"],
      starred: ["e"],
      rest: ["a", "c"],
    });
  });

  it("lists an item that is both pinned and starred once, under Pinned", () => {
    const tiers = tierByMarks(
      items,
      (x) => x === "a",
      (x) => x === "a" || x === "c",
    );
    expect(tiers.pinned).toEqual(["a"]);
    expect(tiers.starred).toEqual(["c"]);
    expect(tiers.rest).toEqual(["b", "d", "e"]);
  });

  it("leaves everything in the rest when nothing is marked", () => {
    expect(tierByMarks(items, () => false, () => false)).toEqual({
      pinned: [],
      starred: [],
      rest: items,
    });
  });
});
