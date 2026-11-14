import { describe, expect, it } from "vitest";
import {
  tierByMarks,
  markedItems,
  tierRows,
  NO_DOCUMENT_FILTERS,
  isActiveDateFilter,
  semesterSince,
  dateFilterLabel,
  inDateFilter,
  queryDocuments,
  toLibraryDocuments,
  uploaderOptions,
  classifyFile,
  fileKind,
  isFiltering,
  kindOptions,
  isMarkFiltering,
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
  pinned_at?: string | null;
};

function doc(
  id: string,
  title: string,
  uploaded_by: string,
  created_at: string,
  extra: Partial<ChapterDocument> = {},
): ChapterDocument {
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

const NAMES: Record<string, string> = {
  u1: "Ryan Castellano",
  u2: "Devin Okafor",
};
const ROWS = toLibraryDocuments(
  [
    doc("a", "Recruitment Handbook", "u1", "2026-09-25T12:00:00Z", {
      folder: "Recruitment",
    }),
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
const DATES = {
  now: NOW,
  semesterSince: semesterSince([{ end_date: "2026-07-31" }]),
};
const titles = (rows: { doc: ChapterDocument }[]) =>
  rows.map((r) => r.doc.title);

describe("queryDocuments", () => {
  it("searches title, description, uploader and folder, forgiving a typo", () => {
    expect(
      titles(
        queryDocuments(ROWS, "castelano", NO_DOCUMENT_FILTERS, "name", DATES),
      ),
    ).toEqual(["Recruitment Handbook"]);
    expect(
      titles(
        queryDocuments(ROWS, "house corp", NO_DOCUMENT_FILTERS, "name", DATES),
      ),
    ).toEqual(["FY2026 Operating Budget"]);
    expect(
      titles(
        queryDocuments(ROWS, "finance", NO_DOCUMENT_FILTERS, "name", DATES),
      ),
    ).toEqual(["FY2026 Operating Budget"]);
  });

  it("still finds any substring, as the title search did", () => {
    expect(
      titles(queryDocuments(ROWS, "laws", NO_DOCUMENT_FILTERS, "name", DATES)),
    ).toEqual(["Chapter Bylaws"]);
    expect(
      titles(queryDocuments(ROWS, "2026", NO_DOCUMENT_FILTERS, "name", DATES)),
    ).toEqual(["FY2026 Operating Budget"]);
  });

  it("orders by the chosen sort, with or without a query", () => {
    expect(
      titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "name", DATES)),
    ).toEqual([
      "Chapter Bylaws",
      "FY2026 Operating Budget",
      "Recruitment Handbook",
    ]);
    expect(
      titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "newest", DATES))[0],
    ).toBe("Recruitment Handbook");
    expect(
      titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "oldest", DATES))[0],
    ).toBe("Chapter Bylaws");
    // A person the roster can't name sorts last.
    expect(
      titles(queryDocuments(ROWS, "", NO_DOCUMENT_FILTERS, "uploader", DATES)),
    ).toEqual([
      "FY2026 Operating Budget",
      "Recruitment Handbook",
      "Chapter Bylaws",
    ]);
  });

  it("filters by uploader and by date", () => {
    expect(
      titles(
        queryDocuments(
          ROWS,
          "",
          { ...NO_DOCUMENT_FILTERS, uploader: "u2", date: null, kind: null },
          "name",
          DATES,
        ),
      ),
    ).toEqual(["FY2026 Operating Budget"]);
    expect(
      titles(
        queryDocuments(
          ROWS,
          "",
          {
            ...NO_DOCUMENT_FILTERS,
            uploader: null,
            date: { preset: "semester" },
            kind: null,
          },
          "name",
          DATES,
        ),
      ),
    ).toEqual(["FY2026 Operating Budget", "Recruitment Handbook"]);
    expect(
      titles(
        queryDocuments(
          ROWS,
          "",
          {
            ...NO_DOCUMENT_FILTERS,
            uploader: null,
            date: { preset: "30d" },
            kind: null,
          },
          "name",
          DATES,
        ),
      ),
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
    expect(
      inDateFilter("2020-01-01T00:00:00Z", { preset: "semester" }, noArchive),
    ).toBe(true);
  });

  it("reads the rollover day's end in UTC wherever the viewer is, as the API does", () => {
    // The viewer's timezone is the point of this test, not a build input.
    /* eslint-disable turbo/no-undeclared-env-vars */
    const tz = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const since = semesterSince([
        { end_date: "2026-07-31", created_at: "2026-08-01T00:00:00Z" },
      ]);
      const window = { now: NOW, semesterSince: since };
      // 9pm Jul 31 in New York is already Aug 1 in UTC: inside the semester.
      expect(
        inDateFilter("2026-08-01T01:00:00Z", { preset: "semester" }, window),
      ).toBe(true);
      expect(
        inDateFilter("2026-07-31T23:00:00Z", { preset: "semester" }, window),
      ).toBe(false);
    } finally {
      // Assigning undefined would store the string "undefined".
      if (tz === undefined) delete process.env.TZ;
      else process.env.TZ = tz;
    }
    /* eslint-enable turbo/no-undeclared-env-vars */
  });

  it("keeps the last 30 days and drops what's older", () => {
    const thirty = { preset: "30d" as const };
    expect(
      inDateFilter(new Date(2026, 9, 20).toISOString(), thirty, DATES),
    ).toBe(true);
    expect(
      inDateFilter(new Date(2026, 9, 1).toISOString(), thirty, DATES),
    ).toBe(false);
  });

  it("includes the whole of a custom range's last day, and leaves an open end open", () => {
    const sept = {
      preset: "custom" as const,
      from: "2026-09-01",
      to: "2026-09-25",
    };
    expect(
      inDateFilter(new Date(2026, 8, 25, 23, 59).toISOString(), sept, DATES),
    ).toBe(true);
    expect(
      inDateFilter(new Date(2026, 8, 26, 0, 1).toISOString(), sept, DATES),
    ).toBe(false);
    expect(
      inDateFilter(
        "2020-01-01T00:00:00Z",
        { preset: "custom", from: null, to: "2026-01-01" },
        DATES,
      ),
    ).toBe(true);
    expect(dateFilterLabel(sept)).toBe("2026-09-01 to 2026-09-25");
  });

  it("applies no semester filter while the archives are unknown", () => {
    const rows = queryDocuments(
      ROWS,
      "",
      {
        ...NO_DOCUMENT_FILTERS,
        uploader: null,
        date: { preset: "semester" },
        kind: null,
      },
      "name",
      { now: NOW, semesterSince: undefined },
    );
    expect(rows).toHaveLength(3);
    expect(isActiveDateFilter({ preset: "semester" }, false)).toBe(false);
  });

  it("treats a custom range with no dates as no filter yet", () => {
    expect(isActiveDateFilter({ preset: "custom", from: null, to: null })).toBe(
      false,
    );
    expect(
      isActiveDateFilter({ preset: "custom", from: "2026-09-01", to: null }),
    ).toBe(true);
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
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "word",
    ],
    ["application/msword", "word"],
    [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "slides",
    ],
    ["application/vnd.ms-excel", "spreadsheet"],
    ["text/csv; charset=utf-8", "spreadsheet"],
    ["image/heic", "image"],
    ["text/plain", "other"],
  ] as const)("reads %s as %s", (mime, kind) => {
    expect(fileKind({ content_type: mime, storage_path: "x/y/z" })).toBe(kind);
  });

  it("falls back to the stored filename's extension when the type is missing or generic", () => {
    expect(
      fileKind({ content_type: null, storage_path: "c/d/1/Minutes.DOCX" }),
    ).toBe("word");
    expect(
      fileKind({
        content_type: "application/octet-stream",
        storage_path: "c/d/1/deck.key",
      }),
    ).toBe("slides");
    expect(fileKind({ content_type: null, storage_path: "c/d/1/README" })).toBe(
      "other",
    );
    expect(fileKind({ content_type: null, storage_path: null })).toBe("other");
  });

  // #3959: one classifier for the filter, search and the web viewer.
  it("names what it groups, from the same type", () => {
    expect(
      classifyFile({ content_type: null, storage_path: "c/d/1/Budget.xlsx" }),
    ).toEqual({
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      kind: "spreadsheet",
      label: "Excel spreadsheet",
    });
    expect(
      classifyFile({
        content_type: "IMAGE/JPEG; q=1",
        storage_path: "c/d/1/x",
      }),
    ).toEqual({
      type: "image/jpeg",
      kind: "image",
      label: "Photo",
    });
    expect(
      classifyFile({
        content_type: "application/pdf",
        storage_path: "c/d/1/x.docx",
      }).kind,
    ).toBe("pdf");
    expect(
      classifyFile({ content_type: null, storage_path: "c/d/1/x.constructor" }),
    ).toEqual({
      type: null,
      kind: "other",
      label: "File",
    });
    expect(
      classifyFile({
        content_type: "application/zip",
        storage_path: "c/d/1/a.zip",
      }).label,
    ).toBe("File");
  });

  it("groups an unrecognised declared type by its extension, keeping the declared type", () => {
    expect(
      classifyFile({
        content_type: "application/x-csv",
        storage_path: "c/d/1/budget.csv",
      }),
    ).toEqual({
      type: "application/x-csv",
      kind: "spreadsheet",
      label: "CSV file",
    });
    expect(
      classifyFile({
        content_type: "text/plain",
        storage_path: "c/d/1/budget.csv",
      }).kind,
    ).toBe("spreadsheet");
  });

  it("names images the viewer can't draw by their type, and legacy formats by theirs", () => {
    expect(
      classifyFile({ content_type: null, storage_path: "c/d/1/IMG_1.HEIC" })
        .label,
    ).toBe("HEIC photo");
    expect(
      classifyFile({ content_type: null, storage_path: "c/d/1/logo.svg" })
        .label,
    ).toBe("SVG image");
    expect(
      classifyFile({ content_type: null, storage_path: "c/d/1/notes.odt" }),
    ).toEqual({
      type: "application/vnd.oasis.opendocument.text",
      kind: "word",
      label: "OpenDocument text file",
    });
    // Every extension the upload allowlist binds is known here too.
    expect(
      classifyFile({ content_type: null, storage_path: "c/d/1/a.avif" }).kind,
    ).toBe("image");
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
    queryDocuments(rows, query, filters, "name", {
      now: new Date(),
      semesterSince: null,
    }).map((row) => row.doc.id);

  it("filters by group, and offers only the groups present, in order", () => {
    expect(ids("", { ...NO_DOCUMENT_FILTERS, kind: "slides" })).toEqual(["b"]);
    expect(
      kindOptions(rows.map((row) => row.kind)).map((o) => o.label),
    ).toEqual(["PDF", "Word", "Slides", "Spreadsheet"]);
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
    expect(isFiltering("", { ...NO_DOCUMENT_FILTERS, kind: "pdf" }, true)).toBe(
      true,
    );
  });
});

describe("the Pinned and Starred filters (#4290)", () => {
  const rows = toLibraryDocuments(
    [
      doc("p", "Bylaws", "u1", "2026-11-01T12:00:00Z", {
        pinned_at: "2026-11-02T00:00:00Z",
      }),
      doc("s", "Rush deck", "u2", "2026-11-03T12:00:00Z", {
        storage_path: "c/d/s/rush.pptx",
        content_type: null,
      }),
      doc("ps", "Budget", "u1", "2026-06-01T12:00:00Z", {
        pinned_at: "2026-11-02T00:00:00Z",
      }),
      doc("n", "Minutes", "u2", "2026-11-04T12:00:00Z"),
      doc("old", "Old starred PDF", "u1", "2026-01-04T12:00:00Z"),
    ],
    (id) => NAMES[id] ?? null,
  );
  const starred = new Set(["s", "ps", "old"]);
  const ids = (
    marks: { pinned: boolean; starred: boolean },
    extra: Partial<typeof NO_DOCUMENT_FILTERS> = {},
    query = "",
  ) =>
    queryDocuments(
      rows,
      query,
      { ...NO_DOCUMENT_FILTERS, ...extra, marks },
      "name",
      {
        ...DATES,
        starred,
      },
    ).map((row) => row.doc.id);

  it("Pinned keeps what an officer pinned, Starred what this member starred", () => {
    expect(ids({ pinned: true, starred: false })).toEqual(["ps", "p"]);
    expect(ids({ pinned: false, starred: true })).toEqual(["ps", "old", "s"]);
  });

  it("with both on, keeps a file that is either, once", () => {
    expect(ids({ pinned: true, starred: true })).toEqual([
      "ps",
      "p",
      "old",
      "s",
    ]);
  });

  it("combines with search and the other filters: starred PDFs from the last 30 days", () => {
    expect(
      ids(
        { pinned: false, starred: true },
        { kind: "pdf", date: { preset: "30d" } },
      ),
    ).toEqual([]);
    expect(
      ids(
        { pinned: false, starred: true },
        { kind: "slides", date: { preset: "30d" } },
      ),
    ).toEqual(["s"]);
    expect(ids({ pinned: false, starred: true }, { kind: "pdf" })).toEqual([
      "ps",
      "old",
    ]);
    expect(ids({ pinned: true, starred: false }, {}, "budget")).toEqual(["ps"]);
  });

  it("finds nothing starred before the stars have loaded, rather than everything", () => {
    expect(
      queryDocuments(
        rows,
        "",
        { ...NO_DOCUMENT_FILTERS, marks: { pinned: false, starred: true } },
        "name",
        DATES,
      ),
    ).toEqual([]);
  });

  it("keeps a held file whatever its marks, only while the filter is on", () => {
    const run = (marks: { pinned: boolean; starred: boolean }) =>
      queryDocuments(rows, "", { ...NO_DOCUMENT_FILTERS, marks }, "name", {
        ...DATES,
        starred,
        keep: new Set(["n"]),
      }).map((row) => row.doc.id);
    expect(run({ pinned: true, starred: false })).toEqual(["ps", "p", "n"]);
    expect(run({ pinned: false, starred: false })).toHaveLength(5);
  });

  it("counts as a filter only when one is on", () => {
    expect(isMarkFiltering({ pinned: false, starred: false })).toBe(false);
    expect(isFiltering("", NO_DOCUMENT_FILTERS, true)).toBe(false);
    expect(
      isFiltering(
        "",
        { ...NO_DOCUMENT_FILTERS, marks: { pinned: true, starred: false } },
        true,
      ),
    ).toBe(true);
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
    expect(
      tierByMarks(
        items,
        () => false,
        () => false,
      ),
    ).toEqual({
      pinned: [],
      starred: [],
      rest: items,
    });
  });
});

describe("markedItems and tierRows (#3934)", () => {
  const folders = [
    { id: "f-1", name: "Finance", pinned_at: null },
    { id: "f-2", name: "Rush", pinned_at: "2026-11-11" },
  ];
  const docs = [
    { id: "d-1", folder: "Finance", pinned_at: "2026-11-11" },
    { id: "d-2", folder: "Finance", pinned_at: null },
    { id: "d-3", folder: null, pinned_at: null },
  ];

  it("splits folders then files into Pinned and Starred, counting loaded files", () => {
    const { pinned, starred } = markedItems({
      folders,
      library: docs,
      shown: docs,
      starredFolders: new Set(["f-1"]),
      starredDocuments: new Set(["d-3", "d-1"]),
    });
    expect(pinned).toEqual([
      { kind: "folder", folder: folders[1], count: 0 },
      { kind: "document", doc: docs[0] },
    ]);
    expect(starred).toEqual([
      { kind: "folder", folder: folders[0], count: 2 },
      { kind: "document", doc: docs[2] },
    ]);
  });

  it("leads rows with pinned, then starred, keeping each tier's order", () => {
    const rows = docs.map((doc) => ({ doc }));
    expect(
      tierRows([...rows].reverse(), new Set(["d-2"])).map((row) => row.doc.id),
    ).toEqual(["d-1", "d-2", "d-3"]);
  });
});
