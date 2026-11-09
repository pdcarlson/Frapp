import { describe, expect, it } from "vitest";
import {
  NO_DOCUMENT_FILTERS,
  isActiveDateFilter,
  semesterSince,
  dateFilterLabel,
  inDateFilter,
  queryDocuments,
  toLibraryDocuments,
  uploaderOptions,
} from "./document-library";
import type { ChapterDocument } from "./document-types";

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
      titles(queryDocuments(ROWS, "", { uploader: "u2", date: null }, "name", DATES)),
    ).toEqual(["FY2026 Operating Budget"]);
    expect(
      titles(queryDocuments(ROWS, "", { uploader: null, date: { preset: "semester" } }, "name", DATES)),
    ).toEqual(["FY2026 Operating Budget", "Recruitment Handbook"]);
    expect(
      titles(queryDocuments(ROWS, "", { uploader: null, date: { preset: "30d" } }, "name", DATES)),
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
      process.env.TZ = tz;
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
      { uploader: null, date: { preset: "semester" } },
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
