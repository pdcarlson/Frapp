import { describe, expect, it } from "vitest";
import {
  selectDocumentFolders,
  selectDocumentRows,
  selectDownloadUrl,
} from "./documents";

describe("selectDocumentRows", () => {
  it("narrows a document into a drawable row", () => {
    const [row] = selectDocumentRows([
      {
        id: "d-1",
        title: "Chapter bylaws",
        folder: "Governance",
        created_at: "2026-08-12T14:00:00.000Z",
      },
    ]);
    expect(row?.id).toBe("d-1");
    expect(row?.title).toBe("Chapter bylaws");
    expect(row?.folder).toBe("Governance");
    expect(row?.meta).toContain("Governance");
  });

  it("sorts newest first — the reference labels this list RECENT", () => {
    const rows = selectDocumentRows([
      { id: "d-1", title: "Older", created_at: "2026-08-01T00:00:00.000Z" },
      { id: "d-2", title: "Newest", created_at: "2026-08-20T00:00:00.000Z" },
      { id: "d-3", title: "Middle", created_at: "2026-08-10T00:00:00.000Z" },
    ]);
    expect(rows.map((row) => row.title)).toEqual(["Newest", "Middle", "Older"]);
  });

  // A row with no id cannot be opened — opening is the only thing this list does.
  it("drops a row with no id or no title", () => {
    expect(
      selectDocumentRows([
        { title: "No id" },
        { id: "d-1" },
        { id: "d-2", title: "Fine" },
      ]),
    ).toHaveLength(1);
  });

  it("omits the meta line when neither folder nor date is known", () => {
    const [row] = selectDocumentRows([{ id: "d-1", title: "Loose file" }]);
    expect(row?.meta).toBeNull();
  });

  it("survives an unparseable timestamp without rendering Invalid Date", () => {
    const [row] = selectDocumentRows([
      { id: "d-1", title: "Odd", folder: "Ops", created_at: "not-a-date" },
    ]);
    expect(row?.meta).toBe("Ops");
  });
});

describe("selectDocumentFolders", () => {
  it("orders folders by sort_order, then by name", () => {
    expect(
      selectDocumentFolders([
        { id: "f-2", name: "Finance", sort_order: 2 },
        { id: "f-1", name: "Governance", sort_order: 1 },
        { id: "f-3", name: "Alumni", sort_order: 2 },
      ]),
    ).toEqual([
      { id: "f-1", name: "Governance" },
      { id: "f-3", name: "Alumni" },
      { id: "f-2", name: "Finance" },
    ]);
  });

  it("treats a missing sort_order as first rather than dropping the folder", () => {
    expect(
      selectDocumentFolders([
        { id: "f-1", name: "Ordered", sort_order: 5 },
        { id: "f-2", name: "Unordered" },
      ]).map((folder) => folder.name),
    ).toEqual(["Unordered", "Ordered"]);
  });

  it("returns an empty list for an absent payload", () => {
    expect(selectDocumentFolders(undefined)).toEqual([]);
  });
});

describe("selectDownloadUrl", () => {
  // The whole reason this is a named selector: the service returns `downloadUrl`
  // and there is no case-transforming interceptor, so the snake_case spelling
  // web reads yields `undefined` and a dead tap.
  it("reads the camelCase key the service actually returns", () => {
    expect(
      selectDownloadUrl({ id: "d-1", downloadUrl: "https://signed/url" }),
    ).toBe("https://signed/url");
  });

  it("accepts a snake_case key too, so a server rename cannot break the tap", () => {
    expect(selectDownloadUrl({ download_url: "https://signed/url" })).toBe(
      "https://signed/url",
    );
  });

  it("returns null when there is no url to open", () => {
    expect(selectDownloadUrl(undefined)).toBeNull();
    expect(selectDownloadUrl({ id: "d-1" })).toBeNull();
    expect(selectDownloadUrl({ downloadUrl: "" })).toBeNull();
  });
});
