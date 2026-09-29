import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { Platform, Share } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shareAttachment, shareFileName } from "./share-attachment";

/**
 * Sharing an image from the chat viewer (#2874). The share sheet needs a
 * local file, so the image is downloaded first. What these pin: the file is
 * named for the type the viewer drew, never for the sender's filename; a
 * failure anywhere comes back as `false` for the viewer to report; nothing is
 * presented once the viewer has moved on; and iOS never offers Save Image,
 * which would crash the app without a purpose string it doesn't declare.
 */
const fs = vi.mocked(FileSystem);
const sharing = vi.mocked(Sharing);
const platform = Platform as { OS: string };

const IMAGE = {
  id: "att-1",
  filename: "composite.png",
  contentType: "image/png",
  url: "https://example.test/signed/composite.png",
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

describe("shareFileName", () => {
  it("keeps the sender's name and takes the extension from the declared type", () => {
    expect(shareFileName("Formal 2026.JPG", "image/jpeg")).toBe(
      "Formal_2026.jpg",
    );
  });

  it("never hands over a page: the extension follows the type, whatever the name says", () => {
    // The API stores `filename` unvalidated. HTML bytes typed image/png under
    // the name a.html would otherwise reach another app as a web page.
    expect(shareFileName("a.html", "image/png")).toBe("a.png");
  });

  it("keeps the name to one safe path segment", () => {
    expect(shareFileName("../../etc/passwd", "image/png")).toBe(
      "etc_passwd.png",
    );
    expect(shareFileName("Is this ok?.png", "image/png")).toBe(
      "Is_this_ok.png",
    );
    expect(shareFileName("..", "image/png")).toBe("image.png");
  });

  it("has no name for anything that isn't a viewable image", () => {
    expect(shareFileName("logo.svg", "image/svg+xml")).toBeNull();
    expect(shareFileName("photo.png", null)).toBeNull();
  });
});

describe("shareAttachment", () => {
  it("downloads the image into the cache and shares that file", async () => {
    await expect(shareAttachment(IMAGE)).resolves.toBe(true);

    expect(fs.downloadAsync).toHaveBeenCalledWith(
      IMAGE.url,
      "file:///cache/chat-share/att-1/composite.png",
    );
    expect(Share.share).toHaveBeenCalledWith(
      { url: "file:///cache/chat-share/att-1/composite.png" },
      expect.anything(),
    );
  });

  it("leaves Save Image out of the iOS sheet", async () => {
    await shareAttachment(IMAGE);

    const [, options] = vi.mocked(Share.share).mock.calls[0]!;
    expect(options?.excludedActivityTypes).toContain(
      "com.apple.UIKit.activity.SaveToCameraRoll",
    );
  });

  it("shares through the system chooser on Android, typed as the image", async () => {
    platform.OS = "android";

    await expect(shareAttachment(IMAGE)).resolves.toBe(true);

    expect(sharing.shareAsync).toHaveBeenCalledWith(
      "file:///cache/chat-share/att-1/composite.png",
      expect.objectContaining({ mimeType: "image/png" }),
    );
    expect(Share.share).not.toHaveBeenCalled();
  });

  it("presents nothing once the viewer has moved on", async () => {
    await expect(shareAttachment(IMAGE, () => false)).resolves.toBe(true);
    expect(Share.share).not.toHaveBeenCalled();
    expect(sharing.shareAsync).not.toHaveBeenCalled();
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
    expect(Share.share).not.toHaveBeenCalled();
  });

  it("downloads nothing for an attachment that isn't a viewable image", async () => {
    await expect(
      shareAttachment({ ...IMAGE, contentType: "text/html" }),
    ).resolves.toBe(false);
    expect(fs.downloadAsync).not.toHaveBeenCalled();
  });

  it("reports false when an Android device can't share", async () => {
    platform.OS = "android";
    sharing.isAvailableAsync.mockResolvedValueOnce(false);

    await expect(shareAttachment(IMAGE)).resolves.toBe(false);
    expect(fs.downloadAsync).not.toHaveBeenCalled();
  });

  it("reports false rather than throwing when the download rejects", async () => {
    fs.downloadAsync.mockRejectedValueOnce(new Error("offline"));
    await expect(shareAttachment(IMAGE)).resolves.toBe(false);
  });
});
