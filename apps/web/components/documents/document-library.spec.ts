import { describe, expect, it } from "vitest";
import {
  NO_DOCUMENT_FILTERS,
  currentSemester,
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
    doc("b", "Fall 2026 Operating Budget", "u2", "2026-09-10T12:00:00Z", {
      folder: "Finance",
      description: "Approved by exec and the house corporation.",
    }),
    doc("c", "Chapter Bylaws", "u-gone", "2026-07-12T12:00:00Z"),
  ],
  (id) => NAMES[id] ?? null,
);
const NOW = new Date(2026, 10, 9, 12);
const titles = (rows: { doc: ChapterDocument }[]) => rows.map((r) => r.doc.title);

describe("queryDocuments", () => {
  it("searches title, description, uploader and folder, forgiving a typo", () => {
    expect(titles(queryDocuments(ROWS, "castelano", NO_DOCUMENT_FILTERS, "name", NOW))).toEqual([
      "Recruitment Handbook",
    ]);
    expect(titles(queryDocuments(ROWS, "house corp", NO_DOCUMENT_FILTERS, "name", NOW))).toEqual([
      "Fall 2026 Operating Budget",
    ]);
    expect(titles(queryDocuments(ROWS, "finance", NO_DOCUMENT_FILTERS, "name", NOW))).toEqual([
      "Fall 2026 Operating Budget",
    ]);
  });

  it("orders by the chosen sort, with or without a query", () => {
    expect(titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "name", NOW))).toEqual([
      "Chapter Bylaws",
      "Fall 2026 Operating Budget",
      "Recruitment Handbook",
    ]);
    expect(titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "newest", NOW))[0]).toBe(
      "Recruitment Handbook",
    );
    expect(titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "oldest", NOW))[0]).toBe(
      "Chapter Bylaws",
    );
    // A person the roster can't name sorts last.
    expect(titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "uploader", NOW))).toEqual([
      "Fall 2026 Operating Budget",
      "Recruitment Handbook",
      "Chapter Bylaws",
    ]);
  });

  it("filters by uploader and by date", () => {
    expect(
      titles(queryDocuments(ROWS, "", { uploader: "u2", date: null }, "name", NOW)),
    ).toEqual(["Fall 2026 Operating Budget"]);
    expect(
      titles(queryDocuments(ROWS, "", { uploader: null, date: { preset: "semester" } }, "name", NOW)),
    ).toEqual(["Fall 2026 Operating Budget", "Recruitment Handbook"]);
    expect(
      titles(queryDocuments(ROWS, "", { uploader: null, date: { preset: "30d" } }, "name", NOW)),
    ).toEqual([]);
  });
});

describe("date filters", () => {
  it("reads the semester from the month: spring, summer, fall", () => {
    expect(currentSemester(new Date(2026, 2, 3)).start).toEqual(new Date(2026, 0, 1));
    expect(currentSemester(new Date(2026, 5, 3)).end).toEqual(new Date(2026, 7, 1));
    expect(currentSemester(NOW)).toEqual({ start: new Date(2026, 7, 1), end: new Date(2027, 0, 1) });
  });

  it("includes the whole of a custom range's last day, and leaves an open end open", () => {
    const sept = { preset: "custom" as const, from: "2026-09-01", to: "2026-09-25" };
    expect(inDateFilter(new Date(2026, 8, 25, 23, 59).toISOString(), sept, NOW)).toBe(true);
    expect(inDateFilter(new Date(2026, 8, 26, 0, 1).toISOString(), sept, NOW)).toBe(false);
    expect(inDateFilter("2020-01-01T00:00:00Z", { preset: "custom", from: null, to: "2026-01-01" }, NOW)).toBe(true);
    expect(dateFilterLabel(sept)).toBe("2026-09-01 to 2026-09-25");
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
