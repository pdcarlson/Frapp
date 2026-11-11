import { beforeEach, describe, expect, it, vi } from "vitest";

const pickAndUploadImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat/attachment-upload", () => ({ pickAndUploadImage }));

import {
  BACKGROUND_SAVE_FAILED,
  pickAndUploadChatBackgroundPhoto,
  saveChatBackgroundPick,
} from "./chat-background-photo";

/**
 * The phone's chat background set (#4031): a built-in saves at once, a photo
 * goes through the shared upload pipeline first, and every failure comes back
 * as a sentence rather than a rejection.
 */
describe("chat background photo", () => {
  beforeEach(() => pickAndUploadImage.mockReset());

  it("mints through the background route without size_bytes, which its DTO refuses", async () => {
    pickAndUploadImage.mockResolvedValue({ status: "cancelled" });
    const requestPhotoUrl = vi.fn().mockResolvedValue({});
    await pickAndUploadChatBackgroundPhoto(requestPhotoUrl);

    const options = pickAndUploadImage.mock.calls[0]![0];
    expect(options.kind).toBe("image");
    expect(options.cropSquare).toBeUndefined();
    await options.requestUploadUrl({
      filename: "house.jpg",
      content_type: "image/jpeg",
      size_bytes: 1234,
    });
    expect(requestPhotoUrl).toHaveBeenCalledWith({
      filename: "house.jpg",
      contentType: "image/jpeg",
    });
  });

  it("saves a built-in, or null, without opening the library", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const deps = { requestPhotoUrl: vi.fn(), save };
    expect(await saveChatBackgroundPick("midnight", deps)).toEqual({
      status: "saved",
    });
    expect(await saveChatBackgroundPick(null, deps)).toEqual({
      status: "saved",
    });
    expect(save).toHaveBeenNthCalledWith(1, {
      background: "midnight",
      storagePath: undefined,
    });
    expect(save).toHaveBeenNthCalledWith(2, {
      background: null,
      storagePath: undefined,
    });
    expect(pickAndUploadImage).not.toHaveBeenCalled();
  });

  it("saves a photo under the path it uploaded to", async () => {
    pickAndUploadImage.mockResolvedValue({
      status: "uploaded",
      image: {
        storagePath: "chapter-1/chat-backgrounds/x.jpg",
        filename: "x.jpg",
        contentType: "image/jpeg",
        byteSize: 10,
      },
    });
    const save = vi.fn().mockResolvedValue(undefined);
    const result = await saveChatBackgroundPick("photo", {
      requestPhotoUrl: vi.fn(),
      save,
    });
    expect(result).toEqual({ status: "saved" });
    expect(save).toHaveBeenCalledWith({
      background: "photo",
      storagePath: "chapter-1/chat-backgrounds/x.jpg",
    });
  });

  it("writes nothing when the member backs out of the library, or the upload is refused", async () => {
    const save = vi.fn();
    pickAndUploadImage.mockResolvedValueOnce({ status: "cancelled" });
    expect(
      await saveChatBackgroundPick("photo", { requestPhotoUrl: vi.fn(), save }),
    ).toEqual({ status: "cancelled" });
    pickAndUploadImage.mockResolvedValueOnce({
      status: "refused",
      reason: "Backgrounds can be JPEG, PNG, GIF or WebP.",
    });
    expect(
      await saveChatBackgroundPick("photo", { requestPhotoUrl: vi.fn(), save }),
    ).toEqual({
      status: "refused",
      reason: "Backgrounds can be JPEG, PNG, GIF or WebP.",
    });
    expect(save).not.toHaveBeenCalled();
  });

  it("reads a refused save through errorCopy, with its own sentence as the fallback", async () => {
    const forbidden = await saveChatBackgroundPick("letters", {
      requestPhotoUrl: vi.fn(),
      save: vi.fn().mockRejectedValue({ statusCode: 403, message: "Forbidden" }),
    });
    expect(forbidden.status).toBe("refused");
    expect(forbidden).not.toEqual({
      status: "refused",
      reason: BACKGROUND_SAVE_FAILED,
    });
    const failed = await saveChatBackgroundPick("letters", {
      requestPhotoUrl: vi.fn(),
      save: vi.fn().mockRejectedValue({ statusCode: 500, message: "boom" }),
    });
    expect(failed).toEqual({ status: "refused", reason: BACKGROUND_SAVE_FAILED });
  });
});
