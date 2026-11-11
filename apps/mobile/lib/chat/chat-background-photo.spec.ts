import { beforeEach, describe, expect, it, vi } from "vitest";

const pickUploadAndConfirmImage = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat/attachment-upload", () => ({ pickUploadAndConfirmImage }));

import {
  BACKGROUND_SAVE_FAILED,
  saveChatBackgroundPick,
} from "./chat-background-photo";

/**
 * The phone's chat background set (#4031): a built-in saves at once, a photo
 * goes through the shared pick-upload-confirm pipeline, and every failure
 * comes back as a sentence rather than a rejection.
 */
describe("saveChatBackgroundPick", () => {
  beforeEach(() => pickUploadAndConfirmImage.mockReset());

  it("saves a built-in, or null, without opening the library", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const deps = { requestPhotoUrl: vi.fn(), save };
    expect(await saveChatBackgroundPick("midnight", deps)).toEqual({
      status: "saved",
    });
    expect(await saveChatBackgroundPick(null, deps)).toEqual({
      status: "saved",
    });
    expect(save.mock.calls).toEqual([
      [{ background: "midnight" }],
      [{ background: null }],
    ]);
    expect(pickUploadAndConfirmImage).not.toHaveBeenCalled();
  });

  it("runs a photo through the shared pipeline: image gate, no crop, the background route without size_bytes, saved as photo", async () => {
    pickUploadAndConfirmImage.mockResolvedValue({ status: "updated" });
    const requestPhotoUrl = vi.fn().mockResolvedValue({});
    const save = vi.fn().mockResolvedValue(undefined);
    expect(
      await saveChatBackgroundPick("photo", { requestPhotoUrl, save }),
    ).toEqual({ status: "saved" });

    const options = pickUploadAndConfirmImage.mock.calls[0]![0];
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
    await options.confirm("chapters/c1/chat-backgrounds/x.jpg");
    expect(save).toHaveBeenCalledWith({
      background: "photo",
      storagePath: "chapters/c1/chat-backgrounds/x.jpg",
    });
  });

  it("passes a cancelled or refused photo through untouched", async () => {
    pickUploadAndConfirmImage.mockResolvedValueOnce({ status: "cancelled" });
    const deps = { requestPhotoUrl: vi.fn(), save: vi.fn() };
    expect(await saveChatBackgroundPick("photo", deps)).toEqual({
      status: "cancelled",
    });
    pickUploadAndConfirmImage.mockResolvedValueOnce({
      status: "refused",
      reason: "Backgrounds can be JPEG, PNG, GIF or WebP.",
    });
    expect(await saveChatBackgroundPick("photo", deps)).toEqual({
      status: "refused",
      reason: "Backgrounds can be JPEG, PNG, GIF or WebP.",
    });
  });

  it("reads a refused built-in save through errorCopy, with its own sentence as the fallback", async () => {
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
