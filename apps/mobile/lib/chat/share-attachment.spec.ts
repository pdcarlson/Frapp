import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shareAttachment } from "./share-attachment";

/**
 * Saving or sharing an image from the chat viewer (#2874). The share sheet
 * needs a local file, so the image is downloaded first; what these pin is that
 * a failure anywhere comes back as `false` for the viewer to report, and never
 * shares something that isn't the image.
 */
const fs = vi.mocked(FileSystem);
const sharing = vi.mocked(Sharing);

const IMAGE = {
  id: "att-1",
  filename: "composite.png",
  contentType: "image/png",
  url: "https://example.test/signed/composite.png",
};

beforeEach(() => {
  vi.clearAllMocks();
  sharing.isAvailableAsync.mockResolvedValue(true);
  fs.downloadAsync.mockImplementation(async (_url, fileUri) => ({
    uri: fileUri,
    status: 200,
    headers: {},
    mimeType: null,
  }));
});

describe("shareAttachment", () => {
  it("downloads the image into the cache and shares that file", async () => {
    await expect(shareAttachment(IMAGE)).resolves.toBe(true);

    expect(fs.downloadAsync).toHaveBeenCalledWith(
      IMAGE.url,
      "file:///cache/chat-share/att-1/composite.png",
    );
    expect(sharing.shareAsync).toHaveBeenCalledWith(
      "file:///cache/chat-share/att-1/composite.png",
      expect.objectContaining({ mimeType: "image/png" }),
    );
  });

  it("keeps the uploader's filename inside the attachment's own directory", async () => {
    // The name is whatever the uploader's device called the file.
    await shareAttachment({ ...IMAGE, filename: "../../../etc/passwd" });
    expect(fs.downloadAsync).toHaveBeenCalledWith(
      IMAGE.url,
      "file:///cache/chat-share/att-1/passwd",
    );

    await shareAttachment({ ...IMAGE, filename: ".." });
    expect(fs.downloadAsync).toHaveBeenLastCalledWith(
      IMAGE.url,
      "file:///cache/chat-share/att-1/image",
    );
  });

  it("shares nothing when the download failed, since the file holds the error body", async () => {
    // An expired signed URL answers 400 with an XML body, which
    // `downloadAsync` writes to the file and resolves.
    fs.downloadAsync.mockResolvedValueOnce({
      uri: "file:///cache/chat-share/att-1/composite.png",
      status: 400,
      headers: {},
      mimeType: null,
    });

    await expect(shareAttachment(IMAGE)).resolves.toBe(false);
    expect(sharing.shareAsync).not.toHaveBeenCalled();
  });

  it("reports false when the device can't share", async () => {
    sharing.isAvailableAsync.mockResolvedValueOnce(false);

    await expect(shareAttachment(IMAGE)).resolves.toBe(false);
    expect(fs.downloadAsync).not.toHaveBeenCalled();
  });

  it("reports false rather than throwing when the download rejects", async () => {
    fs.downloadAsync.mockRejectedValueOnce(new Error("offline"));
    await expect(shareAttachment(IMAGE)).resolves.toBe(false);
  });
});
