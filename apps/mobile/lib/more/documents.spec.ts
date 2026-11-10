import { describe, expect, it } from "vitest";
import { toLibraryDocuments } from "@repo/hooks/document-library";
import {
  documentMeta,
  selectDocumentFolders,
  selectDocuments,
  selectDownloadUrl,
} from "./documents";

const NOW = new Date("2026-11-09T12:00:00Z");

function metaFor(
  rows: unknown,
  names: Record<string, string> = {},
): (string | null)[] {
  return toLibraryDocuments(
    selectDocuments(rows),
    (id) => names[id] ?? null,
  ).map((row) => documentMeta(row, NOW));
}

describe("selectDocuments", () => {
  it("narrows a document to the fields the library reads", () => {
    expect(
      selectDocuments([
        {
          id: "d-1",
          title: "Chapter bylaws",
          description: "Ratified 2025",
          folder: "Governance",
          document_type: "Bylaws",
          uploaded_by: "u-1",
          created_at: "2026-08-12T14:00:00.000Z",
          storage_path: "chapters/c/documents/x/bylaws.pdf",
        },
      ]),
    ).toEqual([
      {
        id: "d-1",
        title: "Chapter bylaws",
        description: "Ratified 2025",
        folder: "Governance",
        document_type: "Bylaws",
        uploaded_by: "u-1",
        created_at: "2026-08-12T14:00:00.000Z",
        content_type: null,
        storage_path: "chapters/c/documents/x/bylaws.pdf",
      },
    ]);
  });

  // A row with no id cannot be opened — opening is what this list does.
  it("drops a row with no id or no title", () => {
    expect(
      selectDocuments([
        { title: "No id" },
        { id: "d-1" },
        { id: "d-2", title: "Fine" },
      ]),
    ).toHaveLength(1);
  });

  it("returns an empty list for an absent payload", () => {
    expect(selectDocuments(undefined)).toEqual([]);
  });
});

describe("documentMeta", () => {
  it("reads as web's row does: uploaded, by whom, then folder and type", () => {
    expect(
      metaFor(
        [
          {
            id: "d-1",
            title: "Bylaws",
            folder: "Governance",
            document_type: "Bylaws",
            uploaded_by: "u-1",
            created_at: "2026-08-12T14:00:00.000Z",
          },
        ],
        { "u-1": "Ryan Castellano" },
      ),
    ).toEqual(["Uploaded Aug 12 by Ryan Castellano · Governance · Bylaws"]);
  });

  it("leaves off an uploader the roster can't name", () => {
    expect(
      metaFor([
        {
          id: "d-1",
          title: "Bylaws",
          uploaded_by: "u-gone",
          created_at: "2026-08-12T14:00:00.000Z",
        },
      ]),
    ).toEqual(["Uploaded Aug 12"]);
  });

  it("omits the line when nothing is known", () => {
    expect(metaFor([{ id: "d-1", title: "Loose file" }])).toEqual([null]);
  });

  it("survives an unparseable timestamp without rendering Invalid Date", () => {
    expect(
      metaFor([
        { id: "d-1", title: "Odd", folder: "Ops", created_at: "not-a-date" },
      ]),
    ).toEqual(["Ops"]);
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
