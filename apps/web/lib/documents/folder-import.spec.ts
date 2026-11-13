import { describe, expect, it } from "vitest";
import {
  checkImportFile,
  findInLibrary,
  folderFromPath,
  suggestForImport,
} from "./folder-import";

const TYPES = ["Bylaws", "Minutes", "Agenda", "Budget", "Policy", "Form"];

describe("checkImportFile", () => {
  it("takes Documents' types and refuses others and oversized files", () => {
    expect(
      checkImportFile({ name: "a.pdf", type: "application/pdf", size: 10 }),
    ).toEqual({ ok: true, contentType: "application/pdf" });
    expect(
      checkImportFile({ name: "a.zip", type: "application/zip", size: 10 }),
    ).toEqual({ ok: false, reason: "type" });
    expect(
      checkImportFile({
        name: "scan.pdf",
        type: "application/pdf",
        size: 26 * 1024 * 1024,
      }),
    ).toEqual({ ok: false, reason: "size" });
  });
});

describe("findInLibrary", () => {
  const docs = [
    {
      title: "Bylaws",
      storage_path: "chapters/c/documents/x/Bylaws_2025.pdf",
      byte_size: 1200,
    },
    {
      title: "Old",
      storage_path: "chapters/c/documents/y/old.pdf",
      byte_size: null,
    },
  ];

  it("matches the stored name loosely and the exact size", () => {
    expect(findInLibrary({ name: "bylaws 2025.pdf", size: 1200 }, docs)?.title).toBe(
      "Bylaws",
    );
    expect(findInLibrary({ name: "Bylaws 2025.pdf", size: 1201 }, docs)).toBeNull();
  });

  it("never matches a document with no recorded size", () => {
    expect(findInLibrary({ name: "old.pdf", size: 0 }, docs)).toBeNull();
  });
});

describe("folderFromPath", () => {
  it("files into the deepest folder the chapter already has", () => {
    expect(
      folderFromPath("Chapter files/treasurer/2025/Budget.xlsx", [
        "Treasurer",
        "Governance",
      ]),
    ).toEqual({ folder: "Treasurer", isNew: false, depth: 1 });
  });

  it("else files into a chapter folder whose name holds the path folder's words", () => {
    const folders = ["Meeting Minutes", "Bylaws & Governance"];
    expect(folderFromPath("Drive/Minutes/10-12.pdf", folders)).toEqual({
      folder: "Meeting Minutes",
      isNew: false,
      depth: 1,
    });
    expect(folderFromPath("Drive/governance/bylaws.pdf", folders)).toEqual({
      folder: "Bylaws & Governance",
      isNew: false,
      depth: 1,
    });
    // An exact match anywhere on the path beats a partial one deeper down.
    expect(
      folderFromPath("Drive/Treasurer/Minutes/x.pdf", ["Treasurer", "Meeting Minutes"]),
    ).toEqual({ folder: "Treasurer", isNew: false, depth: 1 });
  });

  it("proposes the first folder under the dropped one as new", () => {
    expect(folderFromPath("Chapter files/Rush/2025/flyer.pdf", [])).toEqual({
      folder: "Rush",
      isNew: true,
      depth: 1,
    });
  });

  it("uses the dropped folder for a file sitting right in it, and nothing for a loose file", () => {
    expect(folderFromPath("Philanthropy/plan.docx", [])).toEqual({
      folder: "Philanthropy",
      isNew: true,
      depth: 0,
    });
    expect(folderFromPath("plan.docx", ["Governance"])).toBeNull();
  });
});

describe("suggestForImport", () => {
  const context = {
    typeOptions: TYPES,
    folders: ["Meeting Minutes", "Governance"],
    documents: [{ document_type: "Bylaws", folder: "Governance" }],
  };

  it("takes title and type from the name and the folder from the path", () => {
    expect(
      suggestForImport("Exec/Governance/fall-2026-bylaws.pdf", context),
    ).toEqual({
      title: "Fall 2026 bylaws",
      documentType: "Bylaws",
      folder: "Governance",
      folderIsNew: false,
      typeUnknown: false,
    });
  });

  it("reads the type off a folder on the path when the name says nothing", () => {
    const suggestion = suggestForImport("Drive/Minutes/10-12.docx", context);
    expect(suggestion.documentType).toBe("Minutes");
    expect(suggestion.folder).toBe("Meeting Minutes");
    expect(suggestion.folderIsNew).toBe(false);
  });

  it("keeps the folders a deep path loses in the title", () => {
    const a = suggestForImport("Chapter files/Rush/2024/flyer.pdf", context);
    const b = suggestForImport("Chapter files/Rush/2025/fall/flyer.pdf", context);
    expect([a.folder, a.title]).toEqual(["Rush", "Flyer (2024)"]);
    expect([b.folder, b.title]).toEqual(["Rush", "Flyer (2025 / fall)"]);
  });

  it("files a loose file where the chapter files its type", () => {
    const suggestion = suggestForImport("bylaws.pdf", context);
    expect(suggestion.folder).toBe("Governance");
    expect(suggestion.folderIsNew).toBe(false);
  });

  it("flags a file nothing says the type of", () => {
    const suggestion = suggestForImport("IMG_2041.jpg", context);
    expect(suggestion).toMatchObject({
      documentType: "",
      folder: "",
      typeUnknown: true,
    });
  });
});
