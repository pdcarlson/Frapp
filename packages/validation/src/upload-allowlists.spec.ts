import { describe, expect, it } from "vitest";
import {
  DOCUMENT_UPLOAD_SURFACES,
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  acceptAttribute,
  contentTypeByExtension,
  inspectUploadFile,
  isAllowedUploadExtension,
  isAllowedUploadMime,
  isWithinUploadSizeLimit,
  mimeForUploadFile,
  uploadExtensions,
  uploadMimeList,
  uploadMimeTypes,
} from "./upload-allowlists";

describe("upload kinds", () => {
  it("image is jpeg/png/gif/webp only", () => {
    expect([...uploadMimeList("image")]).toEqual([
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
    ]);
    expect(uploadExtensions("image")).toEqual(
      new Set(["jpg", "jpeg", "png", "gif", "webp"]),
    );
  });

  it("proof is images plus PDF", () => {
    expect(isAllowedUploadMime("proof", "application/pdf")).toBe(true);
    expect(isAllowedUploadMime("proof", "image/gif")).toBe(true);
    expect(
      isAllowedUploadMime(
        "proof",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
  });

  it("never allows SVG", () => {
    for (const kind of ["image", "proof", "document"] as const) {
      expect(isAllowedUploadMime(kind, "image/svg+xml")).toBe(false);
      expect(isAllowedUploadExtension(kind, ".svg")).toBe(false);
      expect(isAllowedUploadExtension(kind, "payload.svg")).toBe(false);
    }
  });
});

describe("GIF drift regression", () => {
  it("documents, backwork, and chat share the document kind, which includes image/gif", () => {
    // This is the test that would have caught the live bug: Backwork's page
    // omitted gif from a private copy of the documents allowlist while the
    // Backwork API service and bucket already accepted it.
    expect(DOCUMENT_UPLOAD_SURFACES).toEqual([
      "documents",
      "backwork",
      "chat",
    ]);
    expect(isAllowedUploadMime("document", "image/gif")).toBe(true);
    expect(isAllowedUploadExtension("document", "notes.gif")).toBe(true);
    expect(isAllowedUploadExtension("document", ".gif")).toBe(true);
    expect(contentTypeByExtension("document").gif).toBe("image/gif");
    expect(acceptAttribute("document").split(",")).toContain(".gif");
  });

  it("image and proof kinds also include gif (avatars, logos, receipts)", () => {
    expect(isAllowedUploadMime("image", "image/gif")).toBe(true);
    expect(isAllowedUploadMime("proof", "image/gif")).toBe(true);
  });
});

describe("legacy Office types", () => {
  it("keeps .doc/.xls/.ppt on the document kind to match API + buckets", () => {
    expect(isAllowedUploadMime("document", "application/msword")).toBe(true);
    expect(isAllowedUploadMime("document", "application/vnd.ms-excel")).toBe(
      true,
    );
    expect(
      isAllowedUploadMime("document", "application/vnd.ms-powerpoint"),
    ).toBe(true);
    expect(isAllowedUploadExtension("document", "memo.doc")).toBe(true);
    expect(isAllowedUploadExtension("document", "sheet.xls")).toBe(true);
    expect(isAllowedUploadExtension("document", "deck.ppt")).toBe(true);
    const accept = acceptAttribute("document").split(",");
    expect(accept).toContain(".doc");
    expect(accept).toContain(".xls");
    expect(accept).toContain(".ppt");
  });
});

describe("inspectUploadFile", () => {
  it("maps a GIF by extension even when file.type is empty", () => {
    expect(
      inspectUploadFile("document", {
        name: "scan.gif",
        type: "",
        size: 1024,
      }),
    ).toEqual({ ok: true, contentType: "image/gif" });
  });

  it("rejects a disallowed type before checking size", () => {
    expect(
      inspectUploadFile("document", {
        name: "payload.exe",
        type: "application/octet-stream",
        size: MAX_UPLOAD_BYTES + 1,
      }),
    ).toEqual({ ok: false, reason: "type" });
  });

  it("rejects a file over MAX_UPLOAD_BYTES", () => {
    expect(MAX_UPLOAD_BYTES).toBe(26_214_400);
    expect(MAX_UPLOAD_LABEL).toBe("25 MB");
    expect(isWithinUploadSizeLimit(MAX_UPLOAD_BYTES)).toBe(true);
    expect(isWithinUploadSizeLimit(MAX_UPLOAD_BYTES + 1)).toBe(false);
    expect(
      inspectUploadFile("document", {
        name: "notes.gif",
        type: "image/gif",
        size: MAX_UPLOAD_BYTES + 1,
      }),
    ).toEqual({ ok: false, reason: "size" });
  });

  it("prefers the extension map over a lying file.type", () => {
    expect(
      mimeForUploadFile("document", {
        name: "notes.gif",
        type: "application/octet-stream",
      }),
    ).toBe("image/gif");
  });
});

describe("uploadMimeTypes identity", () => {
  it("returns the same Set instance across calls so services can hold a reference", () => {
    expect(uploadMimeTypes("document")).toBe(uploadMimeTypes("document"));
  });
});
