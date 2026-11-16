import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentFile, shareDocumentFile } from "./document-file";

/**
 * s12 opens a document by downloading it and presenting the share sheet
 * (#4409), never by navigating the in-app browser to its inline link. What
 * these pin: the forced-download link is the one fetched; the file's
 * extension follows the declared type, or the stored one, and only ever
 * names a type the library takes, so a page can never arrive as one; and a
 * failure comes back as `false` for s12 to report.
 */
const fs = vi.mocked(FileSystem);
const sharing = vi.mocked(Sharing);
const platform = Platform as { OS: string };

const PDF = {
  id: "doc-1",
  title: "Chapter bylaws",
  content_type: "application/pdf",
  storage_path: "chapters/c1/documents/doc-1/bylaws_2026.pdf",
  downloadUrl: "https://example.test/signed/inline",
  forcedDownloadUrl:
    "https://example.test/signed/inline?download=bylaws_2026.pdf",
};

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = "ios";
  sharing.isAvailableAsync.mockResolvedValue(true);
  fs.downloadAsync.mockImplementation(async (_url, fileUri) => ({
    uri: fileUri,
    status: 200,
    headers: {},
    mimeType: null,
  }));
});

describe("documentFile", () => {
  it("names the file as web's Download does, typed by the declared type", () => {
    expect(documentFile(PDF)).toEqual({
      name: "bylaws_2026.pdf",
      mimeType: "application/pdf",
    });
  });

  it("takes the extension from the declared type, whatever the stored name says", () => {
    expect(
      documentFile({
        ...PDF,
        content_type: "image/png",
        storage_path: "chapters/c1/documents/doc-1/page.html",
      }),
    ).toEqual({ name: "page.png", mimeType: "image/png" });
  });

  it("reads an Office type, and a declared type's parameters, case-insensitively", () => {
    expect(
      documentFile({
        ...PDF,
        content_type:
          "Application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; charset=binary",
        storage_path: "chapters/c1/documents/doc-1/dues.xlsx",
      }),
    ).toMatchObject({ name: "dues.xlsx" });
  });

  it("falls back to the stored extension on a row with no useful type", () => {
    expect(documentFile({ ...PDF, content_type: null })).toEqual({
      name: "bylaws_2026.pdf",
      mimeType: "application/pdf",
    });
    expect(
      documentFile({ ...PDF, content_type: "application/octet-stream" }),
    ).toMatchObject({ name: "bylaws_2026.pdf" });
  });

  it("has no name for a type the library doesn't take", () => {
    expect(
      documentFile({
        ...PDF,
        content_type: "text/html",
        storage_path: "chapters/c1/documents/doc-1/page.html",
      }),
    ).toBeNull();
    expect(
      documentFile({
        ...PDF,
        content_type: "image/svg+xml",
        storage_path: "chapters/c1/documents/doc-1/logo.svg",
      }),
    ).toBeNull();
  });

  it("uses the title, then a stand-in, when the stored name has no usable stem", () => {
    expect(
      documentFile({
        ...PDF,
        storage_path: "chapters/c1/documents/doc-1/..pdf",
      }),
    ).toMatchObject({ name: "Chapter_bylaws.pdf" });
    expect(
      documentFile({ ...PDF, storage_path: null, title: "???" }),
    ).toMatchObject({ name: "document.pdf" });
  });
});

describe("shareDocumentFile", () => {
  it("downloads the forced-download link into the cache and shares that file", async () => {
    await expect(shareDocumentFile("doc-1", PDF, () => true)).resolves.toBe(
      true,
    );

    expect(fs.downloadAsync).toHaveBeenCalledWith(
      PDF.forcedDownloadUrl,
      "file:///cache/documents/doc-1/bylaws_2026.pdf",
    );
    expect(Share.share).toHaveBeenCalledWith(
      { url: "file:///cache/documents/doc-1/bylaws_2026.pdf" },
      expect.objectContaining({
        excludedActivityTypes: expect.arrayContaining([
          "com.apple.UIKit.activity.SaveToCameraRoll",
        ]),
      }),
    );
  });

  it("downloads the inline link on a server that predates the forced one", async () => {
    await shareDocumentFile(
      "doc-1",
      { ...PDF, forcedDownloadUrl: undefined },
      () => true,
    );

    expect(fs.downloadAsync).toHaveBeenCalledWith(
      PDF.downloadUrl,
      expect.any(String),
    );
  });

  it("shares through the Android chooser, typed and titled as the document", async () => {
    platform.OS = "android";

    await expect(shareDocumentFile("doc-1", PDF, () => true)).resolves.toBe(
      true,
    );
    expect(sharing.shareAsync).toHaveBeenCalledWith(
      "file:///cache/documents/doc-1/bylaws_2026.pdf",
      { dialogTitle: "Chapter bylaws", mimeType: "application/pdf" },
    );
  });

  it("presents nothing once the screen has moved on", async () => {
    await expect(shareDocumentFile("doc-1", PDF, () => false)).resolves.toBe(
      true,
    );
    expect(fs.downloadAsync).toHaveBeenCalled();
    expect(Share.share).not.toHaveBeenCalled();
  });

  it("downloads nothing without a link or a type the library takes", async () => {
    await expect(
      shareDocumentFile(
        "doc-1",
        { ...PDF, forcedDownloadUrl: "", downloadUrl: " " },
        () => true,
      ),
    ).resolves.toBe(false);
    await expect(
      shareDocumentFile(
        "doc-1",
        { ...PDF, content_type: "text/html", storage_path: "a/page.html" },
        () => true,
      ),
    ).resolves.toBe(false);
    await expect(shareDocumentFile("doc-1", null, () => true)).resolves.toBe(
      false,
    );
    expect(fs.downloadAsync).not.toHaveBeenCalled();
  });

  it("shares nothing when the download failed, since the file holds the error body", async () => {
    fs.downloadAsync.mockResolvedValueOnce({
      uri: "file:///cache/documents/doc-1/bylaws_2026.pdf",
      status: 400,
      headers: {},
      mimeType: null,
    });

    await expect(shareDocumentFile("doc-1", PDF, () => true)).resolves.toBe(
      false,
    );
    expect(Share.share).not.toHaveBeenCalled();
  });
});
